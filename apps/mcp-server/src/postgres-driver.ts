/**
 * The project database on a real Postgres server.
 *
 * `PgliteDriver` is the default because it needs nothing installed: it runs an
 * in-process Postgres and serves it over a socket. This driver is what a
 * hosted Power uses, and it is the same interface, so nothing above it changes.
 *
 * One database per branch, on one server:
 *
 *   pw_<project>_live       the branch the published app reads and writes
 *   pw_<project>_workbench  a copy the assistant works against
 *   pw_<project>_scratch_*  thrown away after a rehearsal
 *   pw_<project>_snap_*     a snapshot taken before a promotion
 *
 * Branching is `create database … template …`, which is a file-level copy
 * inside Postgres. On Neon this becomes a copy-on-write API call and the rest
 * of the code is unchanged; that is the whole point of keeping it behind
 * `DbDriver`.
 *
 * Two consequences are worth stating rather than hiding:
 *
 * - A template copy needs the source database to have no connections. Closing
 *   our own pools is not enough, because the generated app connects with its
 *   own pool, so `pg_terminate_backend` is used and the app reconnects. This is
 *   why the operation happens at a build boundary and not mid-request.
 * - Database names are derived from a hash of the project id, not the id
 *   itself. Postgres silently truncates identifiers at 63 bytes; two long ids
 *   that share a prefix would otherwise become the same database.
 */
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import {
  judgeMigration,
  touchedTables,
  type MigrationProposal,
  type MigrationVerdict,
  type Rehearsal,
} from '@power/gates';
import {
  DbError,
  SCHEMA_SQL,
  TABLES_SQL,
  assertReadOnly,
  type Branch,
  type DbDriver,
  type QueryResult,
  type SchemaTable,
} from './db.js';

/** Postgres identifiers are ours, not user input, but quoting is still cheaper than a bug. */
const quote = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** 12 hex characters: collision-free at any scale this product will see, and short enough to name databases. */
const projectKey = (projectId: string): string =>
  createHash('sha256').update(projectId).digest('hex').slice(0, 12);

export class PostgresDriver implements DbDriver {
  private readonly pools = new Map<string, pg.Pool>();

  constructor(private readonly adminUrl: string) {}

