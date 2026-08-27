import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunState } from '@power/runstate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgliteDriver } from './db.js';
import { Jobs } from './jobs.js';
import { MemoryLedger, MemoryQuota, Meter, PLANS } from './metering.js';
import { openPgliteControlPlane, type ControlPlane } from './pgstore.js';
import { MemorySecrets, scrub, scrubDeep } from './secrets.js';

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'power-infra-'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('jobs', () => {
  it('returns the result directly when work finishes inside the wait', async () => {
    const out = await new Jobs().run('t', async () => 42, 500);
    expect(out.settled && out.job.result).toBe(42);
  });

  it('returns a handle when work outlives the wait, and the handle resolves later', async () => {
    const jobs = new Jobs();
    const out = await jobs.run('t', () => new Promise((r) => setTimeout(() => r('late'), 80)), 10);
    expect(out.settled).toBe(false);
    if (out.settled) return;
    expect(out.handle.poll_with).toBe('get_job');
    await new Promise((r) => setTimeout(r, 120));
    expect(jobs.get(out.handle.job_id)?.status).toBe('done');
    expect(jobs.get(out.handle.job_id)?.result).toBe('late');
  });

  it('records a failure rather than throwing into the poller', async () => {
    const jobs = new Jobs();
    const out = await jobs.run('t', async () => { throw new Error('boom'); }, 500);
    expect(out.settled && out.job.status).toBe('failed');
    expect(out.settled && out.job.error).toBe('boom');
  });
});

describe('metering', () => {
  const meter = () => new Meter(new MemoryQuota(), new MemoryLedger(), async () => 'free');

  it('grants until the daily cap and reports what is left', async () => {
    const m = meter();
    for (let i = 0; i < PLANS.free.per_day; i++) expect((await m.reserve('u')).granted).toBe(true);
    const over = await m.reserve('u');
    expect(over.granted).toBe(false);
    expect(over.exhausted?.window).toBe('day');
    expect((await m.remaining('u')).day).toBe(0);
  });

  it('a refused reservation does not consume quota', async () => {
    const m = meter();
    for (let i = 0; i < PLANS.free.per_day; i++) await m.reserve('u');
    await m.reserve('u');
    await m.reserve('u');
    expect((await m.remaining('u')).day).toBe(0);
    await m.release('u');
    expect((await m.remaining('u')).day).toBe(1);
  });

  it('release gives a gate-refused call back — you only pay for work that passed', async () => {
    const m = meter();
    await m.reserve('u');
    await m.release('u');
    expect((await m.remaining('u')).day).toBe(PLANS.free.per_day);
  });

  it('paid plans have no weekly pool', async () => {
    const m = new Meter(new MemoryQuota(), new MemoryLedger(), async () => 'pro');
    expect((await m.reserve('u')).remaining.week).toBeNull();
  });
});

describe('secrets', () => {
  it('the model never sees a value: request → browser sets → fingerprint only', async () => {
    const s = new MemorySecrets();
    const req = await s.request({ project_id: 'p', name: 'STRIPE_KEY', env: 'workbench', provider: 'stripe', why: 'payments' });
    expect(req.token).toBeTruthy();
    const rec = await s.set(req.token, 'sk_test_abcdefghijklmnop');
    expect(rec.fingerprint).toHaveLength(8);
    expect(JSON.stringify(await s.list('p'))).not.toContain('sk_test');
    expect(await s.valuesFor('p', 'workbench')).toEqual({ STRIPE_KEY: 'sk_test_abcdefghijklmnop' });
    expect(await s.valuesFor('p', 'live')).toEqual({});
  });

  it('a request token is single-use', async () => {
    const s = new MemorySecrets();
    const req = await s.request({ project_id: 'p', name: 'X', env: 'both', provider: null, why: '' });
    await s.set(req.token, 'value-long-enough');
    await expect(s.set(req.token, 'again')).rejects.toThrow(/expired or was already used/);
  });

  it('the scrubber redacts known values anywhere in a payload', () => {
    const values = ['sk_live_9f8e7d6c5b4a3210', 'abc'];
    const out = scrubDeep({ log: 'key=sk_live_9f8e7d6c5b4a3210 abc', nested: ['sk_live_9f8e7d6c5b4a3210'] }, values);
    expect(JSON.stringify(out)).not.toContain('sk_live');
    expect(out.log).toMatch(/\[redacted:[0-9a-f]{8}\] abc/);
    expect(scrub('short abc word', values)).toBe('short abc word');
  });
});

