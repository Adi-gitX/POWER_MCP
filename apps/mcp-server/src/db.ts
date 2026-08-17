/**
 * The project database, behind a driver with two branches.
 *
 * Every project database has exactly two branches the user can see:
 *
 *   live       "Your live app"   — written only by promote_migration
 *   workbench  "Safe copy"       — written freely by the assistant
 *
 * plus scratch branches the driver creates from live to rehearse a migration
 * and throws away. There is no operation on this interface that runs arbitrary
 * SQL against live. That absence is the product.
 *
 * `PgliteDriver` runs a real Postgres (PGlite, in-process) per branch, on disk
 * under the project's data directory. Branching is a directory copy; on Neon it
 * is a copy-on-write API call. Both satisfy the same interface and the same
 * migration gate.
 */
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { judgeMigration, touchedTables, type MigrationProposal, type MigrationVerdict, type Rehearsal } from '@power/gates';

export type Branch = 'live' | 'workbench';

export interface QueryResult {
  rows: Record<string, unknown>[];
  row_count: number;
  truncated: boolean;
  columns: string[];
}

export interface SchemaTable {
  name: string;
  columns: { name: string; type: string; nullable: boolean; default: string | null }[];
}

export interface DbDriver {
  provision(projectId: string): Promise<{ created: boolean }>;
  exists(projectId: string): Promise<boolean>;
  schema(projectId: string, branch: Branch): Promise<SchemaTable[]>;
  /** Reads only, row-capped, workbench only. Enforced here, not by the caller. */
  query(projectId: string, sql: string, limit: number): Promise<QueryResult>;
  /** Apply to the workbench so the assistant can build against the new shape. */
  applyToWorkbench(projectId: string, sql: string): Promise<void>;
  /** Rehearse on a scratch copy of live, judge, and record the verdict. */
  rehearse(projectId: string, proposal: MigrationProposal): Promise<MigrationVerdict>;
  /** Snapshot live, apply up_sql in a transaction. Only after a passed verdict. */
  promote(projectId: string, proposal: MigrationProposal): Promise<{ snapshot: string }>;
  /** Restore live from a snapshot taken by promote. */
  restoreLive(projectId: string, snapshot: string): Promise<void>;
  /** Reset the workbench to a fresh copy of live. */
  refreshWorkbench(projectId: string): Promise<void>;
  close(): Promise<void>;
}

export class DbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbError';
  }
}

const READ_ONLY = /^\s*(select|with|show|explain|table|values)\b/i;
const FORBIDDEN_IN_READ = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum)\b/i;

/** Canonical schema text: what the migration gate compares before/after. */
const SCHEMA_SQL = `
  select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns
  where table_schema = 'public'
  order by table_name, ordinal_position`;

const TABLES_SQL = `
  select table_name from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`;

export class PgliteDriver implements DbDriver {
  private open = new Map<string, PGlite>();

  constructor(private readonly root: string) {}

  private dir(projectId: string, branch: string): string {
    return join(this.root, 'db', projectId, branch);
  }

  private async db(projectId: string, branch: string): Promise<PGlite> {
    const key = `${projectId}/${branch}`;
    let db = this.open.get(key);
    if (!db) {
      // PGlite does not create parent directories.
      await mkdir(this.dir(projectId, branch), { recursive: true });
      db = new PGlite(this.dir(projectId, branch));
      await db.waitReady;
      this.open.set(key, db);
    }
    return db;
  }

  private async closeBranch(projectId: string, branch: string): Promise<void> {
    const key = `${projectId}/${branch}`;
    const db = this.open.get(key);
    if (db) {
      await db.close();
      this.open.delete(key);
    }
  }

  /** Copy one branch's on-disk state to another. Both must be closed. */
  private async copyBranch(projectId: string, from: string, to: string): Promise<void> {
    await this.closeBranch(projectId, from);
    await this.closeBranch(projectId, to);
    await rm(this.dir(projectId, to), { recursive: true, force: true });
    await mkdir(join(this.root, 'db', projectId), { recursive: true });
    await cp(this.dir(projectId, from), this.dir(projectId, to), { recursive: true });
  }

  async exists(projectId: string): Promise<boolean> {
    try {
      await stat(this.dir(projectId, 'live'));
      return true;
    } catch {
      return false;
    }
  }

