/**
 * The migration gate.
 *
 * The one gate that guards data rather than code. It runs on every schema change
 * before it can reach the live database, and like the others it is pure: SQL in,
 * a list of named failures out. What it cannot know statically — row counts,
 * whether `down_sql` really reverses `up_sql` — the DB driver supplies by
 * applying both to a scratch branch and reporting back. The gate then decides.
 *
 * The rules encode the ways schema changes lose data or take a site down, and
 * each says what would satisfy it. A destructive operation is not forbidden; it
 * is *flagged*, and the server requires typed confirmation in the browser for a
 * flagged migration. Nothing the assistant says in chat can clear that flag.
 */
import type { GateError } from './types.js';

const ARTIFACT = 'migration';

export interface MigrationProposal {
  up_sql: string;
  down_sql: string;
  /** One sentence, shown to the user in plain English. */
  intent: string;
}

/** What the driver learned by rehearsing the migration on a scratch branch. */
export interface Rehearsal {
  up_ok: boolean;
  up_error?: string;
  /** Schema after up, then after down, as canonical text. Equal means reversible. */
  schema_before: string;
  schema_after_up: string;
  schema_after_down: string;
  down_ok: boolean;
  down_error?: string;
  /** Row counts of tables the migration touches, from the live branch. */
  row_counts: Record<string, number>;
}

export interface MigrationVerdict {
  pass: boolean;
  /** True when the change can lose data. Requires typed confirmation, never chat. */
  destructive: boolean;
  errors: GateError[];
  /** Plain-English summary of what the change does, for the confirmation screen. */
  summary: string[];
}

const strip = (sql: string) =>
  sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const statements = (sql: string) => strip(sql).split(';').map((s) => s.trim()).filter(Boolean);

const DESTRUCTIVE: { rule: string; test: RegExp; what: (m: RegExpMatchArray) => string }[] = [
  { rule: 'destructive.drop_table', test: /^drop\s+table\s+(?:if\s+exists\s+)?"?([\w.]+)"?/i, what: (m) => `Deletes the table ${m[1]} and everything in it` },
  { rule: 'destructive.drop_column', test: /^alter\s+table\s+"?([\w.]+)"?\s+drop\s+(?:column\s+)?(?:if\s+exists\s+)?"?(\w+)"?/i, what: (m) => `Removes the column ${m[2]} from ${m[1]}, losing its data` },
  { rule: 'destructive.truncate', test: /^truncate\s+(?:table\s+)?"?([\w.]+)"?/i, what: (m) => `Empties the table ${m[1]}` },
  { rule: 'destructive.delete_all', test: /^delete\s+from\s+"?([\w.]+)"?\s*$/i, what: (m) => `Deletes every row in ${m[1]}` },
  { rule: 'destructive.type_change', test: /^alter\s+table\s+"?([\w.]+)"?\s+alter\s+(?:column\s+)?"?(\w+)"?\s+(?:set\s+data\s+)?type\s+(\w+)/i, what: (m) => `Changes the type of ${m[1]}.${m[2]} to ${m[3]}, which can fail or truncate existing values` },
  { rule: 'destructive.drop_schema', test: /^drop\s+schema/i, what: () => 'Drops a whole schema' },
];

const NOT_NULL_NO_DEFAULT = /^alter\s+table\s+"?([\w.]+)"?\s+add\s+(?:column\s+)?"?(\w+)"?\s+[\w()]+\s+(?!.*default)[^;]*not\s+null/i;
const ADD_COLUMN = /^alter\s+table\s+"?([\w.]+)"?\s+add\s+(?:column\s+)?"?(\w+)"?\s+([\w()]+)/i;
const CREATE_TABLE = /^create\s+table\s+(?:if\s+not\s+exists\s+)?"?([\w.]+)"?/i;
const CREATE_INDEX_BLOCKING = /^create\s+(?:unique\s+)?index\s+(?!concurrently)/i;
const TOUCHES = /\b(?:table|into|from|update|join)\s+(?:if\s+(?:not\s+)?exists\s+)?"?([a-z_][\w.]*)"?/gi;
const INDEX_ON = /\bindex\b[^;]*?\bon\s+(?:only\s+)?"?([a-z_][\w.]*)"?/gi;

/** Above this many rows a blocking index build or table rewrite is a real outage. */
const LARGE_TABLE = 100_000;