describe('database driver: two branches, no SQL against live', () => {
  let db: PgliteDriver;
  beforeAll(() => { db = new PgliteDriver(join(root, 'dbtest')); });
  afterAll(() => db.close());

  it('provisions live and a workbench copy', async () => {
    expect(await db.provision('p1')).toEqual({ created: true });
    expect(await db.provision('p1')).toEqual({ created: false });
    expect(await db.schema('p1', 'live')).toEqual([]);
  });

  it('query is read-only and workbench-scoped', async () => {
    await db.applyToWorkbench('p1', `create table notes (id serial primary key, body text)`);
    await db.applyToWorkbench('p1', `insert into notes (body) values ('a'), ('b'), ('c')`);
    const r = await db.query('p1', 'select * from notes order by id', 2);
    expect(r.rows).toHaveLength(2);
    expect(r.truncated).toBe(true);
    await expect(db.query('p1', 'delete from notes', 10)).rejects.toThrow(/read-only/);
    // Live is untouched by workbench work.
    expect(await db.schema('p1', 'live')).toEqual([]);
  });

  it('rehearses a migration on a scratch copy of live and judges it', async () => {
    const good = await db.rehearse('p1', {
      up_sql: 'create table customers (id serial primary key, name text)',
      down_sql: 'drop table customers',
      intent: 'Create the customers table.',
    });
    expect(good.pass).toBe(true);
    expect(good.destructive).toBe(false);
    // Rehearsal must not have touched live.
    expect(await db.schema('p1', 'live')).toEqual([]);

    const irreversible = await db.rehearse('p1', {
      up_sql: 'create table x (id int)',
      down_sql: 'select 1',
      intent: 'Create x without a real down.',
    });
    expect(irreversible.errors.map((e) => e.rule)).toContain('migration.not_reversible');

    const broken = await db.rehearse('p1', {
      up_sql: 'alter table nope add column c int',
      down_sql: 'alter table nope drop column c',
      intent: 'Alter a table that does not exist.',
    });
    expect(broken.errors.map((e) => e.rule)).toContain('migration.up_failed');
  });

  it('promotes with a snapshot, and the snapshot restores live', async () => {
    const proposal = { up_sql: 'create table customers (id serial primary key, name text)', down_sql: 'drop table customers', intent: 'Create customers.' };
    const { snapshot } = await db.promote('p1', proposal);
    expect((await db.schema('p1', 'live')).map((t) => t.name)).toEqual(['customers']);
    await db.restoreLive('p1', snapshot);
    expect(await db.schema('p1', 'live')).toEqual([]);
  });

  it('refreshWorkbench resets the safe copy to live', async () => {
    await db.refreshWorkbench('p1');
    expect(await db.schema('p1', 'workbench')).toEqual([]);
  });
});

describe('control plane on Postgres with RLS', () => {
  let cp: ControlPlane;
  beforeAll(async () => { cp = await openPgliteControlPlane(join(root, 'cp')); });
  afterAll(() => cp.close());

  it('persists a project and its run through the real store', async () => {
    await cp.ensureUser('alice', 'pro');
    const alice = cp.storeFor('alice');
    await alice.createProject({ id: 'pa', name: 'A', slug: 'a', created_at: new Date().toISOString() }, createRunState('run_a'));
    expect((await alice.getProject('pa'))?.name).toBe('A');
    expect((await alice.getRun('pa')).phase).toBe('intake');
    expect(await cp.planOf('alice')).toBe('pro');
  });

  it('row-level security: another tenant sees nothing, even by id', async () => {
    await cp.ensureUser('mallory');
    const mallory = cp.storeFor('mallory');
    expect(await mallory.getProject('pa')).toBeNull();
    expect(await mallory.listProjects()).toEqual([]);
    await expect(mallory.getRun('pa')).rejects.toThrow(/not found/);
    // And cannot write into someone else's rows either.
    await expect(mallory.putArtifact('pa', 'SPEC.md', 'x')).rejects.toThrow();
  });

  it('artifacts, gate errors and approvals round-trip', async () => {
    const alice = cp.storeFor('alice');
    await alice.putArtifact('pa', 'SPEC.md', '# spec');
    await alice.putGateErrors('pa', 'spec', [{ artifact: 'SPEC.md', field: 'x', rule: 'r', detail: 'd' }]);
    await alice.putApprovals('pa', { spec_approved_at: new Date().toISOString(), spec_approval_requested_at: null, publish_confirmed_at: null, migration_confirmed_at: null });
    expect((await alice.getArtifacts('pa'))['SPEC.md']).toBe('# spec');
    expect((await alice.getGateErrors('pa')).spec?.[0]?.rule).toBe('r');
    expect((await alice.getApprovals('pa')).spec_approved_at).toBeTruthy();
  });
});
