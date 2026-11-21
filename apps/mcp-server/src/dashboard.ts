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
import { MARK, MARK_PATH } from './brand.js';
import type { Approvals, DeploymentRecord, Project } from './store.js';
import type { SecretRecord } from './secrets.js';

const VERSION = '9';

export interface PageContext {
  baseUrl: string;
  user: string;
  /** The address the account signed in with, when one is on file. */
  email: string | null;
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

/** One letter for the account chip; an address or an opaque id both work. */
const initial = (identity: string): string => identity.trim().charAt(0) || 'P';

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


// ------------------------------------------------------------------- shell

function shell(ctx: PageContext, title: string, body: string, active?: 'projects' | 'connect'): string {
  const navItem = (href: string, label: string, key: 'projects' | 'connect') =>
    `<a href="${href}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#f4f1ea">
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
      <span class="quota">${ctx.remaining.day} ${ctx.remaining.day === 1 ? 'action' : 'actions'} left</span>
      <span class="account" title="${esc(ctx.email ?? ctx.user)}">
        <span class="avatar" aria-hidden="true">${esc(initial(ctx.email ?? ctx.user))}</span>
        <span class="account-mail">${esc(ctx.email ?? ctx.user)}</span>
      </span>
      <a class="signout" href="/logout">Sign out</a>
    </div>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="foot">
  <span class="foot-brand">${MARK}<span>Power</span></span><span aria-hidden="true">·</span>
  <span class="mono">${esc(ctx.baseUrl.replace(/^https?:\/\//, ''))}/mcp</span>
  <span class="spacer"></span>
  <span>${esc(ctx.email ?? ctx.user)}</span>
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
      : `<div class="start">
  <div class="start-copy">
    <p class="eyebrow">Get started</p>
    <h2>No projects yet</h2>
    <p>Power builds an app from a conversation. Connect an MCP client once, then ask it to create one — the project appears here as soon as it exists.</p>
    <div class="start-actions">
      <a class="btn btn-primary" href="/connect">Connect an assistant</a>
      <a class="btn" href="#endpoint">Copy the endpoint</a>
    </div>
  </div>
  <ol class="steps">
    <li><span class="step-n">1</span><div><strong>Connect your assistant</strong><p>Add this server to Claude, Cursor or any MCP client. <a href="/connect">Setup and endpoint</a></p></div></li>
    <li><span class="step-n">2</span><div><strong>Ask for the app</strong><p>Describe what you want. Power writes a plan before it writes code.</p></div></li>
    <li><span class="step-n">3</span><div><strong>Approve and publish</strong><p>Plans, releases and anything destructive wait for you here.</p></div></li>
  </ol>
</div>`
    : `<div class="rows">${projects
        .map(({ project, state, live }) => {
          const tone = TONE[state.phase];
          return `<a class="row" href="/projects/${project.id}">
  <span class="row-mark" aria-hidden="true">${esc(initial(project.name))}</span>
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
    `<header class="hero">
  <p class="eyebrow">Workspace</p>
  <div class="hero-row">
    <div>
      <h1>Projects</h1>
      <p class="lede">What your assistant is building, and the decisions it cannot make without you.</p>
    </div>
    ${needs ? `<div class="stat"><span class="stat-n">${needs}</span><span class="stat-l">need${needs === 1 ? 's' : ''} you</span></div>` : ''}
  </div>
  <div class="hero-meta">
    <span class="meta-pill"><span class="pulse" aria-hidden="true"></span><b>${esc(ctx.plan)}</b> plan</span>
    <span class="meta-pill"><b>${ctx.remaining.day}</b> ${ctx.remaining.day === 1 ? 'action' : 'actions'} left today</span>
  </div>
</header>
${toolbar}
${filtered && projects.length ? `<p class="result-note">${projects.length} of ${rows.length} projects</p>` : ''}
${list}
<section class="endpoint" id="endpoint">
  <div>
    <h2>MCP endpoint</h2>
    <p>Point an MCP client here. It uses the account this page is signed in to.</p>
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

  const body = `<header class="hero">
  <p class="eyebrow">Connect</p>
  <div class="hero-row">
    <div>
      <h1>Connect an assistant</h1>
      <p class="lede">Power is an MCP server. Point a client at the endpoint below and sign in with this account. Nothing is installed on this machine, and no API key is involved.</p>
    </div>
    <div class="hero-meta">
      <span class="meta-pill"><span class="pulse" aria-hidden="true"></span><b>${total}</b> tools ready</span>
    </div>
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
export const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 709 741"><path d="${MARK_PATH}" fill="#0b0c0e"/></svg>`;

export { DASHBOARD_CSS } from './app-css.js';