/** Static analysis only. Pure, no I/O, safe to run on every proposal. */
export function analyseMigration(proposal: MigrationProposal): MigrationVerdict {
  const errors: GateError[] = [];
  const summary: string[] = [];
  let destructive = false;

  if (!strip(proposal.up_sql)) {
    errors.push({ artifact: ARTIFACT, field: 'up_sql', rule: 'migration.empty', detail: 'up_sql is empty. A migration must change something.' });
  }
  if (!strip(proposal.down_sql)) {
    errors.push({
      artifact: ARTIFACT,
      field: 'down_sql',
      rule: 'migration.no_down',
      detail: 'down_sql is empty. Every migration must say how to reverse it, so the live app can be rolled back with its data.',
    });
  }
  if (!proposal.intent || proposal.intent.trim().length < 12) {
    errors.push({ artifact: ARTIFACT, field: 'intent', rule: 'migration.no_intent', detail: 'intent must be one plain-English sentence the user can read, e.g. "Add a phone number to each customer."' });
  }

  for (const stmt of statements(proposal.up_sql)) {
    for (const d of DESTRUCTIVE) {
      const m = stmt.match(d.test);
      if (m) {
        destructive = true;
        summary.push(`⚠ ${d.what(m)}`);
      }
    }
    const nn = stmt.match(NOT_NULL_NO_DEFAULT);
    if (nn) {
      errors.push({
        artifact: ARTIFACT,
        field: 'up_sql',
        rule: 'migration.not_null_without_default',
        detail: `Adding NOT NULL column ${nn[2]} to ${nn[1]} without a DEFAULT fails on any table that already has rows. Add a DEFAULT, or add the column nullable and backfill.`,
      });
    }
    const add = stmt.match(ADD_COLUMN);
    if (add && !nn) summary.push(`Adds ${add[2]} (${add[3]}) to ${add[1]}`);
    const ct = stmt.match(CREATE_TABLE);
    if (ct) summary.push(`Creates the table ${ct[1]}`);
  }

  return { pass: errors.length === 0, destructive, errors, summary };
}

/** Tables named anywhere in the SQL, so the driver knows whose row counts to fetch. */
export function touchedTables(sql: string): string[] {
  const out = new Set<string>();
  const flat = strip(sql);
  for (const m of flat.matchAll(TOUCHES)) out.add(m[1]!.toLowerCase());
  for (const m of flat.matchAll(INDEX_ON)) out.add(m[1]!.toLowerCase());
  return [...out];
}

/** The full verdict, once the driver has rehearsed the migration. */
export function judgeMigration(proposal: MigrationProposal, rehearsal: Rehearsal): MigrationVerdict {
  const verdict = analyseMigration(proposal);
  const errors = [...verdict.errors];

  if (!rehearsal.up_ok) {
    errors.push({
      artifact: ARTIFACT,
      field: 'up_sql',
      rule: 'migration.up_failed',
      detail: `up_sql failed when applied to a copy of the live database: ${rehearsal.up_error ?? 'unknown error'}. It must run cleanly against the current schema and data.`,
    });
  } else {
    if (!rehearsal.down_ok) {
      errors.push({
        artifact: ARTIFACT,
        field: 'down_sql',
        rule: 'migration.down_failed',
        detail: `down_sql failed when applied after up_sql: ${rehearsal.down_error ?? 'unknown error'}. It must reverse up_sql cleanly.`,
      });
    } else if (rehearsal.schema_after_down !== rehearsal.schema_before) {
      errors.push({
        artifact: ARTIFACT,
        field: 'down_sql',
        rule: 'migration.not_reversible',
        detail: 'Applying up_sql then down_sql does not restore the original schema. down_sql must undo every change up_sql makes.',
      });
    }
    if (rehearsal.schema_after_up === rehearsal.schema_before) {
      errors.push({
        artifact: ARTIFACT,
        field: 'up_sql',
        rule: 'migration.no_effect',
        detail: 'up_sql ran but the schema is unchanged. Either the change already exists or the SQL does not do what was intended.',
      });
    }
  }

  for (const stmt of statements(proposal.up_sql)) {
    if (CREATE_INDEX_BLOCKING.test(stmt)) {
      for (const table of touchedTables(stmt)) {
        if ((rehearsal.row_counts[table] ?? 0) >= LARGE_TABLE) {
          errors.push({
            artifact: ARTIFACT,
            field: 'up_sql',
            rule: 'migration.blocking_index_on_large_table',
            detail: `${table} has ${rehearsal.row_counts[table]} rows; a plain CREATE INDEX locks writes for the whole build. Use CREATE INDEX CONCURRENTLY.`,
          });
        }
      }
    }
  }

  const affected = Object.entries(rehearsal.row_counts)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${t}: ${n} existing row${n === 1 ? '' : 's'}`);
  return {
    pass: errors.length === 0,
    destructive: verdict.destructive,
    errors,
    summary: [...verdict.summary, ...(affected.length ? [`Affects ${affected.join(', ')}`] : ['No existing data is affected'])],
  };
}
