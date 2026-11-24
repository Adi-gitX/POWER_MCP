/**
 * The control-plane store on Postgres, with row-level security from day one.
 *
 * Every tenant table carries `user_id`, RLS is enabled and forced, and the
 * policy compares against a session setting (`power.user_id`) that the store
 * sets at the start of every transaction. The application role is not the
 * table owner, so `FORCE ROW LEVEL SECURITY` applies to it. A query that
 * forgets to scope by user returns nothing rather than everything.
 *
 * Retrofitting RLS onto a live multi-tenant schema is one of the most
 * miserable projects in software; doing it now, while the schema is six tables,
 * costs an afternoon.
 *
 * Runs on PGlite locally (a real Postgres, in-process, on disk) and on any
 * Postgres URL in production through the same `Sql` seam. Both openers below
 * produce the same `ControlPlane`, and `infra.test.ts` runs the isolation
 * suite against whichever backends are available.
 */
import { mkdir } from 'node:fs/promises';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { Pool, type PoolClient } from 'pg';
import type { GateError } from '@power/gates';
import { parseRunState, type RunState } from '@power/runstate';
import { OAUTH_SCHEMA_SQL, OAUTH_TABLES } from './oauth/schema.js';
import { PgOAuthStore, type OAuthStore } from './oauth/store.js';
import { SECRETS_SCHEMA_SQL, SECRETS_TABLES } from './secrets-pg.js';
import { NotFound, type Approvals, type ArtifactName, type DeploymentRecord, type Project, type Store } from './store.js';

/** The minimum surface the store needs from a Postgres client. */
export interface Sql {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
}

export const SCHEMA_SQL = `
create table if not exists users (
  id text primary key,
  plan text not null default 'free' check (plan in ('free','pro','power')),
  created_at timestamptz not null default now()
);
-- Where the person is in first-run setup: which assistant they chose, whether
-- they took the skill, and which hosting account they connected. No secrets:
-- the hosting token itself lives in the encrypted secrets store.
alter table users add column if not exists setup jsonb not null default '{}'::jsonb;

create table if not exists projects (
  id text primary key,
  user_id text not null references users(id),
  name text not null,
  slug text not null,
  created_at timestamptz not null default now()
);

create table if not exists runs (
  project_id text primary key references projects(id) on delete cascade,
  user_id text not null,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists artifacts (
  project_id text not null references projects(id) on delete cascade,
  user_id text not null,
  name text not null,
  body text not null,
  updated_at timestamptz not null default now(),
  primary key (project_id, name)
);

create table if not exists gate_errors (
  project_id text not null references projects(id) on delete cascade,
  user_id text not null,
  stage text not null,
  errors jsonb not null,
  primary key (project_id, stage)
);

create table if not exists approvals (
  project_id text primary key references projects(id) on delete cascade,
  user_id text not null,
  spec_approved_at timestamptz,
  spec_approval_requested_at timestamptz,
  publish_confirmed_at timestamptz,
  migration_confirmed_at timestamptz
);
alter table approvals add column if not exists migration_confirmed_at timestamptz;
alter table approvals add column if not exists unpublish_confirmed_at timestamptz;

create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id text not null,
  project_id text,
  actor text not null,
  action text not null,
  detail jsonb
);

create table if not exists deployments (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  user_id text not null,
  provider text not null,
  target text not null check (target in ('production','preview')),
  version text,
  commit text,
  url text not null,
  ready_state text not null,
  deploy_project_name text not null,
  created_at timestamptz not null default now()
);
create index if not exists deployments_project on deployments (project_id, target, created_at desc);
-- A rollback promotes an existing release; it does not create a new one, so
-- the live pointer has to be a separate timestamp rather than created_at.
alter table deployments add column if not exists promoted_at timestamptz;
`;

const CHILD_TABLES = ['runs', 'artifacts', 'gate_errors', 'approvals', 'deployments'];

/**
 * RLS. Idempotent, so it can run on every boot.
 *
 * `projects` is scoped by its own `user_id`. Every child table is scoped by
 * *project ownership*: the row's `user_id` must match the session AND its
 * `project_id` must resolve through the (RLS-filtered) `projects` table. The
 * first check alone was not enough — a tenant could insert a child row carrying
 * their own `user_id` against someone else's project id, and then the real
 * owner's upsert collided with it. Found by the test that tries exactly that.
 */
