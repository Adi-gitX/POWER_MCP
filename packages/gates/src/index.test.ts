import { describe, expect, it } from 'vitest';
import { REQUIRED_SECTIONS, runGate } from './index.js';

/** A spec that passes every rule, used as the base for targeted mutations. */
function validSpec(overrides: { tasks?: string; requirements?: string } = {}): string {
  const requirements =
    overrides.requirements ??
    `### R1 Sign in
WHEN a visitor submits valid credentials, THE SYSTEM SHALL start a session and redirect to the dashboard.

### R2 Sign out
WHEN a signed-in user clicks sign out, THE SYSTEM SHALL end the session and return them to the home page.`;

  const tasks = overrides.tasks ?? `- Build the login form (R1)\n- Add the sign-out control (R2)`;

  const body = REQUIRED_SECTIONS.map((section) => {
    if (section === 'requirements') return `## Requirements\n\n${requirements}`;
    if (section === 'tasks') return `## Tasks\n\n${tasks}`;
    const title = section.replace(/\b\w/g, (c) => c.toUpperCase());
    return `## ${title}\n\nPlaceholder prose for the ${section} section.`;
  }).join('\n\n');

  return `---
product: Example App
primary_persona: A small business owner
requirement_ids: [R1, R2]
approved: false
---

${body}
`;
}

describe('spec gate', () => {
  it('passes a well-formed spec', () => {
    const result = runGate('spec', { 'SPEC.md': validSpec() });
    expect(result.errors).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('fails when an artifact was never produced', () => {
    const result = runGate('spec', {});
    expect(result.pass).toBe(false);
    expect(result.errors[0]?.rule).toBe('artifact.missing');
  });

  it('requires each requirement to carry its own EARS criterion', () => {
    const result = runGate('spec', {
      'SPEC.md': validSpec({
        requirements: `### R1 Sign in
WHEN a visitor submits valid credentials, THE SYSTEM SHALL start a session.

### R2 Sign out
The user can sign out.`,
      }),
    });
    expect(result.errors.map((e) => e.rule)).toContain('ears.missing');
    expect(result.errors.find((e) => e.rule === 'ears.missing')?.field).toBe('R2');
  });

  it('catches a requirement declared in frontmatter but never specified', () => {
    const spec = validSpec().replace('requirement_ids: [R1, R2]', 'requirement_ids: [R1, R2, R3]');
    const rules = runGate('spec', { 'SPEC.md': spec }).errors.map((e) => e.rule);
    expect(rules).toContain('traceability.undefined_requirement');
  });

  it('catches a task that cites no requirement', () => {
    const result = runGate('spec', {
      'SPEC.md': validSpec({ tasks: '- Build the login form (R1)\n- Tidy up the CSS' }),
    });
    expect(result.errors.map((e) => e.rule)).toContain('tasks.missing_requirement_ref');
  });

  it('catches a task citing a requirement that does not exist', () => {
    const result = runGate('spec', {
      'SPEC.md': validSpec({ tasks: '- Build the login form (R1)\n- Add billing (R9)' }),
    });
    expect(result.errors.map((e) => e.rule)).toContain('tasks.unknown_requirement_ref');
  });

  /**
   * Regression. A markdown list item is not one line: wrap a task and its
   * trailing `(R2)` lands on a continuation line, which a line-anchored regex
   * does not see. The gate then rejected a task that cited its requirement
   * perfectly well.
   *
   * That is the worst shape a gate bug can take. A false negative lets one bad
   * artifact through; a false positive rejects correct work, burns a counted
   * retry, and sends the agent to fix something that was never wrong.
   */
  it('folds continuation lines into the item they belong to', () => {
    const result = runGate('spec', {
      'SPEC.md': validSpec({
        tasks: `- Build the login form (R1)
- Add a sign-out control to the header, wired to the session endpoint so the
  cookie is cleared on the server rather than only in the browser (R2)`,
      }),
    });
    expect(result.errors).toEqual([]);
  });
});

describe('verification gate', () => {
  const criterion = {
    id: 'R1',
    result: 'pass',
    priority: 'P0',
    observation: 'Signed in with a valid account and landed on the dashboard.',
    verified_by_interaction: true,
  };

  const report = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      pass: true,
      visual_score: 4,
      criteria: [criterion],
      issues: [],
      summary: 'Signed in and out successfully on a fresh session.',
      ...overrides,
    });

  it('passes a report whose claims hold up', () => {
    expect(runGate('verification', { 'verification.json': report() }).pass).toBe(true);
  });

  it('refuses a pass with no P0 criteria — a green build is not a pass', () => {
    const raw = report({
      criteria: [{ ...criterion, priority: 'P2' }],
    });
    const rules = runGate('verification', { 'verification.json': raw }).errors.map((e) => e.rule);
    expect(rules).toContain('verification.no_p0');
  });

  it('refuses a pass that contradicts its own criteria', () => {
    const raw = report({ criteria: [{ ...criterion, result: 'fail' }] });
    const rules = runGate('verification', { 'verification.json': raw }).errors.map((e) => e.rule);
    expect(rules).toContain('verification.p0_failed');
  });

  it('refuses a P0 that was only looked at, not interacted with', () => {
    const raw = report({ criteria: [{ ...criterion, verified_by_interaction: false }] });
    const rules = runGate('verification', { 'verification.json': raw }).errors.map((e) => e.rule);
    expect(rules).toContain('verification.not_interacted');
  });

  it('refuses a pass below the visual bar', () => {
    const rules = runGate('verification', {
      'verification.json': report({ visual_score: 2 }),
    }).errors.map((e) => e.rule);
    expect(rules).toContain('verification.below_visual_bar');
  });

  it('does not apply the cross-checks to an honest failure', () => {
    const raw = report({ pass: false, visual_score: 2, criteria: [{ ...criterion, result: 'fail' }] });
    expect(runGate('verification', { 'verification.json': raw }).pass).toBe(true);
  });
});

