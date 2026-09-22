/**
 * End-to-end: a real MCP client walks the whole pipeline against a running
 * server and checks the envelope at every gate.
 *
 * This is the seed of the eval harness the plan calls for in week 1. Today it
 * plays the model's part deterministically; the next step is to hand the same
 * script's transcript to real clients (Claude, ChatGPT, Cursor) and watch what
 * they do with `ok: false`. Run with the server up: `pnpm e2e`.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const BASE = process.env.POWER_BASE_URL ?? 'http://localhost:4321';

interface Envelope {
  ok: boolean;
  reason?: string;
  message?: string;
  failures?: unknown[];
  data?: Record<string, unknown>;
  billed?: boolean;
  guidance?: string;
  context?: {
    phase: string;
    next_action: { tool: string } | null;
    open_gate_failures: unknown[];
    loops_remaining: Record<string, number>;
  };
}

let failures = 0;
function step(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}`);
    if (detail !== undefined) console.log(`       ${JSON.stringify(detail).slice(0, 600)}`);
  }
}

const client = new Client({ name: 'power-e2e', version: '0.1.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));

async function call(name: string, args: Record<string, unknown> = {}): Promise<Envelope & { isError: boolean }> {
  const result = await client.callTool({ name, arguments: args });
  const first = (result.content as { type: string; text?: string }[])[0];
  const payload = JSON.parse(first?.text ?? '{}') as Envelope;
  return { ...payload, isError: Boolean(result.isError) };
}

async function post(path: string): Promise<number> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', redirect: 'manual', body: 'reason=e2e' });
  return res.status;
}

const SPEC = `---
product: Bakery greeter
primary_persona: A bakery owner
requirement_ids: [R1, R2]
approved: false
---

## Product Summary
A tiny module that greets customers by name.

## Goals And Non-Goals
Goals: greet and shout. Non-goals: anything else.

## Users
The bakery owner.

## User Stories
As the owner I want a friendly greeting.

## Requirements

### R1 Greet
WHEN greet is called with a name, THE SYSTEM SHALL return "Hello, <name>".

### R2 Shout
WHEN shout is called with a name, THE SYSTEM SHALL return the greeting in upper case followed by an exclamation mark.

## Non-Functional Requirements
Pure functions, no I/O.

## Architecture
One module, src/app.ts.

## Data Model
None.

## Interfaces
greet(name: string): string; shout(name: string): string.

## Tasks
- Implement greet (R1)
- Implement shout (R2)

## Open Questions
None.

## Build Handoff
Write tests for both functions.
`;

const APP = `export function greet(name: string): string {
  return \`Hello, \${name}\`;
}

export function shout(name: string): string {
  return \`\${greet(name).toUpperCase()}!\`;
}
`;

const TEST = `import { expect, it } from 'vitest';
import { greet, shout } from './app.js';

it('greets', () => {
  expect(greet('Ada')).toBe('Hello, Ada');
});

it('shouts', () => {
  expect(shout('Ada')).toBe('HELLO, ADA!');
});
`;

const criterion = (id: string, result: 'pass' | 'fail', observation: string) => ({
  id,
  priority: 'P0',
  result,
  observation,
  verified_by_interaction: true,
});

const PASS_REPORT = JSON.stringify({
  pass: true,
  visual_score: 4,
  criteria: [
    criterion('R1', 'pass', 'Called greet("Ada") in the test suite and got "Hello, Ada".'),
    criterion('R2', 'pass', 'Called shout("Ada") in the test suite and got "HELLO, ADA!".'),
  ],
  issues: [],
  summary: 'Both requirements verified by running the suite against the built module.',
});

const FAIL_REPORT = JSON.stringify({
  pass: false,
  visual_score: 4,
  criteria: [
    criterion('R1', 'pass', 'Called greet("Ada") in the test suite and got "Hello, Ada".'),
    criterion('R2', 'fail', 'Called shout("Ada") and the exclamation mark was missing from the result.'),
  ],
  issues: [
    {
      severity: 'major',
      where: 'src/app.ts',
      problem: 'shout does not append an exclamation mark.',
      expected: 'shout("Ada") returns "HELLO, ADA!".',
    },
  ],
  summary: 'R1 holds; R2 fails on the trailing punctuation.',
});

console.log(`\nPower e2e against ${BASE}\n`);

const tools = await client.listTools();
step('tool list is published', tools.tools.length >= 25, tools.tools.length);
step('no execute_sql anywhere', !tools.tools.some((t) => t.name === 'execute_sql'));

console.log('\n— plan');
const created = await call('create_project', { name: 'Bakery greeter' });
step('create_project starts at the plan', created.ok && created.context?.phase === 'spec', created);
step('create_project hands over the architect brief', Boolean(created.guidance?.includes('ARCHITECT')));
const pid = created.data?.project_id as string;
// Baseline the quota here, so the metering assertion at the end measures what
// THIS run spent. Asserting an absolute number only held against a freshly
// started server and failed on the third consecutive run.
const quotaBefore =
  ((await call('get_context', { project_id: pid })).data?.quota as { day: number } | undefined)?.day ?? null;

const early = await call('write_file', { project_id: pid, path: 'src/x.ts', content: 'x' });
step('writing before a plan is refused, not errored', early.ok === false && !early.isError, early);
step('  …with reason wrong_phase', early.reason === 'wrong_phase');
step('  …and points at submit_spec', early.context?.next_action?.tool === 'submit_spec');
step('  …and is not billed', early.billed === false);

const bad = await call('submit_spec', { project_id: pid, spec: '# Just a heading' });
step('a bad spec is refused by the gate', bad.ok === false && bad.reason === 'gate_not_satisfied' && !bad.isError, bad);
step('  …with actionable failures', (bad.failures?.length ?? 0) > 0);
step('  …and spends one plan retry', bad.context?.loops_remaining.spec_revision === 1, bad.context?.loops_remaining);
step('  …and re-sends the architect brief', Boolean(bad.guidance?.includes('ARCHITECT')));

const good = await call('submit_spec', { project_id: pid, spec: SPEC });
step('a good spec passes and waits for a human', good.ok && good.context?.phase === 'spec_approval', good);
step('  …next action is request_spec_approval', good.context?.next_action?.tool === 'request_spec_approval');

const beforeApproval = await call('write_file', { project_id: pid, path: 'src/x.ts', content: 'x' });
step('writing before approval is refused and explains why', beforeApproval.ok === false && /approve/i.test(beforeApproval.message ?? ''), beforeApproval.message);

console.log('\n— human approves in the browser');
step('approve-spec endpoint accepts', (await post(`/projects/${pid}/approve-spec`)) === 303);
const afterApproval = await call('get_context', { project_id: pid });
step('run moves to build', afterApproval.context?.phase === 'build', afterApproval.context);
step('  …and hands over the implementer brief', Boolean(afterApproval.guidance?.includes('IMPLEMENTER')));

console.log('\n— build');
const w1 = await call('write_file', { project_id: pid, path: 'src/app.ts', content: APP });
const w2 = await call('write_file', { project_id: pid, path: 'src/app.test.ts', content: TEST });
step('writes are admitted and billed', w1.ok && w2.ok && w1.billed === true, w1);

const tooEarly = await call('publish_app', { project_id: pid });
step('publish during build is refused', tooEarly.ok === false && !tooEarly.isError, tooEarly.reason);

console.log('\n— data: two branches, a gate in between');
const provisioned = await call('provision_database', { project_id: pid });
step('provision_database creates live + safe copy', provisioned.ok && provisioned.data?.created === true, provisioned);

const badMigration = await call('propose_migration', {
  project_id: pid,
  up_sql: 'alter table customers add column phone text not null',
  down_sql: '',
  intent: 'Add phone.',
});
step('a migration with no down and NOT NULL/no default is refused by the gate', badMigration.ok === false && badMigration.reason === 'gate_not_satisfied', badMigration);
step('  …with named rules', (badMigration.failures as { rule: string }[] | undefined)?.some((f) => f.rule === 'migration.no_down') === true, badMigration.failures);

const goodMigration = await call('propose_migration', {
  project_id: pid,
  up_sql: 'create table customers (id serial primary key, name text not null)',
  down_sql: 'drop table customers',
  intent: 'Create a table to hold customers.',
});
step('a sound migration is rehearsed on a copy of live and passes', goodMigration.ok && goodMigration.data?.passed === true, goodMigration);
step('  …and is applied to the safe copy only', goodMigration.data?.applied_to === 'workbench');

const wbSchema = await call('pull_schema', { project_id: pid, env: 'workbench' });
const liveSchema = await call('pull_schema', { project_id: pid, env: 'live' });
step('workbench has the table; live does not yet', (wbSchema.data?.tables as unknown[]).length === 1 && (liveSchema.data?.tables as unknown[]).length === 0, { wb: wbSchema.data, live: liveSchema.data });

const q = await call('query_database', { project_id: pid, sql: 'select count(*)::int as n from customers' });
step('query_database reads the safe copy', q.ok && (q.data?.rows as { n: number }[])[0]?.n === 0, q);
const qw = await call('query_database', { project_id: pid, sql: 'drop table customers' });
step('query_database refuses writes', qw.isError && /read-only/.test(JSON.stringify(qw)), qw);

const earlyPromote = await call('promote_migration', { project_id: pid });
step('promote_migration is refused before verification (wrong phase)', earlyPromote.ok === false && earlyPromote.reason === 'wrong_phase', earlyPromote.reason);

// Drops an old table (destructive, even if absent) and creates the new one.
// Valid against an empty live, reversible, and flagged — the interesting case.
const destructive = await call('propose_migration', {
  project_id: pid,
  up_sql: 'drop table if exists legacy_customers; create table if not exists customers (id serial primary key, name text not null)',
  down_sql: 'drop table if exists customers',
  intent: 'Replace the legacy customers table with a new one.',
});
step('a destructive migration passes the gate but is flagged', destructive.ok && destructive.data?.destructive === true, destructive);
step('  …and says only the browser can clear it', /browser|type a confirmation/i.test(String(destructive.data?.live)));

console.log('\n— secrets: never in the conversation');
const secret = await call('request_secret', { project_id: pid, name: 'STRIPE_SECRET_KEY', env: 'workbench', provider: 'stripe', why: 'To create checkout sessions.' });
step('request_secret returns a form URL, not a prompt for the value', secret.ok && /\/secrets\//.test(String(secret.data?.form_url)), secret.data);
const formUrl = String(secret.data?.form_url);
const SECRET_VALUE = 'sk_test_51H8xkQ2eZvKYlo2C0';
const posted = await fetch(formUrl, { method: 'POST', body: `value=${encodeURIComponent(SECRET_VALUE)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
step('the browser form accepts the value', posted.status === 200, posted.status);
const reused = await fetch(formUrl, { method: 'POST', body: `value=${encodeURIComponent('another-value-x')}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
step('  …and the link is single-use', reused.status === 404, reused.status);

await call('write_file', { project_id: pid, path: 'src/leak.test.ts', content: `import { it } from 'vitest';\nit('leaks', () => { console.log('KEY=' + process.env.STRIPE_SECRET_KEY); });\n` });
const leaky = await call('run_tests', { project_id: pid });
const leakyText = JSON.stringify(leaky);
step('the secret reaches the process as an env var', /KEY=/.test(leakyText), leaky.data);
step('  …but the scrubber redacts it from the tool result', !leakyText.includes(SECRET_VALUE) && /\[redacted:[0-9a-f]{8}\]/.test(leakyText), leakyText.slice(0, 300));
await call('delete_file', { project_id: pid, path: 'src/leak.test.ts' });

const green = await call('run_tests', { project_id: pid });
step('run_tests goes green', green.ok && green.data?.green === true, green.data);
step('  …and moves the run to verify by itself', green.context?.phase === 'verify', green.context?.phase);
step('  …and hands over the verifier brief', Boolean(green.guidance?.includes('VERIFIER')));

const lateWrite = await call('write_file', { project_id: pid, path: 'src/y.ts', content: 'y' });
step('writing during verify is refused', lateWrite.ok === false && lateWrite.reason === 'wrong_phase');

console.log('\n— verify');
const unverified = await call('publish_app', { project_id: pid });
step('publish before verification is refused with gate_not_satisfied', unverified.reason === 'gate_not_satisfied', unverified.message);

const malformed = await call('submit_verification', { project_id: pid, verification: '{}' });
step('a malformed report is refused', malformed.ok === false && malformed.reason === 'gate_not_satisfied', malformed.failures);
step('  …without spending a fix retry', malformed.context?.loops_remaining.needs_fixes === 2, malformed.context?.loops_remaining);

const honest = await call('submit_verification', { project_id: pid, verification: FAIL_REPORT });
step('an honest failure is accepted', honest.ok && honest.data?.verdict === 'fail', honest);
step('  …sends the run back to build', honest.context?.phase === 'build', honest.context?.phase);
step('  …spends one fix retry', honest.context?.loops_remaining.needs_fixes === 1, honest.context?.loops_remaining);
step('  …and surfaces the issue as an open failure', (honest.context?.open_gate_failures.length ?? 0) === 1, honest.context?.open_gate_failures);

const regreen = await call('run_tests', { project_id: pid });
step('run_tests goes green again and returns to verify', regreen.ok && regreen.context?.phase === 'verify', regreen.context);

const verified = await call('submit_verification', { project_id: pid, verification: PASS_REPORT });
step('a passing report is accepted', verified.ok && verified.data?.passed === true, verified);
step('  …run rests in verify, ready to ship', verified.context?.phase === 'verify');
step('  …next action is publish_app', verified.context?.next_action?.tool === 'publish_app', verified.context?.next_action);
step('  …open failures are cleared', verified.context?.open_gate_failures.length === 0);

const unconfirmedPromote = await call('promote_migration', { project_id: pid });
step('a destructive promote is refused without a typed confirmation', unconfirmedPromote.ok === false && unconfirmedPromote.reason === 'needs_user_input', unconfirmedPromote);
const wrongWord = await fetch(`${BASE}/projects/${pid}/confirm-migration`, { method: 'POST', redirect: 'manual', body: 'confirm=yes', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
step('  …a button-press ("yes") is not enough', wrongWord.status === 400, wrongWord.status);
const rightWord = await fetch(`${BASE}/projects/${pid}/confirm-migration`, { method: 'POST', redirect: 'manual', body: 'confirm=bakery-greeter', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
step('  …typing the project name is', rightWord.status === 303, rightWord.status);

const promoted = await call('promote_migration', { project_id: pid });
step('promote_migration applies the gate-passed change to live, with a snapshot', promoted.ok && promoted.data?.promoted === true && String(promoted.data?.snapshot).startsWith('snap_'), promoted);
const liveAfter = await call('pull_schema', { project_id: pid, env: 'live' });
step('  …live now has the table', (liveAfter.data?.tables as { name: string }[])[0]?.name === 'customers', liveAfter.data);
const twice = await call('promote_migration', { project_id: pid });
step('  …and cannot be promoted twice', twice.isError && /already promoted/.test(JSON.stringify(twice)), twice);

console.log('\n— ship');
const unconfirmed = await call('publish_app', { project_id: pid });
step('publish without browser confirmation is refused', unconfirmed.ok === false && unconfirmed.reason === 'needs_user_input', unconfirmed.reason);
step('  …and says the chat cannot confirm it', /browser/i.test(unconfirmed.message ?? ''));

step('confirm-publish endpoint accepts', (await post(`/projects/${pid}/confirm-publish`)) === 303);
const published = await call('publish_app', { project_id: pid });
step('publish succeeds', published.ok && published.data?.version === 'v1', published);
step('  …and the run is done', published.context?.phase === 'done');

const again = await call('publish_app', { project_id: pid });
step('a second publish needs a fresh confirmation (one-shot)', again.ok === false, again.reason);

console.log('\n— the second hour: a new run on a shipped project');
const staleWrite = await call('write_file', { project_id: pid, path: 'src/z.ts', content: 'z' });
step('a done run refuses new building and points at start_run', staleWrite.ok === false && staleWrite.context?.next_action?.tool === 'start_run', staleWrite.context?.next_action);
const run2 = await call('start_run', { project_id: pid, goal: 'Add a whisper() function that lower-cases the greeting.' });
step('start_run begins a new run at the plan, keeping the project', run2.ok && run2.context?.phase === 'spec' && run2.data?.previous_run !== run2.data?.run_id, run2);
step('  …with a fresh retry budget', run2.context?.loops_remaining.needs_fixes === 2 && run2.context?.loops_remaining.spec_revision === 2, run2.context?.loops_remaining);
step('  …the previous plan is offered as context', Boolean(run2.guidance?.includes('previous SPEC.md')));
step('  …and live is untouched', (run2.data?.live as { version: string }).version === 'v1', run2.data?.live);
const run2Write = await call('write_file', { project_id: pid, path: 'src/z.ts', content: 'z' });
step('  …and the gates are re-armed: writing before the new plan is refused', run2Write.ok === false && run2Write.reason === 'wrong_phase');

console.log('\n— the exit');
const exported = await call('export_project', { project_id: pid });
step('export works after done, and is free', exported.ok && String(exported.data?.path).endsWith('.bundle') && exported.billed === false, exported);
const checkpoints = await call('list_checkpoints', { project_id: pid });
const list = (checkpoints.data?.checkpoints as { message: string }[]) ?? [];
step('history is real git: gate boundaries are commits', list.length >= 4, list.map((c) => c.message));

console.log('\n— metering');
const ctx = await call('get_context', { project_id: pid });
const quota = ctx.data?.quota as { plan: string; day: number } | undefined;
step('the envelope reports remaining build actions', typeof quota?.day === 'number', quota);
const spent = quotaBefore === null || quota === undefined ? null : quotaBefore - quota.day;
step(
  'reads and refusals were not billed (this run spent under 50 actions)',
  spent !== null && spent > 0 && spent < 50,
  { quotaBefore, quotaAfter: quota?.day, spent },
);

await client.close();
console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