  async provision(projectId: string): Promise<{ created: boolean }> {
    if (await this.exists(projectId)) return { created: false };
    const live = await this.db(projectId, 'live');
    await live.query('select 1');
    await this.copyBranch(projectId, 'live', 'workbench');
    return { created: true };
  }

  async schema(projectId: string, branch: Branch): Promise<SchemaTable[]> {
    const db = await this.db(projectId, branch);
    const { rows } = await db.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(SCHEMA_SQL);
    const tables = new Map<string, SchemaTable>();
    for (const r of rows) {
      const t = tables.get(r.table_name) ?? { name: r.table_name, columns: [] };
      t.columns.push({ name: r.column_name, type: r.data_type, nullable: r.is_nullable === 'YES', default: r.column_default });
      tables.set(r.table_name, t);
    }
    return [...tables.values()];
  }

  async query(projectId: string, sql: string, limit: number): Promise<QueryResult> {
    if (!READ_ONLY.test(sql) || FORBIDDEN_IN_READ.test(sql)) {
      throw new DbError('query_database is read-only. Use propose_migration for schema changes and your app code for writes.');
    }
    const db = await this.db(projectId, 'workbench');
    const result = await db.transaction(async (tx) => {
      await tx.query('set transaction read only');
      return tx.query<Record<string, unknown>>(sql);
    });
    const rows = result.rows.slice(0, limit);
    return {
      rows,
      row_count: rows.length,
      truncated: result.rows.length > limit,
      columns: result.fields.map((f) => f.name),
    };
  }

  async applyToWorkbench(projectId: string, sql: string): Promise<void> {
    const db = await this.db(projectId, 'workbench');
    await db.exec(sql);
  }

  private async canonicalSchema(db: PGlite): Promise<string> {
    const { rows } = await db.query(SCHEMA_SQL);
    return JSON.stringify(rows);
  }

  private async rowCounts(db: PGlite, tables: string[]): Promise<Record<string, number>> {
    const existing = new Set((await db.query<{ table_name: string }>(TABLES_SQL)).rows.map((r) => r.table_name));
    const out: Record<string, number> = {};
    for (const t of tables) {
      if (!existing.has(t)) continue;
      const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from "${t}"`);
      out[t] = rows[0]?.n ?? 0;
    }
    return out;
  }

  async rehearse(projectId: string, proposal: MigrationProposal): Promise<MigrationVerdict> {
    if (!(await this.exists(projectId))) throw new DbError('no database yet. Call provision_database first.');
    const scratch = `scratch_${Date.now()}`;
    await this.copyBranch(projectId, 'live', scratch);
    try {
      const db = await this.db(projectId, scratch);
      const tables = [...new Set([...touchedTables(proposal.up_sql), ...touchedTables(proposal.down_sql)])];
      const rehearsal: Rehearsal = {
        up_ok: false,
        down_ok: false,
        schema_before: await this.canonicalSchema(db),
        schema_after_up: '',
        schema_after_down: '',
        row_counts: await this.rowCounts(db, tables),
      };
      try {
        await db.exec(proposal.up_sql);
        rehearsal.up_ok = true;
        rehearsal.schema_after_up = await this.canonicalSchema(db);
        try {
          await db.exec(proposal.down_sql);
          rehearsal.down_ok = true;
          rehearsal.schema_after_down = await this.canonicalSchema(db);
        } catch (e) {
          rehearsal.down_error = (e as Error).message;
        }
      } catch (e) {
        rehearsal.up_error = (e as Error).message;
      }
      return judgeMigration(proposal, rehearsal);
    } finally {
      await this.closeBranch(projectId, scratch);
      await rm(this.dir(projectId, scratch), { recursive: true, force: true });
    }
  }

  async promote(projectId: string, proposal: MigrationProposal): Promise<{ snapshot: string }> {
    const snapshot = `snap_${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await this.copyBranch(projectId, 'live', snapshot);
    const live = await this.db(projectId, 'live');
    await live.transaction(async (tx) => {
      await tx.exec(proposal.up_sql);
    });
    return { snapshot };
  }

  async restoreLive(projectId: string, snapshot: string): Promise<void> {
    if (!/^snap_[\w-]+$/.test(snapshot)) throw new DbError('not a snapshot id');
    await this.copyBranch(projectId, snapshot, 'live');
  }

  async refreshWorkbench(projectId: string): Promise<void> {
    await this.copyBranch(projectId, 'live', 'workbench');
  }

  async close(): Promise<void> {
    for (const db of this.open.values()) await db.close();
    this.open.clear();
  }
}
