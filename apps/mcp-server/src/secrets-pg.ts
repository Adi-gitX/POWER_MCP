/**
 * Secrets that survive a restart, encrypted at rest.
 *
 * `MemorySecrets` was a `Map` with a `setTimeout`, which is fine for one
 * developer and impossible for anything that has to publish: a hosting
 * credential that dies on restart, and that a second node never sees, is not a
 * credential. It also means the account-scoped values that `publish_app` needs
 * have somewhere to live.
 *
 * These rows get their own policy scope, separate from both the tenant tables
 * and the OAuth ones. A tenant-scoped transaction cannot read a secret even
 * for its own project, so a SQL mistake in a tool handler cannot turn into a
 * credential disclosure. Values are AES-256-GCM, so a database dump on its own
 * is not enough either.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Sql } from './pgstore.js';
import { fingerprint, type PendingRequest, type SecretEnv, type SecretRecord, type SecretStore } from './secrets.js';

export const SECRETS_TABLES = ['secrets', 'secret_requests'] as const;

export const SECRETS_SCHEMA_SQL = `
create table if not exists secrets (
  user_id text not null,
  -- null means the value belongs to the account rather than one project, which
  -- is how a hosting token is asked for once and reused for every project.
  project_id text,
  name text not null,
  env text not null check (env in ('workbench','live','both')),
  provider text,
  ciphertext bytea not null,
  iv bytea not null,
  tag bytea not null,
  fingerprint text not null,
  set_at timestamptz not null default now(),
  id bigserial primary key
);
-- Not a primary key over (user_id, project_id, name, env): a primary key
-- cannot contain a null, and project_id is null for account-scoped values.
-- coalesce gives the same uniqueness while allowing it.
create unique index if not exists secrets_key on secrets (user_id, coalesce(project_id, ''), name, env);
create index if not exists secrets_account on secrets (user_id) where project_id is null;

create table if not exists secret_requests (
  token_hash text primary key,
  user_id text not null,
  project_id text,
  scope text not null check (scope in ('project','account')),
  name text not null,
  env text not null,
  provider text,
  why text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz
);
`;

const REQUEST_TTL_MS = 30 * 60 * 1000;
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/**
 * The encryption key.
 *
 * Required outright anywhere that is not loopback: a default key is the same
 * as no encryption, and the one thing worse than an unencrypted secret is an
 * unencrypted secret everyone believes is encrypted.
 */
export function secretKeyFromEnv(env: NodeJS.ProcessEnv, loopback: boolean): Buffer {
  const configured = env.POWER_SECRET_KEY;
  if (configured) {
    const key = Buffer.from(configured, 'base64');
    if (key.length !== 32) throw new Error('POWER_SECRET_KEY must be 32 bytes, base64 encoded');
    return key;
  }
  if (!loopback) {
    throw new Error('POWER_SECRET_KEY must be set: secrets are encrypted at rest and there is no safe default');
  }
  console.warn('[power] POWER_SECRET_KEY is unset; using a development key. Never do this off loopback.');
  return createHash('sha256').update('power-development-key').digest();
}

export class PgSecrets implements SecretStore {
  constructor(
    private readonly sql: Sql,
    private readonly key: Buffer,
  ) {}

