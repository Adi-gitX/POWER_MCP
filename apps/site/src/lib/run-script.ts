export type Step =
  | { kind: 'say'; text: string; ms?: number }
  | { kind: 'call'; tool: string; args?: string; status: string; state: 'ok' | 'no'; ms?: number }
  | { kind: 'gate'; rule: string; text: string; foot: string; ms?: number }
  | { kind: 'files'; items: string[]; ms?: number }
  | { kind: 'tests'; total: number; ms?: number }
  | { kind: 'ask'; title: string; sub: string; label: string; ms?: number }
  | { kind: 'receipt'; ms?: number };

/** The run the page plays. `ask` steps stop the clock until a person clicks. */
export function buildScript(idea: string): Step[] {
  const slug = idea.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'your-app';
  return [
    { kind: 'say', text: `Writing the plan for ${slug}. Three requirements, each with an acceptance criterion.` },
    { kind: 'call', tool: 'start_run', args: `{ idea: "${idea}" }`, status: 'ok · phase: spec', state: 'ok' },
    { kind: 'call', tool: 'submit_spec', args: '{ spec: "SPEC.md" }', status: 'refused · gate_not_satisfied', state: 'no', ms: 900 },
    {
      kind: 'gate',
      rule: 'tasks.missing_requirement_ref',
      text: 'Task “Send the email” cites no requirement. Every task names the R# it serves.',
      foot: 'next_action: submit_spec · retries left: 1 · not billed',
    },
    { kind: 'say', text: 'The gate found one task with no requirement reference. Fixing that and resubmitting.' },
    { kind: 'call', tool: 'submit_spec', args: '{ spec: "SPEC.md" }', status: 'ok · phase: spec_approval', state: 'ok' },
    { kind: 'ask', title: 'The plan is ready for you.', sub: 'Three requirements. Nothing is built until you approve.', label: 'Approve the plan' },
    { kind: 'call', tool: 'get_context', status: 'ok · phase: build', state: 'ok' },
    { kind: 'say', text: 'Approved. Building against the plan.' },
    { kind: 'files', items: ['src/app.ts', 'src/bookings.ts', 'src/app.test.ts'] },
    { kind: 'call', tool: 'provision_database', status: 'ok · live + safe copy', state: 'ok' },
    { kind: 'call', tool: 'propose_migration', args: 'create table bookings (…)', status: 'ok · rehearsed on a copy · reversible', state: 'ok' },
    { kind: 'tests', total: 12 },
    { kind: 'call', tool: 'run_tests', status: 'green · 12 passed · phase: verify', state: 'ok' },
    { kind: 'say', text: 'Green. Verifying against the plan with fresh eyes — every requirement exercised, not just read.' },
    { kind: 'call', tool: 'submit_verification', args: '{ pass: true }', status: 'ok · ready to ship', state: 'ok' },
    { kind: 'call', tool: 'promote_migration', status: 'ok · bookings is live · snapshot taken', state: 'ok' },
    { kind: 'ask', title: 'Verified. Publish it?', sub: 'Every requirement passed by interaction and the checks are green.', label: 'Confirm publish' },
    { kind: 'call', tool: 'publish_app', status: 'ok · v1 live · phase: done', state: 'ok' },
    { kind: 'receipt' },
  ];
}

export const PLACEHOLDERS = [
  'a booking page for my barbershop',
  'a waitlist with referral codes',
  'an invoice tracker for my studio',
  'a class timetable parents can read',
];
