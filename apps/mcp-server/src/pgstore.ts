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
 * Postgres URL in production through the same `Sql` seam.
 */
import { mkdir } from 'node:fs/promises';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { GateError } from '@power/gates';
import { parseRunState, type RunState } from '@power/runstate';
import { NotFound, type Approvals, type ArtifactName, type Project, type Store } from './store.js';

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

create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id text not null,
  project_id text,
  actor text not null,
  action text not null,
  detail jsonb
);
`;

const CHILD_TABLES = ['runs', 'artifacts', 'gate_errors', 'approvals'];

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
        `select spec_approved_at, spec_approval_requested_at, publish_confirmed_at, migration_confirmed_at from approvals where project_id = $1`,
        [projectId],
      );
      const r = rows[0];
      const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null);
      return {
        spec_approved_at: iso(r?.spec_approved_at),
        spec_approval_requested_at: iso(r?.spec_approval_requested_at),
        publish_confirmed_at: iso(r?.publish_confirmed_at),
        migration_confirmed_at: iso(r?.migration_confirmed_at),
      };
    });
  }

  async putApprovals(projectId: string, a: Approvals): Promise<void> {
    await this.scoped(async (tx) => {
      await tx.query(
        `update approvals set spec_approved_at = $2, spec_approval_requested_at = $3, publish_confirmed_at = $4, migration_confirmed_at = $5 where project_id = $1`,
        [projectId, a.spec_approved_at, a.spec_approval_requested_at, a.publish_confirmed_at, a.migration_confirmed_at],
      );
      await tx.query(`insert into audit_log (user_id, project_id, actor, action, detail) values ($1,$2,'browser','approvals',$3)`, [
        this.userId,
        projectId,
        JSON.stringify(a),
      ]);
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

export interface ControlPlane {
  sql: Sql;
  ensureUser(userId: string, plan?: 'free' | 'pro' | 'power'): Promise<void>;
  planOf(userId: string): Promise<'free' | 'pro' | 'power'>;
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
  await db.exec(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'power_app') then create role power_app nologin; end if; end $$;`);
  await db.exec(rlsSql('power_app'));
  await db.exec(`grant usage, select on all sequences in schema public to power_app; grant select, insert, update on users to power_app;`);
  // Everything after this point runs as the app role: RLS is live.
  await db.exec(`set role power_app`);

  const sql = new PgliteSql(db);
  return {
    sql,
    async ensureUser(userId, plan = 'free') {
      await sql.query(`insert into users (id, plan) values ($1,$2) on conflict (id) do nothing`, [userId, plan]);
    },
    async planOf(userId) {
      const { rows } = await sql.query<{ plan: 'free' | 'pro' | 'power' }>(`select plan from users where id = $1`, [userId]);
      return rows[0]?.plan ?? 'free';
    },
    storeFor: (userId) => new PgStore(sql, userId),
    close: () => db.close(),
  };
}