describe('research gate', () => {
  const research = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      summary: 'A sufficiently long summary of what was found while researching this problem.',
      unknowns_resolved: [
        {
          question: 'Which payment provider?',
          answer: 'Stripe, for its hosted checkout.',
          resolved: true,
          source_url: 'https://stripe.com/docs',
        },
      ],
      prior_art: [{ name: 'Example', url: 'https://example.com', gaps: ['No offline mode'] }],
      users: {
        pain_points: [
          {
            point: 'Cannot take payments on mobile',
            severity: 'high',
            source_url: 'https://example.com/forum',
          },
        ],
      },
      feasibility: { constraints: [] },
      sources: [
        { url: 'https://stripe.com/docs', tier: 'vendor' },
        { url: 'https://example.com', tier: 'secondary' },
        { url: 'https://example.com/forum', tier: 'secondary' },
      ],
      ...overrides,
    });

  it('passes fully sourced research', () => {
    expect(runGate('research', { 'research.json': research() }).pass).toBe(true);
  });

  /** The check that catches an invented URL that happens to be well-formed. */
  it('refuses a citation missing from the bibliography', () => {
    const raw = research({
      sources: [
        { url: 'https://example.com', tier: 'secondary' },
        { url: 'https://example.com/forum', tier: 'secondary' },
      ],
    });
    const rules = runGate('research', { 'research.json': raw }).errors.map((e) => e.rule);
    expect(rules).toContain('sources.unlisted');
  });

  it('refuses a resolved unknown with no source', () => {
    const raw = research({
      unknowns_resolved: [
        { question: 'Which provider?', answer: 'Stripe, probably.', resolved: true },
      ],
    });
    const rules = runGate('research', { 'research.json': raw }).errors.map((e) => e.rule);
    expect(rules).toContain('sources.unsourced_claim');
  });

  it('rejects a bare domain as a source URL', () => {
    const raw = research({ sources: [{ url: 'stripe.com', tier: 'vendor' }] });
    expect(runGate('research', { 'research.json': raw }).pass).toBe(false);
  });
});

describe('gate errors are actionable', () => {
  it('names the artifact, field, rule and remedy on every failure', () => {
    const result = runGate('spec', { 'SPEC.md': '# no frontmatter' });
    expect(result.errors.length).toBeGreaterThan(0);
    for (const error of result.errors) {
      expect(error.artifact).toBeTruthy();
      expect(error.field).toBeTruthy();
      expect(error.rule).toBeTruthy();
      expect(error.detail.length).toBeGreaterThan(10);
    }
  });
});
