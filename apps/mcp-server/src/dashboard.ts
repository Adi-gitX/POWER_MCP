/**
 * The web companion.
 *
 * Everything an assistant is not allowed to decide for itself happens here, so
 * this is not a status page with a few buttons bolted on — it is the half of
 * the product the conversation cannot reach. Two rules shape it:
 *
 *   1. Every screen states what is true and what is needed next. If the data
 *      does not exist, the page says so rather than filling the space.
 *   2. It is rendered from the same run state the tools use. A dashboard that
 *      guesses is worse than no dashboard, because it is believed.
 *
 * Deliberately server-rendered and dependency-free: it has to work when the
 * only thing running is the MCP server, including over a slow connection.
 */
import { phaseLabel, retriesRemaining, type Phase, type RunState } from '@power/runstate';
import { TOOLS, type Plan } from '@power/protocol';
import type { Approvals, DeploymentRecord, Project } from './store.js';
import type { SecretRecord } from './secrets.js';

const VERSION = '7';

export interface PageContext {
  baseUrl: string;
  user: string;
  plan: Plan;
  remaining: { day: number; week: number | null };
}

export interface MigrationView {
  intent: string;
  pass: boolean;
  destructive: boolean;
  summary: string[];
  promoted_at?: string | undefined;
}

export interface ProjectView {
  project: Project;
  state: RunState;
  approvals: Approvals;
  publish: { allowed: boolean; missing: string[] };
  live: { version: string | null; live_path: string | null };
  deployments: DeploymentRecord[];
  secrets: SecretRecord[];
  migration: MigrationView | null;
  spec: string | null;
  previewUrl: string | null;
  csrf: string;
  dbLabel: string;
  deployerLabel: string;
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A stored URL may predate the fix that gave it a scheme; show something clickable either way. */
function absolute(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(raw)) return `http://${raw}`;
  return `https://${raw}`;
}