export function rlsSql(appRole: string): string {
  const me = `current_setting('power.user_id', true)`;
  const policy = (t: string, predicate: string) => `
alter table ${t} enable row level security;
alter table ${t} force row level security;
drop policy if exists tenant_isolation on ${t};
create policy tenant_isolation on ${t} using (${predicate}) with check (${predicate});
grant select, insert, update, delete on ${t} to ${appRole};`;

  const owned = `user_id = ${me} and exists (select 1 from projects p where p.id = project_id)`;
  return [
    policy('projects', `user_id = ${me}`),
    ...CHILD_TABLES.map((t) => policy(t, owned)),
    policy('audit_log', `user_id = ${me}`),
  ].join('\n');
}

/**
 * The second scope.
 *
 * OAuth rows belong to the server, so they are gated on `power.scope` instead
 * of `power.user_id`. The two settings are never both set, which makes the
 * scopes mutually exclusive: a tenant transaction reads zero rows from these
 * tables, and an OAuth transaction reads zero rows from the tenant tables.
 * `infra.test.ts` asserts the first half, because it is the one that would be
 * a privilege escalation rather than merely a bug.
 */
export function scopedRlsSql(appRole: string, scope: string, tables: readonly string[]): string {
  const inScope = `current_setting('power.scope', true) = '${scope}'`;
  return tables
    .map(
      (t) => `
alter table ${t} enable row level security;
alter table ${t} force row level security;
drop policy if exists ${scope}_scope on ${t};
create policy ${scope}_scope on ${t} using (${inScope}) with check (${inScope});
grant select, insert, update, delete on ${t} to ${appRole};`,
    )
    .join('\n');
}

export const oauthRlsSql = (appRole: string): string => scopedRlsSql(appRole, 'oauth', OAUTH_TABLES);
/** Secrets get a scope of their own, so not even an OAuth transaction can read a value. */
export const secretsRlsSql = (appRole: string): string => scopedRlsSql(appRole, 'secrets', SECRETS_TABLES);

export class PgStore implements Store {
  constructor(
    private readonly sql: Sql,
    private readonly userId: string,
  ) {}

