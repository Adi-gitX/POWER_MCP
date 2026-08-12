/**
 * @power/sdk — what a generated app imports for its managed services.
 *
 * This package exists to make one sentence true: *an exported project runs
 * unchanged outside Power.* Every managed capability the assistant writes
 * against goes through an interface here, and there are two implementations
 * of each from the first commit:
 *
 *   PowerAdapter     — inside Power. Reads the connection details Power injects.
 *   SelfHostAdapter  — anywhere else. Reads ordinary environment variables that
 *                      the exported `.env` and `docker-compose.yml` provide.
 *
 * The rule the export CI gate enforces: if an app compiles and its tests pass
 * against `PowerAdapter`, they pass against `SelfHostAdapter` with no code
 * change. A capability that only works inside Power is a capability that must
 * not be in this file.
 *
 * Which adapter is active is decided by the environment, never by the app.
 * `POWER_ENV` is set only inside Power's sandboxes.
 */
import pg from 'pg';

export type Environment = 'workbench' | 'live' | 'self-hosted';

// ---------------------------------------------------------------- database

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  close(): Promise<void>;
}

class PgDb implements Db {
  private pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 5 });
  }
  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const { rows } = await this.pool.query<T & pg.QueryResultRow>(sql, params);
    return rows;
  }
  async one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.query<T>(sql, params))[0] ?? null;
  }
  close(): Promise<void> {
    return this.pool.end();
  }
}

// ---------------------------------------------------------------- storage

export interface Storage {
  put(key: string, body: Uint8Array | string, contentType?: string): Promise<{ key: string }>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  /** A URL a browser can fetch for `ttlSeconds`. Never longer than 15 minutes. */
  signedUrl(key: string, ttlSeconds?: number): Promise<string>;
}

// ---------------------------------------------------------------- email

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Email {
  send(mail: Mail): Promise<{ id: string }>;
}

// ---------------------------------------------------------------- the adapter

export interface Adapter {
  env: Environment;
  db: Db;
  storage: Storage;
  email: Email;
}

export interface AdapterOptions {
  env?: NodeJS.ProcessEnv;
  /** Injected for tests. Defaults to a real Postgres pool. */
  makeDb?: (connectionString: string) => Db;
  makeStorage?: (opts: { kind: 'power' | 's3' | 'fs'; env: NodeJS.ProcessEnv }) => Storage;
  makeEmail?: (opts: { kind: 'power' | 'resend' | 'console'; env: NodeJS.ProcessEnv }) => Email;
}

const MAX_SIGNED_URL_TTL = 15 * 60;

/**
 * Inside Power. Power injects DATABASE_URL for the right branch (workbench or
 * live), POWER_STORAGE_URL and POWER_EMAIL_URL for the managed services, and
 * POWER_ENV to say which environment this process is.
 */
export function PowerAdapter(options: AdapterOptions = {}): Adapter {
  const env = options.env ?? process.env;
  const environment = env.POWER_ENV as Environment | undefined;
  if (environment !== 'workbench' && environment !== 'live') {
    throw new Error('PowerAdapter requires POWER_ENV=workbench|live. Outside Power, use SelfHostAdapter().');
  }
  return {
    env: environment,
    db: (options.makeDb ?? ((url) => new PgDb(url)))(required(env, 'DATABASE_URL')),
    storage: (options.makeStorage ?? defaultStorage)({ kind: 'power', env }),
    email: (options.makeEmail ?? defaultEmail)({ kind: 'power', env }),
  };
}

/**
 * Anywhere else. Ordinary environment variables, all of which the exported
 * `.env` provides with working local values:
 *
 *   DATABASE_URL          postgres://…        (docker-compose provides Postgres)
 *   STORAGE_DIR           ./data/storage      (or S3_* variables for object storage)
 *   RESEND_API_KEY        optional; without it, mail is logged to stdout
 */
export function SelfHostAdapter(options: AdapterOptions = {}): Adapter {
  const env = options.env ?? process.env;
  return {
    env: 'self-hosted',
    db: (options.makeDb ?? ((url) => new PgDb(url)))(required(env, 'DATABASE_URL')),
    storage: (options.makeStorage ?? defaultStorage)({ kind: env.S3_BUCKET ? 's3' : 'fs', env }),
    email: (options.makeEmail ?? defaultEmail)({ kind: env.RESEND_API_KEY ? 'resend' : 'console', env }),
  };
}

/** The one call an app makes. The environment picks the adapter. */
export function power(options: AdapterOptions = {}): Adapter {
  const env = options.env ?? process.env;
  return env.POWER_ENV ? PowerAdapter(options) : SelfHostAdapter(options);
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Inside Power it is injected automatically; self-hosted, copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

// ---------------------------------------------------------------- default drivers

function defaultStorage({ kind, env }: { kind: 'power' | 's3' | 'fs'; env: NodeJS.ProcessEnv }): Storage {
  if (kind === 'fs' || kind === 'power') return fsStorage(env.STORAGE_DIR ?? './data/storage');
  // S3-compatible (R2, MinIO, S3). Kept out of v0 on purpose: the interface is
  // what matters, and fs storage behind a volume is enough to prove export works.
  throw new Error('S3 storage driver is not included in this build; set STORAGE_DIR to use local storage.');
}

function fsStorage(dir: string): Storage {
  const path = () => import('node:path');
  const fs = () => import('node:fs/promises');
  const safe = async (key: string) => {
    const p = await path();
    const base = p.resolve(dir);
    const target = p.resolve(base, key);
    if (!target.startsWith(base + p.sep)) throw new Error(`invalid storage key: ${key}`);
    return target;
  };
  return {
    async put(key, body) {
      const f = await fs();
      const p = await path();
      const target = await safe(key);
      await f.mkdir(p.dirname(target), { recursive: true });
      await f.writeFile(target, body);
      return { key };
    },
    async get(key) {
      const f = await fs();
      try {
        return new Uint8Array(await f.readFile(await safe(key)));
      } catch {
        return null;
      }
    },
    async delete(key) {
      const f = await fs();
      await f.rm(await safe(key), { force: true });
    },
    async signedUrl(key, ttlSeconds = MAX_SIGNED_URL_TTL) {
      const ttl = Math.min(ttlSeconds, MAX_SIGNED_URL_TTL);
      const expires = Math.floor(Date.now() / 1000) + ttl;
      // Local storage is served by the app's own server.ts at /storage/:key.
      return `/storage/${encodeURIComponent(key)}?expires=${expires}`;
    },
  };
}

function defaultEmail({ kind, env }: { kind: 'power' | 'resend' | 'console'; env: NodeJS.ProcessEnv }): Email {
  if (kind === 'resend') {
    const key = env.RESEND_API_KEY!;
    const from = env.MAIL_FROM ?? 'app@example.com';
    return {
      async send(mail) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from, ...mail }),
        });
        if (!res.ok) throw new Error(`resend: ${res.status} ${await res.text()}`);
        return (await res.json()) as { id: string };
      },
    };
  }
  // 'power' in v0 and 'console' both log: the managed mail relay arrives with
  // the hosted control plane, behind this same interface.
  return {
    async send(mail) {
      const id = `mail_${Date.now().toString(36)}`;
      console.log(`[mail ${id}] to=${mail.to} subject=${JSON.stringify(mail.subject)}\n${mail.text}`);
      return { id };
    },
  };
}
