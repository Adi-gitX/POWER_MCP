import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openPgliteControlPlane, type ControlPlane } from './pgstore.js';
import { PgSecrets, secretKeyFromEnv } from './secrets-pg.js';

let dir: string;
let cp: ControlPlane;
let secrets: PgSecrets;

const KEY = createHash('sha256').update('test-key').digest();

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'power-secrets-'));
  cp = await openPgliteControlPlane(join(dir, 'cp'));
  secrets = new PgSecrets(cp.sql, KEY);
});

afterAll(async () => {
  await cp.close();
  await rm(dir, { recursive: true, force: true });
});

describe('the encryption key', () => {
  it('is required anywhere that is not loopback', () => {
    // A default key is the same as no encryption, and worse than none because
    // everyone believes it is encrypted.
    expect(() => secretKeyFromEnv({}, false)).toThrow(/POWER_SECRET_KEY must be set/);
  });

  it('refuses a key of the wrong length', () => {
    expect(() => secretKeyFromEnv({ POWER_SECRET_KEY: Buffer.from('short').toString('base64') }, false)).toThrow(/32 bytes/);
  });

  it('allows a development key on loopback', () => {
    expect(secretKeyFromEnv({}, true)).toHaveLength(32);
  });
});

describe('project secrets', () => {
  it('round-trips a value and reports only a fingerprint', async () => {
    const req = await secrets.request({
      user_id: 'u1',
      project_id: 'p1',
      name: 'STRIPE_KEY',
      env: 'workbench',
      provider: 'stripe',
      why: 'payments',
    });
    const record = await secrets.set(req.token, 'sk_test_value_long_enough');

    expect(record.fingerprint).toHaveLength(8);
    // The record a person or a model can see never carries the value.
    expect(JSON.stringify(record)).not.toContain('sk_test_value_long_enough');

    const values = await secrets.valuesFor('p1', 'workbench');
    expect(values.STRIPE_KEY).toBe('sk_test_value_long_enough');
  });

  it('a request link works exactly once', async () => {
    const req = await secrets.request({ user_id: 'u1', project_id: 'p1', name: 'ONCE', env: 'both', provider: null, why: '' });
    await secrets.set(req.token, 'first-value-here');
    // A form submitted twice must not write a second value under one request.
    await expect(secrets.set(req.token, 'second-value-here')).rejects.toThrow(/already been used|expired/);
  });

  it('scopes by environment, so a test key is not a live key', async () => {
    const req = await secrets.request({ user_id: 'u1', project_id: 'p2', name: 'ONLY_LIVE', env: 'live', provider: null, why: '' });
    await secrets.set(req.token, 'live-value-here');

    expect(await secrets.valuesFor('p2', 'live')).toHaveProperty('ONLY_LIVE');
    expect(await secrets.valuesFor('p2', 'workbench')).not.toHaveProperty('ONLY_LIVE');
  });

  it('survives a new store instance, which a Map did not', async () => {
    const reopened = new PgSecrets(cp.sql, KEY);
    expect((await reopened.valuesFor('p1', 'workbench')).STRIPE_KEY).toBe('sk_test_value_long_enough');
  });

  it('is unreadable with the wrong key', async () => {
    const wrong = new PgSecrets(cp.sql, createHash('sha256').update('not-the-key').digest());
    await expect(wrong.valuesFor('p1', 'workbench')).rejects.toThrow();
  });
});

describe('account secrets', () => {
  it('are asked for once and reused across projects', async () => {
    // This is the shape a hosting token needs: per account, not per project,
    // because asking again on every new project is what kills a first publish.
    const req = await secrets.request({
      user_id: 'u1',
      project_id: null,
      name: 'DEPLOY_TOKEN',
      env: 'live',
      provider: 'hosting',
      why: 'publishing',
    });
    await secrets.set(req.token, 'deploy-token-value');

    expect(await secrets.accountValue('u1', 'DEPLOY_TOKEN')).toBe('deploy-token-value');
    // Another account must not see it.
    expect(await secrets.accountValue('u2', 'DEPLOY_TOKEN')).toBeNull();
    // And it is not a project secret, so it does not leak into a project's env.
    expect(await secrets.valuesFor('p1', 'live')).not.toHaveProperty('DEPLOY_TOKEN');
  });

  it('reaches the scrubber, so a build log cannot echo it back', async () => {
    const values = await secrets.allValuesForUser('u1', 'p1');
    expect(values).toContain('deploy-token-value');
    expect(values).toContain('sk_test_value_long_enough');
  });
});

describe('scope isolation', () => {
  it('a tenant-scoped transaction cannot read a secret, even its own', async () => {
    // Secrets have their own policy scope, separate from the tenant tables and
    // from the OAuth ones, so a SQL mistake in a tool handler cannot become a
    // credential disclosure.
    const asTenant = await cp.sql.transaction(async (tx) => {
      await tx.query(`select set_config('power.user_id', $1, true)`, ['u1']);
      return tx.query(`select name from secrets`);
    });
    expect(asTenant.rows).toEqual([]);
  });

  it('an oauth-scoped transaction cannot read one either', async () => {
    const asOauth = await cp.sql.transaction(async (tx) => {
      await tx.query(`select set_config('power.scope', 'oauth', true)`);
      return tx.query(`select name from secrets`);
    });
    expect(asOauth.rows).toEqual([]);
  });

  it('values are not stored in the clear', async () => {
    const raw = await cp.sql.transaction(async (tx) => {
      await tx.query(`select set_config('power.scope', 'secrets', true)`);
      return tx.query<{ ciphertext: Buffer }>(`select ciphertext from secrets`);
    });
    expect(raw.rows.length).toBeGreaterThan(0);
    for (const row of raw.rows) {
      expect(Buffer.from(row.ciphertext).toString('utf8')).not.toContain('sk_test_value');
    }
  });
});
