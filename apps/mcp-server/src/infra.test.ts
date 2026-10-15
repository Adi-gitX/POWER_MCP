import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunState } from '@power/runstate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgliteDriver } from './db.js';
import { Jobs } from './jobs.js';
import { MemoryLedger, MemoryQuota, Meter, PLANS } from './metering.js';
import { openPgControlPlane, openPgliteControlPlane, type ControlPlane } from './pgstore.js';
import { MemorySecrets, scrub, scrubDeep } from './secrets.js';

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'power-infra-'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('jobs', () => {
  const ada = { userId: 'user_ada', projectId: 'proj_1' };

  it('returns the result directly when work finishes inside the wait', async () => {
    const out = await new Jobs().run('t', async () => 42, 500, ada);
    expect(out.settled && out.job.result).toBe(42);
  });

  it('returns a handle when work outlives the wait, and the handle resolves later', async () => {
    const jobs = new Jobs();
    const out = await jobs.run('t', () => new Promise((r) => setTimeout(() => r('late'), 80)), 10, ada);
    expect(out.settled).toBe(false);
    if (out.settled) return;
    expect(out.handle.poll_with).toBe('get_job');
    await new Promise((r) => setTimeout(r, 120));
    expect(jobs.get(out.handle.job_id, ada.userId)?.status).toBe('done');
    expect(jobs.get(out.handle.job_id, ada.userId)?.result).toBe('late');
  });

  it('records a failure rather than throwing into the poller', async () => {
    const jobs = new Jobs();
    const out = await jobs.run('t', async () => { throw new Error('boom'); }, 500, ada);
    expect(out.settled && out.job.status).toBe('failed');
    expect(out.settled && out.job.error).toBe('boom');
  });

  /**
   * One registry serves every principal, and `get` used to check nothing, so a
   * job id was a bearer token for someone else's tool output.
   */
  it('will not hand a job to anyone but its owner', async () => {
    const jobs = new Jobs();
    const out = await jobs.run('run_tests', () => new Promise((r) => setTimeout(() => r('secret output'), 60)), 10, ada);
    if (out.settled) throw new Error('expected a handle');
    await new Promise((r) => setTimeout(r, 100));

    expect(jobs.get(out.handle.job_id, 'user_ada')?.result).toBe('secret output');
    // Indistinguishable from an id that never existed, so polling cannot be
    // used to find out that somebody else's job is there.
    expect(jobs.get(out.handle.job_id, 'user_mallory')).toBeUndefined();
    expect(jobs.get('job_000000000000', 'user_mallory')).toBeUndefined();
  });

  it('says which project a late result belongs to, so it can be scrubbed', async () => {
    const jobs = new Jobs();
    const out = await jobs.run('run_tests', async () => 'ok', 500, ada);
    const id = out.settled ? out.job.id : out.handle.job_id;
    expect(jobs.projectOf(id, 'user_ada')).toBe('proj_1');
    expect(jobs.projectOf(id, 'user_mallory')).toBeNull();
  });

  it('bills a finished job once, and never while it is still running', async () => {
    const jobs = new Jobs();
    const out = await jobs.run('run_tests', () => new Promise((r) => setTimeout(() => r('done'), 60)), 10, ada);
    if (out.settled) throw new Error('expected a handle');
    const id = out.handle.job_id;

    // Nothing to bill yet: the work has not finished.
    expect(jobs.claimBill(id, ada.userId)).toBeNull();

    await new Promise((r) => setTimeout(r, 100));
    expect(jobs.claimBill(id, ada.userId)).toEqual({ tool: 'run_tests', projectId: 'proj_1' });
    // Polling twice must not charge twice.
    expect(jobs.claimBill(id, ada.userId)).toBeNull();
  });

  it('will not let someone else claim the bill', async () => {
    const jobs = new Jobs();
    const out = await jobs.run('run_tests', async () => 'ok', 500, ada);
    const id = out.settled ? out.job.id : out.handle.job_id;
    expect(jobs.claimBill(id, 'user_mallory')).toBeNull();
    expect(jobs.claimBill(id, ada.userId)).not.toBeNull();
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
    const req = await s.request({ user_id: 'u1', project_id: 'p', name: 'STRIPE_KEY', env: 'workbench', provider: 'stripe', why: 'payments' });
    expect(req.token).toBeTruthy();
    const rec = await s.set(req.token, 'sk_test_abcdefghijklmnop');
    expect(rec.fingerprint).toHaveLength(8);
    expect(JSON.stringify(await s.list('p'))).not.toContain('sk_test');
    expect(await s.valuesFor('p', 'workbench')).toEqual({ STRIPE_KEY: 'sk_test_abcdefghijklmnop' });
    expect(await s.valuesFor('p', 'live')).toEqual({});
  });

  it('a request token is single-use', async () => {
    const s = new MemorySecrets();
    const req = await s.request({ user_id: 'u1', project_id: 'p', name: 'X', env: 'both', provider: null, why: '' });
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

/**
 * The isolation suite runs against every backend we can reach. PGlite always;
 * a real Postgres when POWER_TEST_DATABASE_URL is set. The policies are the
 * whole security model, so they are worth proving on the engine that will
 * actually serve them rather than only on the in-process one.
 */
const BACKENDS: { name: string; open: () => Promise<ControlPlane> }[] = [
  { name: 'pglite', open: () => openPgliteControlPlane(join(root, 'cp')) },
];
if (process.env.POWER_TEST_DATABASE_URL) {
  BACKENDS.push({ name: 'postgres', open: () => openPgControlPlane(process.env.POWER_TEST_DATABASE_URL!) });
}

describe.each(BACKENDS)('control plane with RLS on $name', ({ open }) => {
  let cp: ControlPlane;
  // Ids are unique per run so the suite can be re-run against a persistent
  // database without colliding with its own previous rows.
  const tag = Math.random().toString(16).slice(2, 8);
  const owner = `alice_${tag}`;
  const intruder = `mallory_${tag}`;
  const pid = `pa_${tag}`;

  beforeAll(async () => { cp = await open(); });
  afterAll(() => cp.close());

  it('persists a project and its run through the real store', async () => {
    await cp.ensureUser(owner, 'pro');
    const alice = cp.storeFor(owner);
    await alice.createProject({ id: pid, name: 'A', slug: `a-${tag}`, created_at: new Date().toISOString() }, createRunState('run_a'));
    expect((await alice.getProject(pid))?.name).toBe('A');
    expect((await alice.getRun(pid)).phase).toBe('intake');
    expect(await cp.planOf(owner)).toBe('pro');
  });

  it('row-level security: another tenant sees nothing, even by id', async () => {
    await cp.ensureUser(intruder);
    const mallory = cp.storeFor(intruder);
    expect(await mallory.getProject(pid)).toBeNull();
    expect(await mallory.listProjects()).toEqual([]);
    await expect(mallory.getRun(pid)).rejects.toThrow(/not found/);
    // And cannot write into someone else's rows either.
    await expect(mallory.putArtifact(pid, 'SPEC.md', 'x')).rejects.toThrow();
  });

  it('the oauth scope and the tenant scope cannot see each other', async () => {
    // This is the test that matters. If a tenant-scoped transaction could read
    // oauth_access_tokens, any SQL mistake in a handler would become a way to
    // lift another person's bearer token.
    const oauth = <T,>(fn: (tx: typeof cp.sql) => Promise<T>) =>
      cp.sql.transaction(async (tx) => {
        await tx.query(`select set_config('power.scope', 'oauth', true)`);
        return fn(tx);
      });

    await oauth(async (tx) => {
      await tx.query(
        `insert into oauth_clients (client_id, client_id_issued_at, redirect_uris, raw_metadata)
         values ($1, $2, $3::jsonb, $4::jsonb) on conflict (client_id) do nothing`,
        [`cli_${tag}`, Date.now(), JSON.stringify(['https://claude.ai/api/mcp/auth_callback']), JSON.stringify({})],
      );
      await tx.query(
        `insert into oauth_access_tokens (token_hash, client_id, user_id, expires_at)
         values ($1, $2, $3, now() + interval '1 hour')`,
        [`hash_${tag}`, `cli_${tag}`, owner],
      );
    });

    // Written, and visible from its own scope.
    const mine = await oauth((tx) => tx.query(`select token_hash from oauth_access_tokens where token_hash = $1`, [`hash_${tag}`]));
    expect(mine.rows).toHaveLength(1);

    // Invisible to the tenant who owns the token, let alone anyone else.
    const asTenant = await cp.sql.transaction(async (tx) => {
      await tx.query(`select set_config('power.user_id', $1, true)`, [owner]);
      return tx.query(`select token_hash from oauth_access_tokens`);
    });
    expect(asTenant.rows).toEqual([]);

    // And the reverse: the oauth scope sees no tenant rows.
    const asOauth = await oauth((tx) => tx.query(`select id from projects`));
    expect(asOauth.rows).toEqual([]);
  });

  it('artifacts, gate errors and approvals round-trip', async () => {
    const alice = cp.storeFor(owner);
    await alice.putArtifact(pid, 'SPEC.md', '# spec');
    await alice.putGateErrors(pid, 'spec', [{ artifact: 'SPEC.md', field: 'x', rule: 'r', detail: 'd' }]);
    await alice.putApprovals(pid, { spec_approved_at: new Date().toISOString(), spec_approval_requested_at: null, publish_confirmed_at: null, migration_confirmed_at: null, unpublish_confirmed_at: null });
    expect((await alice.getArtifacts(pid))['SPEC.md']).toBe('# spec');
    expect((await alice.getGateErrors(pid)).spec?.[0]?.rule).toBe('r');
    expect((await alice.getApprovals(pid)).spec_approved_at).toBeTruthy();
  });
});

describe('the project database is reachable by the project', () => {
  /**
   * The gap this closes: the driver could provision branches, rehearse
   * migrations and promote them while the application being built could reach
   * none of it. A generated app is an ordinary Postgres application, so the
   * test has to be an ordinary Postgres client -- `pg`, over a socket, no
   * Power-specific access.
   */
  let driver: PgliteDriver;
  beforeAll(() => {
    driver = new PgliteDriver(join(root, 'connstr'));
  });
  afterAll(async () => {
    await driver.close();
  });

  it('hands out a URL that pg can connect to and write through', async () => {
    await driver.provision('p-conn');
    const url = await driver.connectionString('p-conn', 'workbench');
    expect(url).toMatch(/^postgres:\/\/postgres:postgres@127\.0\.0\.1:\d+\/postgres$/);

    const { Pool } = await import('pg');
    // More than one connection on purpose: the socket server defaults to a
    // single one, and a pg.Pool is what every generated app actually uses.
    const pool = new Pool({ connectionString: url, max: 3 });
    try {
      await pool.query('create table if not exists items (id serial primary key, label text not null)');
      await pool.query('insert into items (label) values ($1)', ['from the app']);

      const concurrent = await Promise.all([
        pool.query('select label from items'),
        pool.query('select count(*)::int as n from items'),
        pool.query('select 1 as one'),
      ]);
      expect(concurrent[0].rows[0].label).toBe('from the app');
      expect(concurrent[1].rows[0].n).toBe(1);
    } finally {
      await pool.end();
    }

    // And the driver sees the same database, so what the app writes is what
    // read_data and pull_schema report.
    const seen = await driver.query('p-conn', 'select label from items', 10);
    expect(seen.rows[0]!.label).toBe('from the app');
    expect((await driver.schema('p-conn', 'workbench')).map((t) => t.name)).toContain('items');
  });

  it('keeps the same URL working after the branch is copied underneath it', async () => {
    await driver.provision('p-stable');
    const url = await driver.connectionString('p-stable', 'workbench');

    // refresh_workbench closes the instance and copies live over it. The app
    // is already holding this URL, so the port has to survive.
    await driver.refreshWorkbench('p-stable');
    expect(await driver.connectionString('p-stable', 'workbench')).toBe(url);

    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      expect((await pool.query('select 1 as one')).rows[0].one).toBe(1);
    } finally {
      await pool.end();
    }
  });

  it('serves live and workbench on different ports', async () => {
    await driver.provision('p-two');
    const workbench = await driver.connectionString('p-two', 'workbench');
    const live = await driver.connectionString('p-two', 'live');
    // Two branches that answered on one port would mean the app's live
    // environment was writing to the safe copy, or worse, the other way.
    expect(workbench).not.toBe(live);
  });
});