  private scoped<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
    return this.sql.transaction(async (tx) => {
      await tx.query(`select set_config('power.scope', 'secrets', true)`);
      return fn(tx);
    });
  }

  private seal(value: string): { ciphertext: Buffer; iv: Buffer; tag: Buffer } {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return { ciphertext, iv, tag: cipher.getAuthTag() };
  }

  private open(row: Sealed): string {
    const decipher = createDecipheriv('aes-256-gcm', this.key, toBuffer(row.iv));
    decipher.setAuthTag(toBuffer(row.tag));
    return Buffer.concat([decipher.update(toBuffer(row.ciphertext)), decipher.final()]).toString('utf8');
  }

  async request(req: Omit<PendingRequest, 'token' | 'expires_at'>): Promise<PendingRequest> {
    const token = randomUUID().replace(/-/g, '') + randomBytes(8).toString('hex');
    const expires_at = new Date(Date.now() + REQUEST_TTL_MS);
    const scope = req.project_id ? 'project' : 'account';
    await this.scoped(async (tx) => {
      await tx.query(
        `insert into secret_requests (token_hash, user_id, project_id, scope, name, env, provider, why, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [sha256(token), req.user_id, req.project_id, scope, req.name, req.env, req.provider, req.why, expires_at],
      );
    });
    return { ...req, token, expires_at: expires_at.toISOString() };
  }

  async pending(token: string): Promise<PendingRequest | null> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<RequestRow>(
        `select * from secret_requests where token_hash = $1 and consumed_at is null and expires_at > now()`,
        [sha256(token)],
      );
      const r = rows[0];
      return r ? { ...toRequest(r), token } : null;
    });
  }

  async set(token: string, value: string): Promise<SecretRecord> {
    const sealed = this.seal(value);
    const print = fingerprint(value);
    return this.scoped(async (tx) => {
      // Consuming and storing in one transaction, so a form submitted twice
      // cannot write two different values under one request.
      const { rows } = await tx.query<RequestRow>(
        `update secret_requests set consumed_at = now()
          where token_hash = $1 and consumed_at is null and expires_at > now()
          returning *`,
        [sha256(token)],
      );
      const req = rows[0];
      if (!req) throw new Error('that link has already been used, or it has expired');

      await tx.query(
        `insert into secrets (user_id, project_id, name, env, provider, ciphertext, iv, tag, fingerprint)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (user_id, coalesce(project_id, ''), name, env) do update
           set ciphertext = excluded.ciphertext, iv = excluded.iv, tag = excluded.tag,
               fingerprint = excluded.fingerprint, provider = excluded.provider, set_at = now()`,
        [req.user_id, req.project_id, req.name, req.env, req.provider, sealed.ciphertext, sealed.iv, sealed.tag, print],
      );
      return { name: req.name, env: req.env, provider: req.provider, fingerprint: print, set_at: new Date().toISOString() };
    });
  }

  async list(projectId: string): Promise<SecretRecord[]> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<SecretRow>(
        `select name, env, provider, fingerprint, set_at from secrets where project_id = $1 order by name`,
        [projectId],
      );
      // Never a value field, so the project page cannot grow one by accident.
      return rows.map((r) => ({
        name: r.name,
        env: r.env,
        provider: r.provider,
        fingerprint: r.fingerprint,
        set_at: new Date(r.set_at).toISOString(),
      }));
    });
  }

  async valuesFor(projectId: string, env: 'workbench' | 'live'): Promise<Record<string, string>> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<SecretRow & Sealed>(
        `select * from secrets where project_id = $1 and env in ($2, 'both')`,
        [projectId, env],
      );
      return Object.fromEntries(rows.map((r) => [r.name, this.open(r)]));
    });
  }

  /** An account-level credential, such as the hosting token. */
  async accountValue(userId: string, name: string): Promise<string | null> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<Sealed>(
        `select ciphertext, iv, tag from secrets where user_id = $1 and project_id is null and name = $2 limit 1`,
        [userId, name],
      );
      return rows[0] ? this.open(rows[0]) : null;
    });
  }

  /**
   * Everything the scrubber must redact from a tool result, including the
   * account-level values — otherwise a hosting token echoed in a build log
   * would reach the model.
   */
  async allValues(projectId: string): Promise<string[]> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<Sealed>(
        `select s.ciphertext, s.iv, s.tag from secrets s
          where s.project_id = $1
             or (s.project_id is null and s.user_id = (select user_id from secrets where project_id = $1 limit 1))`,
        [projectId],
      );
      return rows.map((r) => this.open(r));
    });
  }

  /** Account values for one user, for the scrubber when the project is known by owner. */
  async allValuesForUser(userId: string, projectId: string | null): Promise<string[]> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<Sealed>(
        `select ciphertext, iv, tag from secrets
          where user_id = $1 and (project_id is null or project_id = $2)`,
        [userId, projectId],
      );
      return rows.map((r) => this.open(r));
    });
  }
}

interface Sealed {
  ciphertext: Buffer | Uint8Array;
  iv: Buffer | Uint8Array;
  tag: Buffer | Uint8Array;
}
interface SecretRow {
  name: string;
  env: SecretEnv;
  provider: string | null;
  fingerprint: string;
  set_at: string;
}
interface RequestRow {
  user_id: string;
  project_id: string | null;
  scope: 'project' | 'account';
  name: string;
  env: SecretEnv;
  provider: string | null;
  why: string;
  expires_at: string;
}

const toBuffer = (v: Buffer | Uint8Array): Buffer => (Buffer.isBuffer(v) ? v : Buffer.from(v));

function toRequest(r: RequestRow): Omit<PendingRequest, 'token'> {
  return {
    user_id: r.user_id,
    project_id: r.project_id,
    name: r.name,
    env: r.env,
    provider: r.provider,
    why: r.why,
    expires_at: new Date(r.expires_at).toISOString(),
  };
}
