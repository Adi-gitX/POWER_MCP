import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresDriver } from './postgres-driver.js';

/**
 * Runs only against a throwaway database, because it creates and drops real
 * databases. `pnpm test:postgres` points it at Docker; without the variable
 * the suite is skipped rather than silently passing on PGlite.
 *
 *   docker run -d --name power-test-pg -p 55432:5432 \
 *     -e POSTGRES_USER=power -e POSTGRES_PASSWORD=power -e POSTGRES_DB=power_test \
 *     postgres:16-alpine
 *   POWER_TEST_DATABASE_URL=postgres://power:power@127.0.0.1:55432/power_test pnpm test
 */
const ADMIN = process.env.POWER_TEST_DATABASE_URL;
const suite = ADMIN ? describe : describe.skip;

suite('the Postgres project database', () => {
  const tag = Math.random().toString(16).slice(2, 8);
  const projectId = `pg${tag}`;
  let driver: PostgresDriver;

  beforeAll(() => {
    driver = new PostgresDriver(ADMIN!);
  });

  afterAll(async () => {
    await driver.close();
  });

  it('provisions two branches and hands the app a URL it can write through', async () => {
    expect(await driver.provision(projectId)).toEqual({ created: true });
    expect(await driver.provision(projectId)).toEqual({ created: false });

    const workbench = await driver.connectionString(projectId, 'workbench');
    const live = await driver.connectionString(projectId, 'live');
    // Two branches on one URL would mean the app's safe copy and the published
    // app were the same database.
    expect(workbench).not.toBe(live);

    const pool = new pg.Pool({ connectionString: workbench, max: 2 });
    try {
      await pool.query('create table items (id serial primary key, label text not null)');
      await pool.query('insert into items (label) values ($1)', ['from the app']);
    } finally {
      await pool.end();
    }

    expect((await driver.schema(projectId, 'workbench')).map((t) => t.name)).toContain('items');
    expect(await driver.schema(projectId, 'live')).toEqual([]);

    // What the app wrote is what Power reads, over the same database.
    const seen = await driver.query(projectId, 'select label from items', 10);
    expect(seen.rows[0]!.label).toBe('from the app');
    await expect(driver.query(projectId, 'delete from items', 10)).rejects.toThrow(/read-only/);
  });

  it('rehearses on a copy, then promotes with a snapshot that restores live', async () => {
    const proposal = {
      up_sql: 'create table customers (id serial primary key, name text)',
      down_sql: 'drop table customers',
      intent: 'Create customers.',
    };

    const verdict = await driver.rehearse(projectId, proposal);
    expect(verdict.pass).toBe(true);
    // A rehearsal that changed live or the workbench would be worse than none.
    expect(await driver.schema(projectId, 'live')).toEqual([]);
    expect((await driver.schema(projectId, 'workbench')).map((t) => t.name)).not.toContain('customers');

    const { snapshot } = await driver.promote(projectId, proposal);
    expect((await driver.schema(projectId, 'live')).map((t) => t.name)).toEqual(['customers']);

    await driver.restoreLive(projectId, snapshot);
    expect(await driver.schema(projectId, 'live')).toEqual([]);

    // A snapshot id from another project must not restore this one.
    await expect(driver.restoreLive(projectId, 'snap_otherproject_x')).rejects.toThrow(/snapshot/);
  });

  it('refreshes the workbench from live', async () => {
    await driver.refreshWorkbench(projectId);
    expect(await driver.schema(projectId, 'workbench')).toEqual([]);
  });
});
