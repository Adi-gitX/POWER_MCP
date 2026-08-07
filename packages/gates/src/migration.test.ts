import { describe, expect, it } from 'vitest';
import { analyseMigration, judgeMigration, touchedTables, type Rehearsal } from './migration.js';

const proposal = (up: string, down = 'select 1', intent = 'Add a phone number to each customer.') => ({
  up_sql: up,
  down_sql: down,
  intent,
});

const rehearsal = (over: Partial<Rehearsal> = {}): Rehearsal => ({
  up_ok: true,
  down_ok: true,
  schema_before: 'A',
  schema_after_up: 'B',
  schema_after_down: 'A',
  row_counts: {},
  ...over,
});

describe('static analysis', () => {
  it('passes a plain additive change and summarises it for a human', () => {
    const v = analyseMigration(proposal('alter table customers add column phone text', 'alter table customers drop column phone'));
    expect(v.pass).toBe(true);
    expect(v.destructive).toBe(false);
    expect(v.summary[0]).toMatch(/Adds phone \(text\) to customers/);
  });

  it('requires a down migration, because rollback restores data too', () => {
    const v = analyseMigration(proposal('create table x (id int)', ''));
    expect(v.errors.map((e) => e.rule)).toContain('migration.no_down');
  });

  it('flags destructive operations rather than forbidding them', () => {
    const v = analyseMigration(proposal('drop table orders', 'create table orders (id int)'));
    expect(v.pass).toBe(true);
    expect(v.destructive).toBe(true);
    expect(v.summary[0]).toMatch(/Deletes the table orders/);
  });

  it('catches NOT NULL without a default — the classic migration that fails on real data', () => {
    const v = analyseMigration(proposal('alter table users add column age int not null', 'alter table users drop column age'));
    expect(v.errors.map((e) => e.rule)).toContain('migration.not_null_without_default');
    expect(v.errors[0]?.detail).toMatch(/DEFAULT/);
  });

  it('accepts NOT NULL with a default', () => {
    const v = analyseMigration(proposal("alter table users add column age int not null default 0", 'alter table users drop column age'));
    expect(v.pass).toBe(true);
  });

  it('ignores SQL inside comments', () => {
    const v = analyseMigration(proposal('-- drop table users\nalter table users add column x text', 'alter table users drop column x'));
    expect(v.destructive).toBe(false);
  });

  it('names the tables a migration touches', () => {
    expect(touchedTables('alter table "orders" add column x int; create index on customers (id)')).toEqual(['orders', 'customers']);
  });
});

describe('judgement after rehearsal', () => {
  it('passes when up applies, down reverses, and the schema actually changed', () => {
    const v = judgeMigration(proposal('alter table t add column c int', 'alter table t drop column c'), rehearsal());
    expect(v.pass).toBe(true);
  });

  it('fails an up that does not apply to a copy of live', () => {
    const v = judgeMigration(proposal('alter table t add column c int', 'x'), rehearsal({ up_ok: false, up_error: 'relation "t" does not exist' }));
    expect(v.errors.map((e) => e.rule)).toContain('migration.up_failed');
    expect(v.errors[0]?.detail).toMatch(/does not exist/);
  });

  it('fails a down that does not restore the schema', () => {
    const v = judgeMigration(proposal('alter table t add column c int', 'select 1'), rehearsal({ schema_after_down: 'B' }));
    expect(v.errors.map((e) => e.rule)).toContain('migration.not_reversible');
  });

  it('fails an up with no effect', () => {
    const v = judgeMigration(proposal('alter table t add column c int', 'alter table t drop column c'), rehearsal({ schema_after_up: 'A' }));
    expect(v.errors.map((e) => e.rule)).toContain('migration.no_effect');
  });

  it('refuses a blocking index on a large table and names the fix', () => {
    const v = judgeMigration(
      proposal('create index orders_by_customer on orders (customer_id)', 'drop index orders_by_customer'),
      rehearsal({ row_counts: { orders: 250_000 } }),
    );
    expect(v.errors.map((e) => e.rule)).toContain('migration.blocking_index_on_large_table');
    expect(v.errors[0]?.detail).toMatch(/CONCURRENTLY/);
  });

  it('allows the same index on a small table', () => {
    const v = judgeMigration(
      proposal('create index orders_by_customer on orders (customer_id)', 'drop index orders_by_customer'),
      rehearsal({ row_counts: { orders: 120 } }),
    );
    expect(v.pass).toBe(true);
    expect(v.summary.at(-1)).toBe('Affects orders: 120 existing rows');
  });
});