  /** Every statement runs inside a transaction that has set the tenant. */
  private async scoped<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
    return this.sql.transaction(async (tx) => {
      await tx.query(`select set_config('power.user_id', $1, true)`, [this.userId]);
      return fn(tx);
    });
  }

  async createProject(project: Project, state: RunState): Promise<void> {
    await this.scoped(async (tx) => {
      await tx.query(`insert into projects (id, user_id, name, slug, created_at) values ($1,$2,$3,$4,$5)`, [
        project.id,
        this.userId,
        project.name,
        project.slug,
        project.created_at,
      ]);
      await tx.query(`insert into runs (project_id, user_id, state) values ($1,$2,$3)`, [project.id, this.userId, JSON.stringify(state)]);
      await tx.query(`insert into approvals (project_id, user_id) values ($1,$2)`, [project.id, this.userId]);
      await tx.query(`insert into audit_log (user_id, project_id, actor, action) values ($1,$2,'mcp','create_project')`, [this.userId, project.id]);
    });
  }

  async getProject(id: string): Promise<Project | null> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<Project & { created_at: Date | string }>(`select id, name, slug, created_at from projects where id = $1`, [id]);
      const r = rows[0];
      return r ? { ...r, created_at: new Date(r.created_at).toISOString() } : null;
    });
  }

  async listProjects(): Promise<Project[]> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<Project & { created_at: Date | string }>(`select id, name, slug, created_at from projects order by created_at desc`);
      return rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
    });
  }

  async renameProject(id: string, name: string): Promise<Project> {
    return this.scoped(async (tx) => {
      // Row-level security scopes the update to this user's project; a rename
      // of someone else's project matches no row and is reported as missing
      // rather than forbidden, which is the same answer either way.
      const { rows } = await tx.query<Project & { created_at: Date | string }>(
        `update projects set name = $2 where id = $1 returning id, name, slug, created_at`,
        [id, name],
      );
      const row = rows[0];
      if (!row) throw new NotFound(`project ${id}`);
      await tx.query(`insert into audit_log (user_id, project_id, actor, action) values ($1,$2,'web','rename_project')`, [
        this.userId,
        id,
      ]);
      return { ...row, created_at: new Date(row.created_at).toISOString() };
    });
  }

  async getRun(projectId: string): Promise<RunState> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<{ state: unknown }>(`select state from runs where project_id = $1`, [projectId]);
      if (!rows[0]) throw new NotFound(`run for project ${projectId}`);
      return parseRunState(JSON.stringify(rows[0].state));
    });
  }

  async putRun(projectId: string, state: RunState): Promise<void> {
    await this.scoped(async (tx) => {
      await tx.query(`update runs set state = $2, updated_at = now() where project_id = $1`, [projectId, JSON.stringify(state)]);
      await tx.query(`insert into audit_log (user_id, project_id, actor, action, detail) values ($1,$2,'mcp','run_state',$3)`, [
        this.userId,
        projectId,
        JSON.stringify({ phase: state.phase, last: state.history.at(-1)?.event ?? null }),
      ]);
    });
  }

  async putArtifact(projectId: string, name: ArtifactName, raw: string): Promise<void> {
    await this.scoped((tx) =>
      tx.query(
        `insert into artifacts (project_id, user_id, name, body) values ($1,$2,$3,$4)
         on conflict (project_id, name) do update set body = excluded.body, updated_at = now()`,
        [projectId, this.userId, name, raw],
      ),
    );
  }

  async getArtifacts(projectId: string): Promise<Partial<Record<ArtifactName, string>>> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<{ name: ArtifactName; body: string }>(`select name, body from artifacts where project_id = $1`, [projectId]);
      return Object.fromEntries(rows.map((r) => [r.name, r.body]));
    });
  }

  async putGateErrors(projectId: string, stage: string, errors: GateError[]): Promise<void> {
    await this.scoped((tx) =>
      tx.query(
        `insert into gate_errors (project_id, user_id, stage, errors) values ($1,$2,$3,$4)
         on conflict (project_id, stage) do update set errors = excluded.errors`,
        [projectId, this.userId, stage, JSON.stringify(errors)],
      ),
    );
  }

  async getGateErrors(projectId: string): Promise<Partial<Record<string, GateError[]>>> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<{ stage: string; errors: GateError[] }>(`select stage, errors from gate_errors where project_id = $1`, [projectId]);
      return Object.fromEntries(rows.map((r) => [r.stage, r.errors]));
    });
  }

  async getApprovals(projectId: string): Promise<Approvals> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<Record<keyof Approvals, Date | string | null>>(
        `select spec_approved_at, spec_approval_requested_at, publish_confirmed_at, migration_confirmed_at, unpublish_confirmed_at from approvals where project_id = $1`,
        [projectId],
      );
      const r = rows[0];
      const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null);
      return {
        spec_approved_at: iso(r?.spec_approved_at),
        spec_approval_requested_at: iso(r?.spec_approval_requested_at),
        publish_confirmed_at: iso(r?.publish_confirmed_at),
        migration_confirmed_at: iso(r?.migration_confirmed_at),
        unpublish_confirmed_at: iso(r?.unpublish_confirmed_at),
      };
    });
  }

  async putApprovals(projectId: string, a: Approvals): Promise<void> {
    await this.scoped(async (tx) => {
      await tx.query(
        `update approvals set spec_approved_at = $2, spec_approval_requested_at = $3, publish_confirmed_at = $4, migration_confirmed_at = $5, unpublish_confirmed_at = $6 where project_id = $1`,
        [projectId, a.spec_approved_at, a.spec_approval_requested_at, a.publish_confirmed_at, a.migration_confirmed_at, a.unpublish_confirmed_at],
      );
      await tx.query(`insert into audit_log (user_id, project_id, actor, action, detail) values ($1,$2,'browser','approvals',$3)`, [
        this.userId,
        projectId,
        JSON.stringify(a),
      ]);
    });
  }

  async putDeployment(d: DeploymentRecord): Promise<void> {
    await this.scoped(async (tx) => {
      await tx.query(
        `insert into deployments (id, project_id, user_id, provider, target, version, commit, url, ready_state, deploy_project_name, promoted_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict (id) do update set ready_state = excluded.ready_state, url = excluded.url, promoted_at = excluded.promoted_at`,
        [d.id, d.project_id, this.userId, d.provider, d.target, d.version, d.commit, d.url, d.ready_state, d.deploy_project_name, d.promoted_at ?? null],
      );
    });
  }

  async latestDeployment(projectId: string, target: 'production' | 'preview'): Promise<DeploymentRecord | null> {
    return (await this.listDeployments(projectId, target, 1))[0] ?? null;
  }

  async listDeployments(projectId: string, target: 'production' | 'preview', limit = 10): Promise<DeploymentRecord[]> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<DeploymentRecord & { created_at: string | Date }>(
        `select id, project_id, provider, target, version, commit, url, ready_state, deploy_project_name, created_at, promoted_at
           from deployments where project_id = $1 and target = $2
           order by coalesce(promoted_at, created_at) desc limit $3`,
        [projectId, target, limit],
      );
      return rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
    });
  }
}

// ---------------------------------------------------------------- PGlite adapter

