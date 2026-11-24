/**
 * The dashboard is the half of the product an assistant cannot act in, so its
 * rules are worth testing like any other server logic: what counts as "live",
 * which phase may show an approval form, and that a project name is never
 * interpolated into HTML unescaped.
 */
import { canPublish, createRunState, type RunState } from '@power/runstate';
import { describe, expect, it } from 'vitest';
import {
  filterProjects,
  projectPage,
  projectsPage,
  relative,
  settingsPage,
  validateProjectName,
  type PageContext,
  type ProjectRow,
  type ProjectView,
} from './dashboard.js';
import { MemoryStore, type Approvals, type DeploymentRecord, type Project } from './store.js';

const ctx: PageContext = {
  baseUrl: 'https://power.test',
  user: 'user_ada',
  email: 'ada@example.com',
  plan: 'pro',
  remaining: { day: 42, week: null },
};

const project = (id = 'p1', name = 'Bakery greeter', slug = 'bakery-greeter'): Project => ({
  id,
  name,
  slug,
  created_at: '2026-11-02T10:00:00.000Z',
});

const run = (phase: RunState['phase'], overrides: Partial<RunState> = {}): RunState => ({
  ...createRunState('run_1'),
  phase,
  ...overrides,
});

const deployment = (overrides: Partial<DeploymentRecord> = {}): DeploymentRecord => ({
  id: 'dpl_1',
  project_id: 'p1',
  provider: 'local',
  target: 'production',
  version: 'v1',
  commit: null,
  url: 'https://power.test/previews/dpl_1/',
  ready_state: 'READY',
  deploy_project_name: 'bakery-greeter',
  created_at: '2026-11-02T10:05:00.000Z',
  ...overrides,
});

const row = (overrides: Partial<ProjectRow> = {}): ProjectRow => ({
  project: project(),
  state: run('intake'),
  live: null,
  ...overrides,
});

const approvals = (overrides: Partial<Approvals> = {}): Approvals => ({
  spec_approved_at: null,
  spec_approval_requested_at: null,
  publish_confirmed_at: null,
  migration_confirmed_at: null,
  unpublish_confirmed_at: null,
  ...overrides,
});

const view = (state: RunState, overrides: Partial<ProjectView> = {}): ProjectView => ({
  project: project(),
  state,
  approvals: approvals(),
  publish: canPublish(state),
  live: { version: null, live_path: null },
  deployments: [],
  secrets: [],
  migration: null,
  spec: '# Plan',
  previewUrl: null,
  csrf: '<input type="hidden" name="csrf" value="token-1">',
  dbLabel: 'PGlite (local)',
  deployerLabel: 'Local previews',
  ...overrides,
});

describe('filtering projects', () => {
  const rows = [
    row({ project: project('p1', 'Alpha', 'alpha'), state: run('build') }),
    row({ project: project('p2', 'Beta', 'beta'), state: run('spec_approval') }),
    row({ project: project('p3', 'Gamma', 'gamma'), state: run('done'), live: deployment() }),
  ];

  it('puts projects that need a decision first', () => {
    expect(filterProjects(rows, '', 'all').map((r) => r.project.id)).toEqual(['p2', 'p1', 'p3']);
  });

  it('filters to approval and blocked runs for "needs you"', () => {
    expect(filterProjects(rows, '', 'needs-you').map((r) => r.project.id)).toEqual(['p2']);
    const blocked = row({ project: project('p4', 'Delta', 'delta'), state: run('blocked') });
    expect(filterProjects([...rows, blocked], '', 'needs-you').map((r) => r.project.id)).toEqual(['p2', 'p4']);
  });

  it('treats a ready deployment as live, not a phase', () => {
    // A project can be done with nothing deployed if the deployment failed or
    // was removed; "Live" must mean it is serving.
    const finishedOnly = row({ project: project('p5', 'Epsilon', 'epsilon'), state: run('done'), live: null });
    const deploying = row({
      project: project('p6', 'Zeta', 'zeta'),
      state: run('done'),
      live: deployment({ id: 'dpl_2', ready_state: 'BUILDING' }),
    });
    expect(filterProjects([...rows, finishedOnly, deploying], '', 'live').map((r) => r.project.id)).toEqual(['p3']);
  });

  it('matches name or slug, case-insensitively, and trims the query', () => {
    expect(filterProjects(rows, '  ALP ', 'all')).toHaveLength(1);
    expect(filterProjects(rows, 'beta', 'all')[0]?.project.id).toBe('p2');
    expect(filterProjects(rows, 'gamma', 'all')[0]?.project.id).toBe('p3');
    expect(filterProjects(rows, 'nothing', 'all')).toHaveLength(0);
  });
});