/** Release tags are already `v3`; do not print `vv3`. */
const versionLabel = (version: string | null | undefined): string =>
  version ? (/^v/i.test(version) ? version : `v${version}`) : '—';

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** For dates old enough that the year is not obvious. */
function whenDated(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Coarse freshness for a list row. The exact timestamp is one click away; a
 * row that says "2 Nov, 17:54" makes the reader do date arithmetic for no gain.
 */
export function relative(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return when(iso);
  const seconds = Math.max(0, Math.round((now - t) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return whenDated(iso);
}

const MARK_PATH =
  'M11 465 L1 490 L1 517 L10 540 L29 561 L171 654 L278 728 L303 738 L317 740 L339 739 L356 734 L375 723 L392 703 L399 686 L401 668 L397 648 L385 628 L369 615 L99 445 L85 439 L62 436 L43 440 L24 451Z M13 223 L6 251 L6 275 L9 292 L23 324 L44 349 L62 362 L163 421 L279 493 L445 601 L461 608 L493 613 L512 610 L529 603 L667 523 L687 505 L703 477 L707 461 L708 439 L702 414 L692 396 L683 386 L657 370 L638 366 L611 369 L512 426 L487 432 L461 431 L434 421 L293 333 L133 238 L105 210 L94 188 L90 171 L68 173 L43 185 L24 204Z M140 140 L139 154 L143 170 L150 182 L163 195 L316 285 L433 358 L457 367 L482 368 L503 362 L665 272 L676 264 L687 251 L696 229 L697 212 L693 195 L683 178 L669 165 L410 12 L381 1 L347 1 L318 12 L163 106 L149 120Z';

const MARK = `<svg viewBox="0 0 709 741" aria-hidden="true" focusable="false"><path d="${MARK_PATH}" fill="currentColor"/></svg>`;

// ------------------------------------------------------------------- shell

function shell(ctx: PageContext, title: string, body: string, active?: 'projects' | 'connect'): string {
  const navItem = (href: string, label: string, key: 'projects' | 'connect') =>
    `<a href="${href}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex">
<title>${esc(title)} · Power</title>
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/dashboard.css?v=${VERSION}">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="bar">
  <div class="bar-in">
    <a class="brand" href="/">${MARK}<span>Power</span></a>
    <nav aria-label="Workspace">${navItem('/', 'Projects', 'projects')}${navItem('/connect', 'Connect', 'connect')}</nav>
    <div class="who">
      <span class="plan">${esc(ctx.plan)}</span>
      <span class="quota">${ctx.remaining.day} ${ctx.remaining.day === 1 ? 'action' : 'actions'} left today</span>
    </div>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="foot">
  <span>Power</span><span aria-hidden="true">·</span>
  <span class="mono">${esc(ctx.baseUrl.replace(/^https?:\/\//, ''))}/mcp</span>
  <span class="spacer"></span>
  <span>${esc(ctx.user)}</span>
</footer>
<script>
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const value = button.getAttribute('data-copy') || '';
    try { await navigator.clipboard.writeText(value); } catch { return; }
    const original = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = original; }, 1400);
  });
}
</script>
</body>
</html>`;
}

/** Pages reached without a session: the secret form and hard errors. */
function bare(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex">
<title>${esc(title)} · Power</title>
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/dashboard.css?v=${VERSION}">
</head>
<body class="bare">
<main class="bare-main">
  <a class="brand" href="/">${MARK}<span>Power</span></a>
  ${body}
</main>
</body>
</html>`;
}

// ---------------------------------------------------------------- projects

export interface ProjectRow {
  project: Project;
  state: RunState;
  live: DeploymentRecord | null;
}

const TONE: Record<Phase, 'you' | 'live' | 'work' | 'stop'> = {
  intake: 'work',
  research: 'work',
  research_review: 'work',
  spec: 'work',
  spec_approval: 'you',
  build: 'work',
  verify: 'work',
  done: 'live',
  blocked: 'stop',
};

const STATUS: Record<Phase, string> = {
  intake: 'Starting',
  research: 'Researching',
  research_review: 'Reviewing research',
  spec: 'Planning',
  spec_approval: 'Needs you',
  build: 'Building',
  verify: 'Verifying',
  done: 'Live',
  blocked: 'Blocked',
};

export type ProjectFilter = 'all' | 'needs-you' | 'live';

const FILTERS: ReadonlyArray<{ key: ProjectFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'needs-you', label: 'Needs you' },
  { key: 'live', label: 'Live' },
];

const needsUser = (row: ProjectRow) => row.state.phase === 'spec_approval' || row.state.phase === 'blocked';

/** "Live" is a ready deployment, not a phase: a new run can be in progress while the old app still serves. */
const isLive = (row: ProjectRow) => row.live !== null && row.live.ready_state === 'READY';

function sortProjects(rows: ProjectRow[]): ProjectRow[] {
  const rank = (r: ProjectRow) => (needsUser(r) ? 0 : r.state.phase === 'done' ? 2 : 1);
  return [...rows].sort((a, b) => rank(a) - rank(b) || b.project.created_at.localeCompare(a.project.created_at));
}

/**
 * Filtering is a pure function so it can be tested without a browser, and so
 * the same rules apply however the query arrived.
 */
export function filterProjects(rows: ProjectRow[], query: string, filter: ProjectFilter): ProjectRow[] {
  const needle = query.trim().toLowerCase();
  return sortProjects(rows).filter((row) => {
    if (filter === 'needs-you' && !needsUser(row)) return false;
    if (filter === 'live' && !isLive(row)) return false;
    if (!needle) return true;
    return row.project.name.toLowerCase().includes(needle) || row.project.slug.toLowerCase().includes(needle);
  });
}

export interface ProjectsOptions {
  q?: string;
  filter?: ProjectFilter;
}

/** Build a filter link that keeps the current search. */
function filterHref(query: string, filter: ProjectFilter): string {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (filter !== 'all') params.set('state', filter);
  const search = params.toString();
  return search ? `/?${search}` : '/';
}

export function projectsPage(rows: ProjectRow[], ctx: PageContext, options: ProjectsOptions = {}): string {
  const query = (options.q ?? '').trim();
  const filter = options.filter ?? 'all';
  const projects = filterProjects(rows, query, filter);
  const needs = rows.filter(needsUser).length;
  const filtered = query !== '' || filter !== 'all';
  // Counts reflect the search, not the selected status, so "All 0" beside an
  // empty result means what it says instead of advertising projects that the
  // query already excluded.
  const searched = filterProjects(rows, query, 'all');
  const counts: Record<ProjectFilter, number> = {
    all: searched.length,
    'needs-you': searched.filter(needsUser).length,
    live: searched.filter(isLive).length,
  };

  const toolbar = rows.length
    ? `<div class="list-tools">
  <form class="search" method="get" action="/" role="search">
    <label class="sr-only" for="q">Search projects</label>
    <input id="q" name="q" type="search" value="${esc(query)}" placeholder="Search by name or slug" autocomplete="off">
    ${filter !== 'all' ? `<input type="hidden" name="state" value="${filter}">` : ''}
    <button class="btn btn-sm" type="submit">Search</button>
    ${filtered ? '<a class="clear" href="/">Clear</a>' : ''}
  </form>
  <nav class="filters" aria-label="Filter projects">
    ${FILTERS.map(
      (f) =>
        `<a href="${esc(filterHref(query, f.key))}"${f.key === filter ? ' aria-current="page"' : ''}>${esc(f.label)} <span class="count">${counts[f.key]}</span></a>`,
    ).join('')}
  </nav>
</div>`
    : '';

  const list = !projects.length
    ? rows.length
      ? `<div class="empty empty-search">
  <h2>No projects match</h2>
  <p>Nothing here matches ${query ? `“${esc(query)}”` : 'that filter'}${filter !== 'all' ? ' and the selected status' : ''}.</p>
  <a class="btn" href="/">Clear search</a>
</div>`
      : `<div class="empty">
  <h2>No projects yet</h2>
  <p>Power builds an app from a conversation. Connect an MCP client to this server and ask it to create one — the project appears here as soon as it exists.</p>
  <a class="btn btn-primary" href="/connect">Connect an assistant</a>
</div>`
    : `<div class="rows">${projects
        .map(({ project, state, live }) => {
          const tone = TONE[state.phase];
          return `<a class="row" href="/projects/${project.id}">
  <span class="row-main">
    <span class="row-name">${esc(project.name)}</span>
    <span class="row-sub">${esc(project.slug)}<span class="row-updated"> · updated ${esc(relative(state.updated_at))}</span>${live ? ` · live ${esc(versionLabel(live.version))}` : ''}</span>
  </span>
  <span class="row-state"><span class="chip" data-tone="${tone}">${esc(STATUS[state.phase])}</span></span>
  <span class="row-go">View <span aria-hidden="true">→</span></span>
</a>`;
        })
        .join('')}</div>`;

  return shell(
    ctx,
    'Projects',
    `<header class="page-head">
  <div>
    <h1>Projects</h1>
    <p class="lede">What your assistant is building, and the decisions it cannot make without you.</p>
  </div>
  ${needs ? `<div class="stat"><span class="stat-n">${needs}</span><span class="stat-l">need${needs === 1 ? 's' : ''} you</span></div>` : ''}
</header>
${toolbar}
${filtered && projects.length ? `<p class="result-note">${projects.length} of ${rows.length} projects</p>` : ''}
${list}
<section class="connect-strip">
  <div>
    <h2>MCP endpoint</h2>
    <p class="note">Point an MCP client here. It uses the account this page is signed in to.</p>
  </div>
  <div class="copyline">
    <code>${esc(ctx.baseUrl)}/mcp</code>
    <button class="btn" type="button" data-copy="${esc(ctx.baseUrl)}/mcp">Copy</button>
  </div>
</section>`,
    'projects',
  );
}

// ------------------------------------------------------------- project page

const MILESTONES = [
  { key: 'started', label: 'Started' },
  { key: 'research', label: 'Research' },
  { key: 'plan', label: 'Plan' },
  { key: 'build', label: 'Build' },
  { key: 'verified', label: 'Verified' },
  { key: 'live', label: 'Live' },
] as const;

type Milestone = (typeof MILESTONES)[number];
type StepState = 'done' | 'now' | 'todo';

const EVENT: Record<string, string> = {
  start_research: 'Research started',
  research_skipped: 'Research skipped by choice',
  gate_result: 'Gate checked',
  checkpoint_acknowledged: 'Research reviewed',
  spec_approved: 'You approved the plan',
  spec_rejected: 'You sent the plan back',
  build_started: 'Build started',
  self_verify: 'Self-check recorded',
  start_verification: 'Verification started',
  retry: 'Sent back to rework',
  published: 'Published',
  worker_finished: 'Worker finished',
  block: 'Run blocked',
  unblock: 'Run resumed',
};

/** A milestone is a fact about the run, not a position in a list. */
function stepFor(state: RunState, key: Milestone['key']): { state: StepState; detail: string } {
  const inPhase = (phases: readonly Phase[]) => phases.includes(state.phase);
  const entered = (phases: readonly Phase[]) => state.history.find((e) => phases.includes(e.to))?.at ?? null;
  const event = (name: string) => state.history.find((e) => e.event === name)?.at ?? null;

  switch (key) {
    case 'started':
      return inPhase(['intake'])
        ? { state: 'now', detail: phaseLabel(state.phase) }
        : { state: 'done', detail: when(state.created_at) };

    case 'research': {
      if (state.gates.research === 'pass') {
        return { state: 'done', detail: when(entered(['research', 'research_review']) ?? state.updated_at) };
      }
      // A skip is recorded as a skip, never dressed up as a pass.
      if (state.gates.research === 'skipped') return { state: 'done', detail: 'Skipped by choice' };
      if (state.gates.research === 'fail') {
        return inPhase(['research', 'research_review'])
          ? { state: 'now', detail: 'Needs rework' }
          : { state: 'todo', detail: 'Failed' };
      }
      return inPhase(['research', 'research_review'])
        ? { state: 'now', detail: phaseLabel(state.phase) }
        : { state: 'todo', detail: 'Not yet' };
    }

    case 'plan': {
      if (state.approved_spec) {
        const at = event('spec_approved');
        return { state: 'done', detail: at ? `Approved ${when(at)}` : 'Approved' };
      }
      if (inPhase(['spec', 'spec_approval'])) {
        return {
          state: 'now',
          detail: state.phase === 'spec_approval' ? 'Waiting for your approval' : 'Writing the plan',
        };
      }
      return { state: 'todo', detail: 'Not yet' };
    }

    case 'build': {
      if (inPhase(['verify', 'done'])) {
        return { state: 'done', detail: when(entered(['verify', 'done']) ?? state.updated_at) };
      }
      return inPhase(['build']) ? { state: 'now', detail: 'Building' } : { state: 'todo', detail: 'Not yet' };
    }

    case 'verified': {
      if (state.gates.verification === 'pass') return { state: 'done', detail: 'Every requirement checked' };
      return inPhase(['verify'])
        ? { state: 'now', detail: 'Checking the work' }
        : { state: 'todo', detail: 'Not yet' };
    }

    case 'live': {
      if (!inPhase(['done'])) return { state: 'todo', detail: 'Not yet' };
      const at = event('published');
      return { state: 'now', detail: at ? when(at) : 'Published' };
    }
  }
}

function timeline(state: RunState): string {
  const steps = MILESTONES.map((m) => {
    const step = stepFor(state, m.key);
    const live = m.key === 'live' && state.phase === 'done' ? ' data-live="1"' : '';
    return `<li class="step" data-state="${step.state}"${live}>
  <span class="dot" aria-hidden="true"></span>
  <span class="step-body"><span class="step-label">${esc(m.label)}</span><span class="step-when">${esc(step.detail)}</span></span>
</li>`;
  });

  if (state.phase === 'blocked') {
    steps.push(`<li class="step" data-state="now" data-stop="1">
  <span class="dot" aria-hidden="true"></span>
  <span class="step-body"><span class="step-label">Needs your help</span><span class="step-when">${esc(when(state.updated_at))}</span></span>
</li>`);
  }

  return `<ol class="steps">${steps.join('')}</ol>`;
}

const GATE_COPY: ReadonlyArray<{ key: 'research' | 'spec' | 'verification'; name: string; what: string }> = [
  {
    key: 'research',
    name: 'Research',
    what: 'Sources were collected and checked before the plan was written. May be skipped, and a skip is recorded as a skip.',
  },
  {
    key: 'spec',
    name: 'Plan',
    what: 'The plan has the sections, scope and acceptance criteria a build needs. Checked by code, then approved by you.',
  },
  {
    key: 'verification',
    name: 'Verification',
    what: 'Every must-have requirement was exercised in a browser against the running app. Has no skip path.',
  },
];

function gateWord(status: string): { label: string; tone: string } {
  if (status === 'pass') return { label: 'Passed', tone: 'live' };
  if (status === 'fail') return { label: 'Failed', tone: 'you' };
  if (status === 'skipped') return { label: 'Skipped', tone: 'work' };
  return { label: 'Not yet', tone: 'work' };
}

function gates(state: RunState): string {
  const rows = GATE_COPY.map((g) => {
    const status = state.gates[g.key];
    const word = gateWord(status);
    return `<tr>
  <td><div class="gate-name">${esc(g.name)}</div><div class="gate-desc">${esc(g.what)}</div></td>
  <td class="gate-cell"><span class="chip" data-tone="${word.tone}">${word.label}</span></td>
</tr>`;
  }).join('');
  return `<table class="gates"><tbody>${rows}</tbody></table>`;
}

function historyTable(state: RunState): string {
  if (!state.history.length) return '<p class="note">No transitions recorded yet.</p>';
  const rows = [...state.history]
    .reverse()
    .map((entry) => {
      const label = EVENT[entry.event] ?? entry.event.replace(/_/g, ' ');
      const detail = entry.note ? `<div class="hist-note">${esc(entry.note)}</div>` : '';
      return `<tr>
  <td class="hist-time">${esc(when(entry.at))}</td>
  <td><div>${esc(label)}</div>${detail}</td>
  <td class="hist-move"><span class="mono">${esc(entry.from)}</span> <span aria-hidden="true">→</span> <span class="mono">${esc(entry.to)}</span></td>
</tr>`;
    })
    .join('');
  return `<table class="hist"><tbody>${rows}</tbody></table>`;
}

function decision(view: ProjectView): string {
  const { project, state, approvals, publish } = view;
  const csrf = view.csrf;
  const id = project.id;

  if (state.phase === 'spec_approval') {
    return `<section class="decision" data-tone="you" aria-labelledby="decision-title">
  <h2 id="decision-title">Your plan is ready</h2>
  <p>Read it before you approve. Approval decides <em>what</em> gets built; the structure has already been checked by code. Your assistant cannot approve this for itself.</p>
  <div class="actions">
    ${view.spec ? `<a class="btn" href="/projects/${id}/spec">Read the plan</a>` : ''}
    <form method="post" action="/projects/${id}/approve-spec">${csrf}<button class="btn btn-primary" type="submit">Approve the plan</button></form>
  </div>
  <form class="sendback" method="post" action="/projects/${id}/reject-spec">
    ${csrf}
    <label for="reason">Or send it back with a reason</label>
    <div class="sendback-row">
      <input id="reason" type="text" name="reason" placeholder="What should change?" autocomplete="off" required>
      <button class="btn" type="submit">Send back</button>
    </div>
  </form>
</section>`;
  }

  if (state.phase === 'verify' && publish.allowed) {
    if (approvals.publish_confirmed_at) {
      return `<section class="decision" data-tone="live" aria-labelledby="decision-title">
  <h2 id="decision-title">Confirmed</h2>
  <p>Your assistant can publish now. The confirmation is used once, by that publish.</p>
</section>`;
    }
    return `<section class="decision" data-tone="you" aria-labelledby="decision-title">
  <h2 id="decision-title">Verified. Publish it?</h2>
  <p>Verification passed, your plan is approved and the build's own checks are green. Publishing makes <strong>${esc(project.name)}</strong> live.</p>
  <form method="post" action="/projects/${id}/confirm-publish">${csrf}<button class="btn btn-primary" type="submit">Confirm publish</button></form>
</section>`;
  }

  if (state.phase === 'blocked') {
    return `<section class="decision" data-tone="stop" aria-labelledby="decision-title">
  <h2 id="decision-title">The run stopped and needs you</h2>
  <p>${esc(state.blocked_reason ?? 'No reason was recorded.')}</p>
  <p class="note">Nothing has been published. Ask your assistant to restore a checkpoint, or tell it how to proceed.</p>
</section>`;
  }

  if (state.phase === 'done') {
    const release = view.deployments[0] ?? null;
    const url = release ? absolute(release.url) : null;
    const version = release?.version ?? view.live.version;
    return `<section class="decision" data-tone="live" aria-labelledby="decision-title">
  <h2 id="decision-title">Live</h2>
  <p>${version ? `Version <span class="mono">${esc(versionLabel(version))}</span> is serving.` : 'The latest release is serving.'} Your assistant can still change it through a new run.</p>
  ${url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noreferrer">Open the app</a>` : ''}
</section>`;
  }

  return `<section class="quiet" aria-labelledby="decision-title">
  <h2 id="decision-title">Nothing needs you</h2>
  <p>${esc(phaseLabel(state.phase))}. Your assistant is working; this page updates when the run reaches something that needs a decision.</p>
</section>`;
}

function migrationBlock(view: ProjectView): string {
  const migration = view.migration;
  if (!migration || !migration.pass || migration.promoted_at) return '';
  const { project, approvals, csrf } = view;
  const lines = migration.summary.map((line) => `<li>${esc(line)}</li>`).join('');
  const heading = migration.destructive ? 'A data change needs your confirmation' : 'A data change is ready';

  const action = migration.destructive
    ? approvals.migration_confirmed_at
      ? '<p class="note">Confirmed. Ask your assistant to call <code>promote_migration</code>.</p>'
      : `<form class="confirm" method="post" action="/projects/${project.id}/confirm-migration">
  ${csrf}
  <label for="migration-confirm">Type <span class="mono">${esc(project.slug)}</span> to confirm</label>
  <div class="sendback-row">
    <input id="migration-confirm" type="text" name="confirm" autocomplete="off" required placeholder="${esc(project.slug)}">
    <button class="btn btn-primary" type="submit">Apply to live app</button>
  </div>
</form>`
    : '<p class="note">Nothing existing is removed. It reaches the live app during verification.</p>';

  return `<section class="decision" data-tone="${migration.destructive ? 'you' : 'work'}" aria-labelledby="migration-title">
  <h2 id="migration-title">${esc(heading)}</h2>
  <p><strong>${esc(migration.intent)}</strong></p>
  <ul class="list">${lines}</ul>
  ${migration.destructive ? '<p>This can lose data. Your assistant cannot apply it without the confirmation below.</p>' : ''}
  ${action}
</section>`;
}

function livePanel(view: ProjectView): string {
  const latest = view.deployments[0] ?? null;
  const liveUrl = latest ? absolute(latest.url) : null;
  // A new run can be in progress while the previous release is still serving,
  // so "live" is a fact about the deployment, not about the current phase.
  const serving = latest?.ready_state === 'READY';

  const body = latest
    ? `<div class="live-head"><span class="chip" data-tone="${serving ? 'live' : 'work'}">${serving ? 'Live' : 'Deploying'}</span><span class="mono dim">${esc(versionLabel(latest.version))}</span></div>
<p class="live-url mono"><a href="${esc(liveUrl!)}" target="_blank" rel="noreferrer">${esc(liveUrl!.replace(/^https?:\/\//, ''))}</a></p>
<div class="actions">
  <a class="btn btn-sm" href="${esc(liveUrl!)}" target="_blank" rel="noreferrer">Open</a>
  <a class="btn btn-sm" href="/projects/${view.project.id}/export" download>Export code</a>
</div>`
    : `<div class="live-head"><span class="chip" data-tone="work">Not published</span></div>
<p class="note">Nothing is live yet. ${view.publish.allowed ? 'The run is ready to publish.' : 'Publishing needs the conditions below.'}</p>
<ul class="conditions">${view.publish.missing.map((m) => `<li>${esc(m)}</li>`).join('') || '<li>All publish conditions are met.</li>'}</ul>
<a class="btn btn-sm" href="/projects/${view.project.id}/export" download>Export code</a>`;

  const deployments = view.deployments.length
    ? `<details class="deploys"><summary>${view.deployments.length} release${view.deployments.length === 1 ? '' : 's'}</summary><ul class="deploy-list">${view.deployments
        .map((d) => `<li><span class="mono">${esc(d.version ? versionLabel(d.version) : d.id)}</span><span class="dim">${esc(when(d.created_at))}</span></li>`)
        .join('')}</ul></details>`
    : '';

  return `<section class="panel"><h2>Live</h2>${body}${deployments}</section>`;
}

/**
 * The services this project actually uses. No placeholders for email, storage
 * or jobs: Power has no provider behind them, and an empty row would read as
 * a feature that exists.
 */
function servicesPanel(view: ProjectView): string {
  const latest = view.deployments[0] ?? null;
  const serving = latest?.ready_state === 'READY';
  return `<section class="panel">
  <h2>Services</h2>
  <ul class="services">
    <li>
      <span class="service"><span class="service-name">Database</span><span class="service-meta">${esc(view.dbLabel)}</span></span>
      <span class="status" data-tone="live">Configured</span>
    </li>
    <li>
      <span class="service"><span class="service-name">Hosting</span><span class="service-meta">${esc(view.deployerLabel)}</span></span>
      <span class="status" data-tone="${serving ? 'live' : 'idle'}">${serving ? 'Serving' : 'Idle'}</span>
    </li>
    <li>
      <span class="service"><span class="service-name">Secrets</span><span class="service-meta">${view.secrets.length ? `${view.secrets.length} set` : 'None set'}</span></span>
      <span class="status" data-tone="${view.secrets.length ? 'live' : 'idle'}">${view.secrets.length ? 'Configured' : 'Empty'}</span>
    </li>
  </ul>
</section>`;
}

function detailsPanel(view: ProjectView): string {
  const { project, state } = view;
  return `<section class="panel">
  <h2>Details</h2>
  <dl class="kv">
    <dt>Project ID</dt><dd><button class="copy-inline" type="button" data-copy="${esc(project.id)}" title="Copy project id">${esc(project.id)}</button></dd>
    <dt>Created</dt><dd>${esc(when(project.created_at))}</dd>
    <dt>Updated</dt><dd title="${esc(when(state.updated_at))}">${esc(relative(state.updated_at))}</dd>
    <dt>Run trace</dt><dd class="truncate" title="${esc(state.trace_id)}">${esc(state.trace_id.slice(0, 12))}</dd>
  </dl>
</section>`;
}

function secretsPanel(view: ProjectView): string {
  if (!view.secrets.length) {
    return `<section class="panel"><h2>Secrets</h2><p class="note">None set. Your assistant can request one; the value is entered here or on a one-time link and never reaches the conversation.</p></section>`;
  }
  return `<section class="panel"><h2>Secrets</h2>
  <ul class="secret-list">${view.secrets
    .map((s) => `<li><span class="mono">${esc(s.name)}</span><span class="dim">${esc(s.env)}</span></li>`)
    .join('')}</ul>
  <p class="note">Values are never shown, here or in the conversation. Only the name and a fingerprint are visible.</p></section>`;
}

export function projectPage(view: ProjectView, ctx: PageContext): string {
  const { project, state } = view;

  // Kept explicit rather than clever: the three edges have different meanings
  // and a reader should see each one named.
  const revisions = retriesRemaining(state, 'spec_revision');
  const fixes = retriesRemaining(state, 'needs_fixes');
  const refetches = retriesRemaining(state, 'research_refetch');
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const budget = `<dl class="budget">
  <div><dt>Plan ${plural(revisions, 'revision', 'revisions')} left</dt><dd>${revisions}</dd></div>
  <div><dt>${plural(fixes, 'Fix loop', 'Fix loops')} left</dt><dd>${fixes}</dd></div>
  <div><dt>Research ${plural(refetches, 'refetch', 'refetches')} left</dt><dd>${refetches}</dd></div>
</dl>`;

  // At done the live app is the thing to open; the workbench server is
  // yesterday's build and offering both is a way to confuse the two.
  const preview =
    view.previewUrl && state.phase !== 'done'
      ? `<p class="preview-link"><a class="btn btn-sm" href="${esc(view.previewUrl)}" target="_blank" rel="noreferrer">Open the work in progress</a></p>`
      : '';

  const unpublish = `<details class="danger">
  <summary>Take the live app offline</summary>
  <div class="danger-body">
    <p>This removes the deployment. Your hosting project, domains, code and history stay as they are. This is not a rollback, and it cannot be undone from here.</p>
    ${view.approvals.unpublish_confirmed_at
      ? '<p class="note">Confirmed. Ask your assistant to call <code>unpublish_app</code>.</p>'
      : `<form class="confirm" method="post" action="/projects/${project.id}/confirm-unpublish">
      ${view.csrf}
      <label for="unpublish-confirm">Type <span class="mono">${esc(project.slug)}</span> to confirm</label>
      <div class="sendback-row">
        <input id="unpublish-confirm" type="text" name="confirm" autocomplete="off" required placeholder="${esc(project.slug)}">
        <button class="btn btn-danger" type="submit">Take offline</button>
      </div>
    </form>`}
  </div>
</details>`;

  const body = `<nav class="crumb" aria-label="Breadcrumb"><a href="/">Projects</a><span aria-hidden="true">/</span><span aria-current="page">${esc(project.name)}</span></nav>
<header class="proj-head">
  <div>
    <h1>${esc(project.name)}</h1>
    <p class="meta"><span class="mono">${esc(project.slug)}</span><span aria-hidden="true">·</span><span>Created ${esc(when(project.created_at))}</span><span aria-hidden="true">·</span><span>${esc(phaseLabel(state.phase))}</span></p>
  </div>
  <div class="proj-head-actions">
    <a class="btn btn-sm" href="/projects/${project.id}/settings">Settings</a>
    <span class="chip chip-lg" data-tone="${TONE[state.phase]}">${esc(STATUS[state.phase])}</span>
  </div>
</header>
${decision(view)}
${migrationBlock(view)}
${preview}

<div class="proj-grid">
  <div class="proj-main">
    <section>
      <h2>Progress</h2>
      ${timeline(state)}
      ${budget}
    </section>

    <section>
      <h2>Checks</h2>
      ${gates(state)}
    </section>

    <section>
      <h2>History</h2>
      ${historyTable(state)}
    </section>

    ${unpublish}
  </div>

  <aside class="side">
    ${livePanel(view)}
    ${servicesPanel(view)}
    ${detailsPanel(view)}
    ${secretsPanel(view)}
  </aside>
</div>`;

  return shell(ctx, project.name, body, 'projects');
}

export function specPage(view: ProjectView, ctx: PageContext): string {
  const body = `<nav class="crumb" aria-label="Breadcrumb"><a href="/">Projects</a><span aria-hidden="true">/</span><a href="/projects/${view.project.id}">${esc(view.project.name)}</a><span aria-hidden="true">/</span><span aria-current="page">Plan</span></nav>
<header class="proj-head">
  <div><h1>Plan</h1><p class="meta"><span class="mono">SPEC.md</span><span aria-hidden="true">·</span><span>${view.spec ? `${view.spec.split('\n').length} lines` : 'not written yet'}</span></p></div>
  <a class="btn" href="/projects/${view.project.id}">Back to project</a>
</header>
${view.spec ? `<article class="doc"><pre>${esc(view.spec)}</pre></article>` : '<p class="note">No plan has been submitted yet.</p>'}`;
  return shell(ctx, `${view.project.name} plan`, body, 'projects');
}

// ----------------------------------------------------------------- settings

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

/**
 * One rule, used by the form and by the endpoint.
 *
 * The slug is not accepted here at all: it is the phrase a person types to
 * confirm publishing, taking an app offline and applying a data change, so it
 * must not move under them.
 */
export function validateProjectName(raw: string): NameCheck {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, error: 'Give the project a name.' };
  if (name.length > 80) return { ok: false, error: 'A project name can be at most 80 characters.' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    return { ok: false, error: 'A project name cannot contain control characters.' };
  }
  return { ok: true, name };
}

export interface SettingsOptions {
  saved?: boolean;
  error?: string;
}

export function settingsPage(view: ProjectView, ctx: PageContext, options: SettingsOptions = {}): string {
  const project = view.project;
  const body = `<nav class="crumb" aria-label="Breadcrumb"><a href="/">Projects</a><span aria-hidden="true">/</span><a href="/projects/${project.id}">${esc(project.name)}</a><span aria-hidden="true">/</span><span aria-current="page">Settings</span></nav>
<header class="page-head">
  <div>
    <h1>Settings</h1>
    <p class="lede">How this project is named and where it runs. Nothing here changes the code.</p>
  </div>
</header>

<div class="settings-grid">
  <section class="panel settings-card">
    <h2>Name</h2>
    <form class="settings-form" method="post" action="/projects/${project.id}/rename">
      ${view.csrf}
      <label for="name">Project name</label>
      <div class="settings-row">
        <input id="name" name="name" type="text" value="${esc(project.name)}" maxlength="80" required autocomplete="off">
        <button class="btn btn-primary" type="submit">Save</button>
      </div>
      ${options.saved ? '<p class="saved" role="status">Saved.</p>' : ''}
      ${options.error ? `<p class="error" role="alert">${esc(options.error)}</p>` : ''}
      <p class="note">The slug <span class="mono">${esc(project.slug)}</span> stays the same. Publish, unpublish and data-change confirmations ask you to type it, so it must not move under you.</p>
    </form>
  </section>

  <section class="panel settings-card">
    <h2>Project</h2>
    <dl class="kv">
      <dt>Project ID</dt><dd><button class="copy-inline" type="button" data-copy="${esc(project.id)}">${esc(project.id)}</button></dd>
      <dt>Created</dt><dd>${esc(when(project.created_at))}</dd>
      <dt>Run trace</dt><dd class="truncate" title="${esc(view.state.trace_id)}">${esc(view.state.trace_id.slice(0, 12))}</dd>
      <dt>Database</dt><dd>${esc(view.dbLabel)}</dd>
      <dt>Hosting</dt><dd>${esc(view.deployerLabel)}</dd>
      <dt>Secrets</dt><dd>${view.secrets.length}</dd>
    </dl>
  </section>
</div>

<p class="settings-back"><a class="btn btn-sm" href="/projects/${project.id}">Back to project</a></p>`;
  return shell(ctx, `${project.name} settings`, body, 'projects');
}

// ----------------------------------------------------------------- connect

export function connectPage(ctx: PageContext): string {
  const endpoint = `${ctx.baseUrl}/mcp`;
  const free = TOOLS.filter((t) => !t.metered).length;
  const total = TOOLS.length;

  const tools = TOOLS.map(
    (t) => `<li><span class="tool-name mono">${esc(t.name)}</span><span class="tool-title">${esc(t.title)}</span><span class="tool-meta">${t.metered ? 'build action' : 'free'}${t.read_only ? ' · reads' : ''}${t.destructive ? ' · destructive' : ''}</span><span class="tool-desc">${esc(t.summary)}</span></li>`,
  ).join('');

  const body = `<header class="page-head">
  <div>
    <h1>Connect an assistant</h1>
    <p class="lede">Power is an MCP server. Point a client at the endpoint below and sign in with this account. Nothing is installed on this machine, and no API key is involved.</p>
  </div>
</header>

<section class="field">
  <span class="field-label">Endpoint</span>
  <div class="copyline">
    <code>${esc(endpoint)}</code>
    <button class="btn" type="button" data-copy="${esc(endpoint)}">Copy</button>
  </div>
  <dl class="specs">
    <div><dt>Transport</dt><dd>Streamable HTTP</dd></div>
    <div><dt>Authorization</dt><dd>OAuth 2.1 with PKCE</dd></div>
    <div><dt>Resource metadata</dt><dd class="mono">/.well-known/oauth-protected-resource</dd></div>
  </dl>
</section>

<section>
  <h2>Claude Code</h2>
  <div class="copyline code-line">
    <code>claude mcp add --transport http power ${esc(endpoint)}</code>
    <button class="btn" type="button" data-copy="claude mcp add --transport http power ${esc(endpoint)}">Copy</button>
  </div>
</section>

<section>
  <h2>Any MCP client</h2>
  <p>Add a remote MCP server with the endpoint above. The client reads the resource metadata, discovers this server as its own authorization server, and opens a sign-in page. Afterwards the client holds a token scoped to this server only.</p>
</section>

<section>
  <h2>What it can do</h2>
  <p>${total} tools, ${free} of them free. Reads and exports never count against the daily allowance; build actions do.</p>
  <details class="tool-list-wrap">
    <summary>Show every tool</summary>
    <ul class="tool-list">${tools}</ul>
  </details>
</section>`;

  return shell(ctx, 'Connect', body, 'connect');
}

// ------------------------------------------------------------------ secrets

export function renderSecretPage(pending: { name: string; provider: string | null; env: string; why: string } | null, error?: string): string {
  if (!pending) {
    return bare(
      'Link expired',
      `<h1>This link has expired</h1>
<p class="note">Secret links are single-use and last thirty minutes. Ask your assistant to request the secret again.</p>`,
    );
  }
  return bare(
    `Add ${pending.name}`,
    `<h1>Add a secret</h1>
<p class="note">Your assistant needs <span class="mono">${esc(pending.name)}</span>${pending.provider ? ` for ${esc(pending.provider)}` : ''}, for the <strong>${esc(pending.env)}</strong> environment.</p>
<p class="why">${esc(pending.why)}</p>
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
<form method="post" action="" class="secret-form">
  <label for="value">Value</label>
  <input id="value" type="password" name="value" autocomplete="off" required autofocus spellcheck="false">
  <button class="btn btn-primary" type="submit">Save secret</button>
</form>
<p class="note">The value is stored encrypted and injected into your app's environment. It is never shown to the assistant, which only learns the name and a fingerprint.</p>`,
  );
}

export function renderSecretSaved(record: { name: string; env: string; fingerprint: string }): string {
  return bare(
    'Secret saved',
    `<h1>Secret saved</h1>
<p><span class="mono">${esc(record.name)}</span> is set for <strong>${esc(record.env)}</strong>.</p>
<p class="note">Fingerprint <span class="mono">${esc(record.fingerprint)}</span>. You can close this tab and tell your assistant to continue.</p>`,
  );
}

export function renderMessagePage(title: string, message: string): string {
  return bare(title, `<h1>${esc(title)}</h1><p class="note">${esc(message)}</p><p><a class="btn" href="/">Back to projects</a></p>`);
}

// ---------------------------------------------------------------------- css

/** The brand mark, in the one place a browser can fetch it. */
export const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 709 741"><path d="${MARK_PATH}" fill="#fff3f0"/></svg>`;

export const DASHBOARD_CSS = `/* Power dashboard — one accent, hairlines, typographic hierarchy. */
:root{
  --paper:#000;
  --panel:#0a0a0a;
  --raise:#101010;
  --line:rgba(255,243,240,.10);
  --line-2:rgba(255,243,240,.20);
  --ink:#fff3f0;
  --ink-2:rgba(255,243,240,.62);
  --ink-3:rgba(255,243,240,.42);
  --pass:#9ed5a6;
  --warn:#e9bd79;
  --stop:#e9a08f;
  --sans:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:"Fragment Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  --r:14px;
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:400 14px/1.55 var(--sans);-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
code,.mono{font-family:var(--mono);font-size:.92em;letter-spacing:-.01em}
.dim{color:var(--ink-3)}
.skip{position:absolute;left:-9999px}
.skip:focus{left:12px;top:12px;z-index:100;background:var(--ink);color:#000;padding:8px 12px;border-radius:8px}
:focus-visible{outline:2px solid var(--ink);outline-offset:3px;border-radius:3px}

/* bar */
.bar{position:sticky;top:0;z-index:20;background:rgba(0,0,0,.82);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.bar-in{max-width:1120px;margin:0 auto;padding:0 28px;height:58px;display:flex;align-items:center;gap:30px}
.brand{display:inline-flex;align-items:center;gap:9px;font-weight:600;font-size:15px;letter-spacing:-.015em}
.brand svg{width:17px;height:18px;display:block;color:var(--ink)}
.bar nav{display:flex;gap:24px;margin-left:4px}
.bar nav a{color:var(--ink-3);font-size:13px}
.bar nav a:hover{color:var(--ink-2)}
.bar nav a[aria-current=page]{color:var(--ink)}
.who{margin-left:auto;display:flex;align-items:center;gap:14px;color:var(--ink-3);font-size:12px}
.who .plan{font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;border:1px solid var(--line-2);border-radius:999px;padding:3px 8px;color:var(--ink-2)}

/* page frame */
main{max-width:1120px;margin:0 auto;padding:46px 28px 88px}
.page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:28px;padding-bottom:22px;border-bottom:1px solid var(--line)}
h1{font-size:32px;line-height:1.08;letter-spacing:-.035em;font-weight:600;margin:0}
.lede{color:var(--ink-2);margin:12px 0 0;max-width:60ch;font-size:14px}
.stat{display:flex;align-items:baseline;gap:8px;padding-bottom:4px;white-space:nowrap}
.stat-n{font-size:26px;letter-spacing:-.03em;color:var(--warn);font-weight:600}
.stat-l{color:var(--ink-3);font-size:12px}
h2{font-size:15px;font-weight:600;letter-spacing:-.008em;margin:0 0 14px}
/* Prose stops at a readable measure; only tables and the doc use the full column. */
main p{max-width:70ch}
section{margin-top:38px}
section:first-of-type{margin-top:0}
.note{color:var(--ink-3);font-size:12.5px;margin:10px 0 0;max-width:64ch}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;color:var(--ink-3);font-size:12px;margin:10px 0 0}
.meta .mono{color:var(--ink-2)}
.list{margin:0 0 14px;padding-left:18px;color:var(--ink-2);font-size:13px}
.list li{margin:4px 0}

/* chips */
.chip{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;border:1px solid var(--line-2);border-radius:999px;padding:3px 8px;color:var(--ink-2);white-space:nowrap;line-height:1.5}
.chip::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.85}
.chip-lg{font-size:11px;padding:5px 11px}
.chip[data-tone=live]{color:var(--pass);border-color:rgba(158,213,166,.30)}
.chip[data-tone=you]{color:var(--warn);border-color:rgba(233,189,121,.32)}
.chip[data-tone=stop]{color:var(--stop);border-color:rgba(233,160,143,.30)}
.chip[data-tone=work]{color:var(--ink-2)}

/* project list */
.rows{border-top:1px solid var(--line);margin-top:8px}
.row{display:grid;grid-template-columns:minmax(0,1fr) 150px 82px;gap:22px;align-items:center;padding:19px 6px;border-bottom:1px solid var(--line);transition:background .16s ease}
.row:hover{background:rgba(255,243,240,.025)}
.row-main{min-width:0}
.row-name{display:block;font-size:15px;font-weight:500;letter-spacing:-.012em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row-sub{display:block;font-family:var(--mono);font-size:11px;color:var(--ink-3);margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row-state{justify-self:start}
.row-go{justify-self:end;color:var(--ink-3);font-size:12px}
.row:hover .row-go{color:var(--ink)}
.empty{border:1px solid var(--line);border-radius:var(--r);padding:38px 32px;margin-top:26px;background:var(--panel)}
.empty h2{font-size:19px;letter-spacing:-.02em;margin-bottom:8px}
.empty p{color:var(--ink-2);max-width:56ch;margin:0 0 20px}
.connect-strip{margin-top:46px;padding-top:26px;border-top:1px solid var(--line);display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,420px);gap:32px;align-items:start}
.connect-strip h2{font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);font-weight:400;margin-bottom:6px}
.connect-strip p{margin:0;color:var(--ink-3);font-size:12.5px}

/* copy line */
.copyline{display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:4px 4px 4px 14px;min-width:0}
.copyline code{color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;flex:1;min-width:0}
.copyline .btn{flex-shrink:0}
.code-line code{color:var(--ink)}

/* buttons + forms */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:36px;padding:0 15px;border-radius:9px;border:1px solid var(--line-2);background:transparent;color:var(--ink);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap;transition:background .15s ease,border-color .15s ease,transform .15s ease}
.btn:hover{background:rgba(255,243,240,.05);border-color:rgba(255,243,240,.32)}
.btn:active{transform:translateY(1px)}
.btn-primary{background:var(--ink);border-color:var(--ink);color:#0b0b0b;font-weight:600}
.btn-primary:hover{background:#fff;border-color:#fff;color:#000}
.btn-sm{height:31px;padding:0 12px;font-size:12px}
.btn-danger{color:var(--stop);border-color:rgba(233,160,143,.32)}
.btn-danger:hover{background:rgba(233,160,143,.07);border-color:rgba(233,160,143,.5)}
.actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
form{margin:0}
label{display:block;color:var(--ink-3);font-size:12px;margin-bottom:7px}
input[type=text],input[type=password]{display:block;width:100%;height:36px;padding:0 11px;background:#050505;border:1px solid var(--line-2);border-radius:8px;color:var(--ink);font:inherit;font-size:13px}
input::placeholder{color:rgba(255,243,240,.28)}
input:focus{border-color:rgba(255,243,240,.45);outline:none;box-shadow:0 0 0 3px rgba(255,243,240,.06)}
.sendback{margin-top:22px;padding-top:18px;border-top:1px solid var(--line)}
.sendback-row{display:flex;gap:10px;max-width:520px}
.sendback-row .btn{flex-shrink:0}
.confirm{max-width:520px}
.confirm label{margin-top:14px}

/* decision */
.decision{position:relative;border:1px solid var(--line-2);border-radius:var(--r);background:var(--panel);padding:26px 26px 24px;margin-top:26px;overflow:hidden}
.decision::before{content:"";position:absolute;inset:0 auto 0 0;width:2px;background:var(--ink-2)}
.decision[data-tone=you]::before{background:var(--warn)}
.decision[data-tone=live]::before{background:var(--pass)}
.decision[data-tone=stop]::before{background:var(--stop)}
.decision h2{font-size:19px;letter-spacing:-.022em;margin:0 0 8px;font-weight:600}
.decision p{color:var(--ink-2);margin:0 0 16px;max-width:66ch;font-size:13.5px}
.decision p.note{margin-top:-4px;margin-bottom:14px}
.quiet{border-top:1px solid var(--line);padding-top:22px;margin-top:26px}
.quiet h2{font-size:16px;letter-spacing:-.015em;margin-bottom:6px}
.quiet p{color:var(--ink-2);margin:0;font-size:13.5px}

/* project layout */
.crumb{display:flex;gap:8px;align-items:center;color:var(--ink-3);font-size:12px;margin-bottom:20px}
.crumb a:hover{color:var(--ink)}
.crumb [aria-current]{color:var(--ink-2)}
.proj-head{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding-bottom:24px;border-bottom:1px solid var(--line)}
.proj-head h1{font-size:34px}
.proj-grid{display:grid;grid-template-columns:minmax(0,1fr) 296px;gap:48px;align-items:start}
.proj-main{min-width:0}
.proj-main section:first-of-type{margin-top:34px}
.side{border-left:1px solid var(--line);padding-left:28px;margin-top:34px;display:grid;gap:26px}
.side section{margin-top:0}
.panel{border:1px solid var(--line);border-radius:var(--r);background:var(--panel);padding:18px}
.panel h2{font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);font-weight:400;margin-bottom:14px}
.preview-link{margin-top:20px}

/* project list tools */
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.list-tools{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:14px 0;border-bottom:1px solid var(--line)}
.search{display:flex;align-items:center;gap:8px;min-width:0}
.search input[type=search]{width:280px;height:32px;background:#050505;border:1px solid var(--line-2);border-radius:8px;color:var(--ink);font:inherit;font-size:12.5px;padding:0 10px}
.search input[type=search]::placeholder{color:rgba(255,243,240,.3)}
.search input[type=search]:focus{border-color:rgba(255,243,240,.45);outline:none;box-shadow:0 0 0 3px rgba(255,243,240,.06)}
.search .clear{color:var(--ink-3);font-size:12px;padding:0 4px;white-space:nowrap}
.search .clear:hover{color:var(--ink)}
.filters{display:flex;gap:4px;flex-wrap:wrap}
.filters a{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;color:var(--ink-3);font-size:12px;border:1px solid transparent;white-space:nowrap}
.filters a:hover{color:var(--ink-2)}
.filters a[aria-current=page]{color:var(--ink);border-color:var(--line-2);background:rgba(255,243,240,.03)}
.filters .count{font-family:var(--mono);font-size:10px;color:var(--ink-3)}
.list-tools + .rows,.list-tools + .result-note + .rows{margin-top:0;border-top:0}
.result-note{margin:12px 0 0;color:var(--ink-3);font-size:11.5px;font-family:var(--mono)}
.empty-search h2{font-size:17px}
.proj-head-actions{display:flex;align-items:center;gap:10px;flex-shrink:0}

/* services */
.services{list-style:none;margin:0;padding:0;display:grid;gap:13px}
.services li{display:flex;align-items:center;justify-content:space-between;gap:12px}
.service{display:flex;flex-direction:column;min-width:0}
.service-name{font-size:12.5px}
.service-meta{font-family:var(--mono);font-size:10.5px;color:var(--ink-3);margin-top:2px}
.status{font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);white-space:nowrap;display:inline-flex;align-items:center;gap:5px}
.status::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.8}
.status[data-tone=live]{color:var(--pass)}
.status[data-tone=idle]{color:var(--ink-3)}

/* settings */
.settings-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:20px;margin-top:28px;align-items:start}
.settings-card h2{font-family:var(--sans);font-size:15px;letter-spacing:-.01em;text-transform:none;color:var(--ink);font-weight:600;margin-bottom:16px}
.settings-form{display:grid}
.settings-row{display:flex;gap:10px;align-items:center}
.settings-row input{max-width:360px}
.settings-row .btn{flex-shrink:0}
.saved{color:var(--pass);font-size:12px;margin:12px 0 0}
.settings-back{margin-top:26px}

/* timeline */
.steps{list-style:none;margin:0;padding:0}
.step{display:grid;grid-template-columns:16px 1fr;gap:16px;padding-bottom:24px;position:relative}
.step:last-child{padding-bottom:0}
.step::before{content:"";position:absolute;left:5px;top:16px;bottom:0;width:1px;background:var(--line)}
.step:last-child::before{display:none}
.dot{width:11px;height:11px;border-radius:50%;border:1px solid var(--line-2);background:var(--paper);margin-top:3px;position:relative;z-index:1;display:block}
.step[data-state=done] .dot{background:var(--ink);border-color:var(--ink)}
.step[data-state=now] .dot{background:var(--warn);border-color:var(--warn);box-shadow:0 0 0 4px rgba(233,189,121,.12)}
.step[data-state=now][data-live] .dot{background:var(--pass);border-color:var(--pass);box-shadow:0 0 0 4px rgba(158,213,166,.12)}
.step[data-state=now][data-stop] .dot{background:var(--stop);border-color:var(--stop);box-shadow:0 0 0 4px rgba(233,160,143,.12)}
.step-label{display:block;font-size:13.5px;line-height:1.35}
.step[data-state=todo] .step-label{color:var(--ink-3)}
.step[data-state=now] .step-label{font-weight:500}
.step-when{display:block;font-family:var(--mono);font-size:10.5px;color:var(--ink-3);margin-top:3px;letter-spacing:.02em}
.budget{display:flex;flex-wrap:wrap;gap:10px 34px;margin:24px 0 0;padding-top:18px;border-top:1px solid var(--line)}
.budget div{display:flex;flex-direction:column-reverse;gap:3px}
.budget dt{color:var(--ink-3);font-size:11px}
.budget dd{margin:0;font-family:var(--mono);font-size:13px}

/* tables */
.gates,.hist{width:100%;border-collapse:collapse}
.gates td{padding:15px 0;border-bottom:1px solid var(--line);vertical-align:top}
.gates tr:last-child td{border-bottom:0}
.gate-name{font-size:13.5px}
.gate-desc{color:var(--ink-3);font-size:12px;margin-top:3px;max-width:66ch;line-height:1.5}
.gate-cell{text-align:right;vertical-align:middle;white-space:nowrap;padding-left:16px}
.hist td{padding:11px 0;border-bottom:1px solid var(--line);vertical-align:top;font-size:12.5px}
.hist tr:last-child td{border-bottom:0}
.hist-time{color:var(--ink-3);font-family:var(--mono);font-size:10.5px;white-space:nowrap;width:108px;padding-top:13px!important}
.hist-note{color:var(--ink-3);font-size:11.5px;margin-top:2px}
.hist-move{text-align:right;color:var(--ink-3);white-space:nowrap;font-size:11px;padding-left:14px!important}
.hist-move .mono{font-size:10.5px;color:var(--ink-2)}

/* live panel */
.live-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.live-head .mono{font-size:11px;color:var(--ink-3)}
.live-url{font-size:11.5px;margin:0 0 14px;word-break:break-all;line-height:1.6}
.live-url a{border-bottom:1px solid var(--line-2);padding-bottom:1px}
.live-url a:hover{border-color:var(--ink)}
.conditions{margin:10px 0 14px;padding-left:16px;color:var(--ink-2);font-size:12px}
.conditions li{margin:3px 0}
.deploys{margin-top:16px;border-top:1px solid var(--line);padding-top:12px}
.deploys summary{color:var(--ink-3);font-size:11.5px;cursor:pointer;list-style:none;display:flex;align-items:center;gap:7px}
.deploys summary::-webkit-details-marker{display:none}
.deploys summary::before{content:"+";font-family:var(--mono);width:8px}
.deploys[open] summary::before{content:"–"}
.deploy-list{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:7px}
.deploy-list li{display:flex;justify-content:space-between;gap:10px;font-size:11px;color:var(--ink-2)}
.kv{display:grid;grid-template-columns:1fr auto;gap:9px 14px;margin:0;font-size:12px}
.kv dt{color:var(--ink-3);white-space:nowrap}
.kv dd{margin:0;text-align:right;font-family:var(--mono);font-size:11px;color:var(--ink-2);overflow-wrap:anywhere;min-width:0}
.kv dd.truncate{max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.copy-inline{background:none;border:0;padding:0;color:var(--ink-2);font:inherit;font-family:var(--mono);font-size:11px;cursor:pointer;border-bottom:1px dotted var(--line-2)}
.copy-inline:hover{color:var(--ink)}
.secret-list{list-style:none;margin:0;padding:0;display:grid;gap:9px}
.secret-list li{display:flex;justify-content:space-between;gap:10px;font-size:11.5px}
.secret-list .dim{font-size:10.5px}

/* danger */
.danger{margin-top:38px;border-top:1px solid var(--line);padding-top:22px}
.danger summary{color:var(--ink-3);font-size:12px;cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px}
.danger summary::-webkit-details-marker{display:none}
.danger summary::before{content:"+";font-family:var(--mono);color:var(--ink-3);width:10px}
.danger[open] summary::before{content:"–"}
.danger summary:hover{color:var(--ink-2)}
.danger-body{margin-top:16px;max-width:600px}
.danger-body p{color:var(--ink-3);font-size:12.5px;margin:0 0 14px;max-width:62ch}

/* doc (spec) */
.doc{border:1px solid var(--line);border-radius:var(--r);background:var(--panel);margin-top:28px;padding:6px 26px 10px;max-width:840px}
.doc pre{margin:0;padding:20px 0;white-space:pre-wrap;word-break:break-word;font-family:var(--mono);font-size:12px;line-height:1.7;color:var(--ink-2);tab-size:2}

/* connect */
.field{margin-top:30px;border:1px solid var(--line);border-radius:var(--r);background:var(--panel);padding:22px}
.field-label{display:block;font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);margin-bottom:10px}
.specs{display:flex;flex-wrap:wrap;gap:12px 40px;margin:20px 0 0;padding-top:18px;border-top:1px solid var(--line)}
.specs div{display:flex;flex-direction:column;gap:4px}
.specs dt{color:var(--ink-3);font-size:10.5px;font-family:var(--mono);letter-spacing:.08em;text-transform:uppercase}
.specs dd{margin:0;font-size:12.5px;color:var(--ink-2)}
.tool-list-wrap{margin-top:16px;border-top:1px solid var(--line);padding-top:14px}
.tool-list-wrap summary{cursor:pointer;color:var(--ink-3);font-size:12px;list-style:none}
.tool-list-wrap summary::-webkit-details-marker{display:none}
.tool-list-wrap summary::before{content:"+ ";font-family:var(--mono)}
.tool-list-wrap[open] summary::before{content:"– "}
.tool-list{list-style:none;margin:18px 0 0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.tool-list li{display:grid;gap:2px;background:var(--paper);padding:13px 16px}
.tool-name{font-size:11.5px;color:var(--ink)}
.tool-title{font-size:12px;color:var(--ink-2)}
.tool-meta{font-family:var(--mono);font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);margin-top:2px}
.tool-desc{font-size:11.5px;color:var(--ink-3);line-height:1.5;margin-top:4px}

/* footer */
.foot{max-width:1120px;margin:0 auto;padding:22px 28px 40px;border-top:1px solid var(--line);display:flex;align-items:center;gap:10px;color:var(--ink-3);font-size:11.5px}
.foot .spacer{flex:1}
.foot .mono{font-size:11px}

/* bare pages (secret form) */
body.bare{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:32px}
.bare-main{width:100%;max-width:520px;border:1px solid var(--line);border-radius:18px;background:var(--panel);padding:32px}
.bare-main .brand{margin-bottom:26px}
.bare-main h1{font-size:24px;letter-spacing:-.03em;margin-bottom:10px}
.bare-main p{color:var(--ink-2);font-size:13.5px;margin:0 0 16px;line-height:1.6}
.why{color:var(--ink-2);border-left:2px solid var(--line-2);padding-left:12px}
.error{color:var(--stop);border:1px solid rgba(233,160,143,.32);border-radius:8px;padding:10px 12px;background:rgba(233,160,143,.06)}
.secret-form{display:grid;gap:12px;margin:20px 0}
.secret-form .btn{justify-self:start}

@media (max-width:900px){
  .proj-grid{grid-template-columns:1fr;gap:0}
  .side{border-left:0;padding-left:0;border-top:1px solid var(--line);padding-top:26px;margin-top:32px;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
  .connect-strip{grid-template-columns:1fr;gap:14px}
  .tool-list{grid-template-columns:1fr}
}
@media (max-width:680px){
  .bar-in{height:54px;padding:0 18px;gap:16px}
  .bar nav{gap:16px}
  .who .quota{display:none}
  main{padding:30px 18px 64px}
  h1{font-size:26px}
  .proj-head h1{font-size:28px}
  .page-head{flex-direction:column;align-items:flex-start;gap:14px}
  .row{grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:16px 2px}
  .row-go{display:none}
  .side{grid-template-columns:1fr}
  .foot{padding:20px 18px 34px;flex-direction:column;align-items:flex-start;gap:6px}
  .foot .spacer{display:none}
  /* A separator stranded at the end of a wrapped line reads as a typo. */
  .meta > span[aria-hidden]{display:none}
  .proj-head{flex-direction:column;gap:12px}
  .sendback-row{flex-direction:column;align-items:stretch}
  .sendback-row .btn{width:100%}
  .decision{padding:22px 20px}
  .field{padding:18px}
  .doc{padding:2px 16px 6px}
  .list-tools{flex-direction:column;align-items:stretch;gap:12px}
  .search{width:100%}
  .search input[type=search]{flex:1;width:auto;min-width:0}
  .filters{overflow-x:auto;padding-bottom:2px}
  .proj-head-actions{width:100%;justify-content:space-between}
  .settings-grid{grid-template-columns:1fr}
  .settings-row{flex-direction:column;align-items:stretch}
  .settings-row input{max-width:none}
  .settings-row .btn{width:100%}
  /* The row has less room than the text needs; wrapping beats an ellipsis
     that hides which project is live. */
  .row-sub{white-space:normal;overflow:visible;text-overflow:clip;line-height:1.55}
  /* Freshness is on the project page; keeping it here forces a third line on
     every row at this width. */
  .row-updated{display:none}
  .foot > span[aria-hidden]{display:none}
}
`;