export class PgliteSql implements Sql {
  constructor(private readonly db: PGlite | Transaction) {}
  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    const r = await this.db.query<T>(sql, params);
    return { rows: r.rows };
  }
  async transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
    if (!('transaction' in this.db)) return fn(this); // already inside one
    return this.db.transaction((tx) => fn(new PgliteSql(tx)));
  }
}

export interface SetupState {
  /** The assistant they build with, an id from the setup catalog. */
  platform?: string;
  skill_downloaded_at?: string;
  /** Which platform's copy was downloaded; each one says how its client connects. */
  skill_platform?: string;
  /** The hosting account the saved token belongs to, for display only. */
  vercel_account?: string;
  vercel_team?: string;
  vercel_connected_at?: string;
  vercel_skipped_at?: string;
  completed_at?: string;
  /** Power Up for new runs: research, an approved plan and verification. Off unless turned on. */
  power_up?: boolean;
  /** Project id -> when an assistant first made a call on it, for the hand-off page. */
  handoffs?: Record<string, string>;
  /** The installer reported back: skill written, client configured. */
  installer_ran_at?: string;
  installer_platform?: string;
  /** First MCP call from a tool holding this account's connection token. */
  mcp_connected_at?: string;
  mcp_client?: string;
  /** How Vercel was connected: the OAuth integration or a pasted token. */
  vercel_via?: 'oauth' | 'token';
}

function setupMethods(sql: Sql): Pick<ControlPlane, 'getSetup' | 'updateSetup'> {
  return {
    async getSetup(userId) {
      const { rows } = await sql.query<{ setup: SetupState | null }>(`select setup from users where id = $1`, [userId]);
      return rows[0]?.setup ?? {};
    },
    async updateSetup(userId, patch) {
      const { rows } = await sql.query<{ setup: SetupState }>(
        `update users set setup = coalesce(setup, '{}'::jsonb) || $2::jsonb where id = $1 returning setup`,
        [userId, JSON.stringify(patch)],
      );
      return rows[0]?.setup ?? {};
    },
  };
}

export interface ControlPlane {
  sql: Sql;
  /** Server-owned OAuth state, in its own policy scope. */
  oauth: OAuthStore;
  ensureUser(userId: string, plan?: 'free' | 'pro' | 'power'): Promise<void>;
  planOf(userId: string): Promise<'free' | 'pro' | 'power'>;
  /** First-run setup progress for one account. Empty until they start it. */
  getSetup(userId: string): Promise<SetupState>;
  /** Merge fields into the account's setup progress. */
  updateSetup(userId: string, patch: Partial<SetupState>): Promise<SetupState>;
  storeFor(userId: string): Store;
  close(): Promise<void>;
}

/**
 * Open the control plane on PGlite. Creates the schema and — because PGlite
 * runs as a superuser, which RLS never applies to — a non-owner `power_app`
 * role and switches to it, so the policies are genuinely enforced locally too.
 */
export async function openPgliteControlPlane(dir: string): Promise<ControlPlane> {
  await mkdir(dir, { recursive: true }); // PGlite does not create parent directories.
  const db = new PGlite(dir);
  await db.waitReady;
  await db.exec(SCHEMA_SQL);
  await db.exec(OAUTH_SCHEMA_SQL);
  await db.exec(SECRETS_SCHEMA_SQL);
  await db.exec(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'power_app') then create role power_app nologin; end if; end $$;`);
  await db.exec(rlsSql('power_app'));
  await db.exec(oauthRlsSql('power_app'));
  await db.exec(secretsRlsSql('power_app'));
  await db.exec(`grant usage, select on all sequences in schema public to power_app; grant select, insert, update on users to power_app;`);
  // Everything after this point runs as the app role: RLS is live.
  await db.exec(`set role power_app`);

  const sql = new PgliteSql(db);
  return {
    sql,
    oauth: new PgOAuthStore(sql),
    async ensureUser(userId, plan = 'free') {
      await sql.query(`insert into users (id, plan) values ($1,$2) on conflict (id) do nothing`, [userId, plan]);
    },
    async planOf(userId) {
      const { rows } = await sql.query<{ plan: 'free' | 'pro' | 'power' }>(`select plan from users where id = $1`, [userId]);
      return rows[0]?.plan ?? 'free';
    },
    ...setupMethods(sql),
    storeFor: (userId) => new PgStore(sql, userId),
    close: () => db.close(),
  };
}

/** Role and identifier names are interpolated into DDL, so they are checked. */
function assertIdentifier(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unsafe SQL identifier: ${name}`);
  return name;
}