  private dbName(projectId: string, branch: string): string {
    const token = branch.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24);
    return `pw_${projectKey(projectId)}_${token}`;
  }

  /**
   * Scratch and snapshot databases keep the `snap_` / `scratch_` prefix the
   * driver interface promises, so a snapshot id looks the same whichever
   * engine produced it.
   */
  private auxName(projectId: string, kind: 'snap' | 'scratch', stamp = Date.now().toString(36)): string {
    return `${kind}_${projectKey(projectId)}_${stamp}`;
  }

  private urlFor(name: string): string {
    const url = new URL(this.adminUrl);
    url.pathname = `/${name}`;
    return url.toString();
  }

  private poolFor(name: string): pg.Pool {
    let pool = this.pools.get(name);
    if (!pool) {
      pool = new pg.Pool({ connectionString: this.urlFor(name), max: 5 });
      // A branch copy terminates this database's connections, including idle
      // ones in this pool. That is expected and the pool reconnects on the next
      // query; without a listener Node treats it as an unhandled error and can
      // take the process down. Queries still fail loudly on their own.
      pool.on('error', () => undefined);
      this.pools.set(name, pool);
    }
    return pool;
  }

  private async closePool(name: string): Promise<void> {
    const pool = this.pools.get(name);
    if (!pool) return;
    this.pools.delete(name);
    await pool.end();
  }

  /** Admin work is one connection, closed immediately: it must not hold a template open. */
  private async admin(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    const client = new pg.Client({ connectionString: this.adminUrl });
    await client.connect();
    try {
      return (await client.query(sql, params as never[])).rows as Record<string, unknown>[];
    } finally {
      await client.end();
    }
  }

  private async withClient<T>(name: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
    const client = new pg.Client({ connectionString: this.urlFor(name) });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }

  private async databaseExists(name: string): Promise<boolean> {
    const rows = await this.admin('select 1 as one from pg_database where datname = $1', [name]);
    return rows.length > 0;
  }

  private async disconnect(name: string): Promise<void> {
    await this.admin(
      'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
      [name],
    );
  }

  private async createDatabase(name: string, template?: string): Promise<void> {
    if (!template) {
      try {
        await this.admin(`create database ${quote(name)}`);
      } catch (error) {
        if ((error as { code?: string }).code === '42P04') return;
        throw error;
      }
      return;
    }

    // 55006 is object_in_use: the generated app reconnected between the
    // terminate and the copy. Retrying is correct rather than failing a
    // migration proposal because a preview happened to poll at that instant.
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.disconnect(template);
      try {
        await this.admin(`create database ${quote(name)} template ${quote(template)}`);
        return;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === '42P04') return;
        if (code !== '55006') throw error;
        await delay(75);
      }
    }
    throw new DbError(`could not copy ${template}: it is still in use`);
  }

  /** `WITH (FORCE)` disconnects clients, so a dropped database is really gone. Postgres 13+. */
  private async dropDatabase(name: string): Promise<void> {
    await this.admin(`drop database if exists ${quote(name)} with (force)`);
  }

  private async canonicalSchema(name: string): Promise<string> {
    return this.withClient(name, async (client) => JSON.stringify((await client.query(SCHEMA_SQL)).rows));
  }

  private async rowCounts(name: string, tables: string[]): Promise<Record<string, number>> {
    return this.withClient(name, async (client) => {
      const existing = new Set(
        (await client.query(TABLES_SQL)).rows.map((r: { table_name: string }) => r.table_name),
      );
      const out: Record<string, number> = {};
      for (const table of tables) {
        if (!existing.has(table)) continue;
        const { rows } = await client.query<{ n: number }>(
          `select count(*)::int as n from ${quote(table)}`,
        );
        out[table] = rows[0]?.n ?? 0;
      }
      return out;
    });
  }

  async exists(projectId: string): Promise<boolean> {
    return this.databaseExists(this.dbName(projectId, 'live'));
  }

  async provision(projectId: string): Promise<{ created: boolean }> {
    const live = this.dbName(projectId, 'live');
    const workbench = this.dbName(projectId, 'workbench');
    let created = false;

    if (!(await this.databaseExists(live))) {
      await this.createDatabase(live);
      created = true;
    }
    if (!(await this.databaseExists(workbench))) {
      await this.createDatabase(workbench, live);
      created = true;
    }
    return { created };
  }

  async schema(projectId: string, branch: Branch): Promise<SchemaTable[]> {
    const { rows } = await this.poolFor(this.dbName(projectId, branch)).query<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(SCHEMA_SQL);

    const tables = new Map<string, SchemaTable>();
    for (const row of rows) {
      const table = tables.get(row.table_name) ?? { name: row.table_name, columns: [] };
      table.columns.push({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES',
        default: row.column_default,
      });
      tables.set(row.table_name, table);
    }
    return [...tables.values()];
  }

  async query(projectId: string, sql: string, limit: number): Promise<QueryResult> {
    assertReadOnly(sql);
    const client = await this.poolFor(this.dbName(projectId, 'workbench')).connect();
    try {
      await client.query('begin transaction read only');
      const result = await client.query(sql);
      await client.query('rollback');
      const rows = result.rows.slice(0, limit) as Record<string, unknown>[];
      return {
        rows,
        row_count: rows.length,
        truncated: result.rows.length > limit,
        columns: (result.fields ?? []).map((field) => field.name),
      };
    } catch (error) {
      try {
        await client.query('rollback');
      } catch {
        // The transaction may never have started; the original error is the useful one.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async applyToWorkbench(projectId: string, sql: string): Promise<void> {
    await this.poolFor(this.dbName(projectId, 'workbench')).query(sql);
  }

  async rehearse(projectId: string, proposal: MigrationProposal): Promise<MigrationVerdict> {
    if (!(await this.exists(projectId))) throw new DbError('no database yet. Call provision_database first.');

    const live = this.dbName(projectId, 'live');
    const scratch = this.auxName(projectId, 'scratch');
    // A template copy cannot have connections to the template, including ours.
    await this.closePool(live);
    await this.createDatabase(scratch, live);

    try {
      const tables = [
        ...new Set([...touchedTables(proposal.up_sql), ...touchedTables(proposal.down_sql)]),
      ];
      const rehearsal: Rehearsal = {
        up_ok: false,
        down_ok: false,
        schema_before: await this.canonicalSchema(scratch),
        schema_after_up: '',
        schema_after_down: '',
        row_counts: await this.rowCounts(scratch, tables),
      };

      try {
        await this.withClient(scratch, (client) => client.query(proposal.up_sql));
        rehearsal.up_ok = true;
        rehearsal.schema_after_up = await this.canonicalSchema(scratch);
        try {
          await this.withClient(scratch, (client) => client.query(proposal.down_sql));
          rehearsal.down_ok = true;
          rehearsal.schema_after_down = await this.canonicalSchema(scratch);
        } catch (error) {
          rehearsal.down_error = (error as Error).message;
        }
      } catch (error) {
        rehearsal.up_error = (error as Error).message;
      }

      return judgeMigration(proposal, rehearsal);
    } finally {
      await this.dropDatabase(scratch);
    }
  }

  async promote(projectId: string, proposal: MigrationProposal): Promise<{ snapshot: string }> {
    const live = this.dbName(projectId, 'live');
    const snapshot = this.auxName(projectId, 'snap');

    await this.closePool(live);
    // Snapshot first: a promotion that fails halfway is recoverable, which is
    // the entire difference between this and running SQL at the live database.
    await this.createDatabase(snapshot, live);

    await this.withClient(live, async (client) => {
      await client.query('begin');
      try {
        await client.query(proposal.up_sql);
        await client.query('commit');
      } catch (error) {
        try {
          await client.query('rollback');
        } catch {
          // The transaction is already gone; report the original failure.
        }
        throw error;
      }
    });

    return { snapshot };
  }

  async restoreLive(projectId: string, snapshot: string): Promise<void> {
    if (!snapshot.startsWith(`snap_${projectKey(projectId)}_`)) {
      throw new DbError('not a snapshot of this project');
    }
    const live = this.dbName(projectId, 'live');
    await this.closePool(live);
    await this.dropDatabase(live);
    await this.createDatabase(live, snapshot);
  }

  async refreshWorkbench(projectId: string): Promise<void> {
    const live = this.dbName(projectId, 'live');
    const workbench = this.dbName(projectId, 'workbench');
    await this.closePool(workbench);
    // The live pool has to go too: making a template copy terminates every
    // connection to live, and leaving one in the pool turns a correct refresh
    // into an unhandled socket error.
    await this.closePool(live);
    await this.dropDatabase(workbench);
    await this.createDatabase(workbench, live);
  }

  async connectionString(projectId: string, branch: Branch): Promise<string> {
    const name = this.dbName(projectId, branch);
    if (!(await this.databaseExists(name))) {
      throw new DbError(`the ${branch} branch does not exist yet. Call provision_database first.`);
    }
    return this.urlFor(name);
  }

  async close(): Promise<void> {
    for (const pool of this.pools.values()) await pool.end();
    this.pools.clear();
  }
}