describe('projects page', () => {
  it('shows the project, its slug and freshness', () => {
    const html = projectsPage([row({ live: deployment() })], ctx);
    expect(html).toContain('Bakery greeter');
    expect(html).toContain('bakery-greeter');
    expect(html).toContain('updated');
  });

  it('escapes a hostile project name', () => {
    const html = projectsPage([row({ project: project('p9', '<script>alert(1)</script>', 'xss') })], ctx);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('has a real empty state for a new account', () => {
    const html = projectsPage([], ctx);
    expect(html).toContain('No projects yet');
    expect(html).toContain('+ New app');
    expect(html).toContain('data-new-app="new"');
    expect(html).toContain('Approve and publish');
    expect(html).not.toContain('list-tools');
  });

  it('names the account by email and offers a way out', () => {
    const html = projectsPage([], ctx);
    expect(html).toContain('ada@example.com');
    expect(html).toContain('href="/logout"');
    // The opaque tenant id is not an identity a person recognises.
    expect(html).not.toContain('user_ada');
  });

  it('falls back to the id when no address is on file', () => {
    const html = projectsPage([], { ...ctx, email: null });
    expect(html).toContain('user_ada');
  });

  it('distinguishes no matches from no projects, and keeps the search in filter links', () => {
    const html = projectsPage([row()], ctx, { q: 'bakery', filter: 'all' });
    expect(html).toContain('1 of 1 projects');
    expect(html).toContain('q=bakery&amp;state=live');

    const none = projectsPage([row()], ctx, { q: 'nothing', filter: 'all' });
    expect(none).toContain('No projects match');
    expect(none).toContain('Clear search');
    expect(none).not.toContain('class="row"');
  });
});

describe('project page', () => {
  it('offers approval only in the approval phase', () => {
    const waiting = projectPage(view(run('spec_approval')), ctx);
    expect(waiting).toContain('Your plan is ready');
    expect(waiting).toContain('/projects/p1/approve-spec');
    expect(waiting).toContain('/projects/p1/spec');

    const building = projectPage(view(run('build')), ctx);
    expect(building).not.toContain('approve-spec');
    expect(building).toContain('Nothing needs you');
  });

  it('shows a blocked reason as text, not markup', () => {
    const html = projectPage(view(run('blocked', { blocked_reason: 'Stuck <b>here</b>' })), ctx);
    expect(html).toContain('The run stopped and needs you');
    expect(html).toContain('Stuck &lt;b&gt;here&lt;/b&gt;');
  });

  it('links to the live app with a scheme even for a legacy host-only URL', () => {
    const legacy = deployment({ url: 'localhost:4400/previews/dpl_1/' });
    const html = projectPage(view(run('done'), { deployments: [legacy] }), ctx);
    expect(html).toContain('href="http://localhost:4400/previews/dpl_1/"');
    expect(html).toContain('Open the app');
    expect(html).toContain('/projects/p1/export');
  });

  it('lists the gates in the order a run meets them', () => {
    const html = projectPage(view(run('verify')), ctx);
    expect(html.indexOf('Research</div>')).toBeLessThan(html.indexOf('Plan</div>'));
    expect(html.indexOf('Plan</div>')).toBeLessThan(html.indexOf('Verification</div>'));
  });
});

describe('settings', () => {
  it('renders the current name, a CSRF field and the immutable slug', () => {
    const html = settingsPage(view(run('build')), ctx);
    expect(html).toContain('value="Bakery greeter"');
    expect(html).toContain('name="csrf"');
    expect(html).toContain('stays the same');
    expect(html).toContain('bakery-greeter');
  });

  it('reports a saved rename without inventing a success state', () => {
    expect(settingsPage(view(run('build')), ctx, { saved: true })).toContain('Saved.');
    expect(settingsPage(view(run('build')), ctx)).not.toContain('Saved.');
  });
});

describe('validateProjectName', () => {
  it('normalises whitespace', () => {
    expect(validateProjectName('  Bakery   greeter  ')).toEqual({ ok: true, name: 'Bakery greeter' });
  });

  it('refuses empty, overlong and control-character names', () => {
    expect(validateProjectName('   ').ok).toBe(false);
    expect(validateProjectName('x'.repeat(81)).ok).toBe(false);
    expect(validateProjectName('Bad\u0000name').ok).toBe(false);
  });

  it('accepts exactly eighty characters', () => {
    expect(validateProjectName('x'.repeat(80))).toEqual({ ok: true, name: 'x'.repeat(80) });
  });
});

describe('relative time', () => {
  const now = new Date('2026-11-02T12:00:00.000Z').getTime();

  it('rounds to something a person would say', () => {
    expect(relative('2026-11-02T11:59:30.000Z', now)).toBe('just now');
    expect(relative('2026-11-02T11:55:00.000Z', now)).toBe('5m ago');
    expect(relative('2026-11-02T09:00:00.000Z', now)).toBe('3h ago');
    expect(relative('2026-10-31T12:00:00.000Z', now)).toBe('2d ago');
  });

  it('falls back to an exact date instead of a wrong relative one', () => {
    expect(relative('2020-01-01T00:00:00.000Z', now)).toContain('2020');
  });
});

describe('rename persistence', () => {
  it('changes the display name and leaves the slug alone', async () => {
    const store = new MemoryStore();
    await store.createProject(project(), createRunState('run_1'));
    const renamed = await store.renameProject('p1', 'Corner bakery');
    expect(renamed.name).toBe('Corner bakery');
    expect(renamed.slug).toBe('bakery-greeter');
    expect((await store.getProject('p1'))?.name).toBe('Corner bakery');
  });

  it('refuses a project that does not exist rather than creating one', async () => {
    await expect(new MemoryStore().renameProject('missing', 'Name')).rejects.toThrow(/not found/);
  });
});