/**
 * The same `Sql` seam over node-postgres.
 *
 * A pool-backed instance checks out a client per transaction. A client-backed
 * one is already inside a transaction, so a nested `transaction()` reuses it
 * rather than checking out a second connection and deadlocking against itself
 * — the same reason `PgliteSql` returns `fn(this)` when it has no `transaction`.
 */
export class PgSql implements Sql {
  constructor(private readonly db: Pool | PoolClient) {}

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    const result = await this.db.query(sql, params);
    return { rows: result.rows as T[] };
  }

  async transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
    if ('release' in this.db) return fn(this); // already inside one
    const client = await this.db.connect();
    try {
      await client.query('begin');
      const out = await fn(new PgSql(client));
      await client.query('commit');
      return out;
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

export interface PgControlPlaneOptions {
  /** The non-owner role queries run as, so `force row level security` applies. */
  appRole?: string;
  /** Apply the schema and policies on boot. Idempotent. */
  migrate?: boolean;
  maxConnections?: number;
}

/**
 * Open the control plane on a real Postgres.
 *
 * Migrations run once on their own connection as whoever owns the tables. The
 * serving pool then connects with `-c role=<appRole>` so the role is in force
 * from the first statement — a `SET ROLE` in a pool `connect` handler is not
 * awaited before the client is handed out, which would leave a window where a
 * query runs as the owner and silently bypasses every policy.
 */
/**
 * An arbitrary but stable key for the boot-time migration lock. Any constant
 * works as long as every node agrees on it; it is written out as a literal so
 * grepping the number in a `pg_locks` row leads back here.
 */
const MIGRATION_LOCK_KEY = 8_070_145_921_001;

export async function openPgControlPlane(
  connectionString: string,
  options: PgControlPlaneOptions = {},
): Promise<ControlPlane> {
  const appRole = assertIdentifier(options.appRole ?? 'power_app');

  if (options.migrate ?? true) {
    const owner = new Pool({ connectionString, max: 1 });
    try {
      // One migrator at a time. The policy statements below drop and recreate,
      // so two nodes booting together -- which is the normal case for a rolling
      // deploy -- can otherwise interleave and leave a table with row-level
      // security enabled and no policy on it, which reads as an empty database.
      // pg_advisory_lock blocks until it is free, so the loser waits and then
      // re-runs statements that are all idempotent.
      await owner.query(`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`);
      await owner.query(SCHEMA_SQL);
      await owner.query(OAUTH_SCHEMA_SQL);
      await owner.query(SECRETS_SCHEMA_SQL);
      await owner.query(
        `do $$ begin if not exists (select 1 from pg_roles where rolname = '${appRole}') then create role ${appRole} nologin; end if; end $$;`,
      );
      await owner.query(rlsSql(appRole));
      await owner.query(oauthRlsSql(appRole));
      await owner.query(secretsRlsSql(appRole));
      await owner.query(`grant usage, select on all sequences in schema public to ${appRole}`);
      await owner.query(`grant select, insert, update on users to ${appRole}`);
      await owner.query(`grant ${appRole} to current_user`);
    } finally {
      // Ending the pool would drop the session and release the lock anyway;
      // doing it explicitly keeps the intent legible and survives someone
      // later deciding to reuse this connection.
      await owner.query(`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`).catch(() => undefined);
      await owner.end();
    }
  }

  const pool = new Pool({
    connectionString,
    max: options.maxConnections ?? 10,
    options: `-c role=${appRole}`,
  });

  // Fail loudly at boot rather than quietly serving every tenant every row.
  const { rows } = await pool.query<{ role: string }>(`select current_setting('role') as role`);
  if (rows[0]?.role !== appRole) {
    await pool.end();
    throw new Error(
      `control plane connected as role "${rows[0]?.role ?? 'unknown'}" instead of "${appRole}"; ` +
        `row-level security would not be enforced, so refusing to start`,
    );
  }

  const sql = new PgSql(pool);
  return {
    sql,
    oauth: new PgOAuthStore(sql),
    async ensureUser(userId, plan = 'free') {
      await sql.query(`insert into users (id, plan) values ($1,$2) on conflict (id) do nothing`, [userId, plan]);
    },
    async planOf(userId) {
      const { rows } = await sql.query<{ plan: 'free' | 'pro' | 'power' }>(`select plan from users where id = $1`, [userId]);
      return rows[0]?.plan ?? 'free';
    },
    ...setupMethods(sql),
    storeFor: (userId) => new PgStore(sql, userId),
    close: () => pool.end(),
  };
}
