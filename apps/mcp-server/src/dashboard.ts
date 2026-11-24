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
import { modeOf, phaseLabel, retriesRemaining, type Phase, type RunState } from '@power/runstate';
import { PLANS, TOOLS, type Plan } from '@power/protocol';
import { MARK, MARK_PATH } from './brand.js';
import type { Approvals, DeploymentRecord, Project } from './store.js';
import type { SecretRecord } from './secrets.js';

const VERSION = '18';

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
  /** The assistant the person chose in setup, for "Open in …". */
  assistantName?: string | null;
}

export const esc = (s: string): string =>
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

export type NavKey = 'projects' | 'connect' | 'setup';

/** A small stroke icon set, drawn inline so the page needs nothing else to load. */
const ICON_PATHS = {
  search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>',
  external: '<path d="M6 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8a1.5 1.5 0 0 0 1.5-1.5V10"/><path d="M9 2h5v5"/><path d="m14 2-6.5 6.5"/>',
  gear: '<circle cx="8" cy="8" r="2"/><path d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7 3.4 3.4"/>',
  terminal: '<rect x="1.5" y="2.5" width="13" height="11" rx="2"/><path d="m4.5 6 2 2-2 2M8.5 10.5h3"/>',
  check: '<path d="m3.5 8.5 3 3 6-7"/>',
  alert: '<path d="M8 5v3.5M8 11h.01"/><circle cx="8" cy="8" r="6.5"/>',
  arrow: '<path d="M3 8h10M9 4l4 4-4 4"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  chevron: '<path d="m4 6 4 4 4-4"/>',
  copy: '<rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/>',
  globe: '<circle cx="8" cy="8" r="6.5"/><path d="M1.5 8h13M8 1.5c2 2.2 2 10.8 0 13M8 1.5c-2 2.2-2 10.8 0 13"/>',
  db: '<ellipse cx="8" cy="3.5" rx="5.5" ry="2"/><path d="M2.5 3.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2"/>',
  key: '<circle cx="5" cy="11" r="3"/><path d="m7.2 8.8 6.3-6.3M11.5 4.5l1.5 1.5"/>',
  logout: '<path d="M10 3h2.5A1.5 1.5 0 0 1 14 4.5v7a1.5 1.5 0 0 1-1.5 1.5H10M6.5 11 3.5 8l3-3M3.5 8H10"/>',
  bolt: '<path d="M9 1.5 3 9h4.5L7 14.5 13 7H8.5z"/>',
} as const;
export type IconName = keyof typeof ICON_PATHS;
export const icon = (name: IconName): string =>
  `<svg class="i" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name]}</svg>`;

/** The account menu: who is signed in, what the plan allows today, and the way out. */
function accountMenu(ctx: PageContext): string {
  const who = ctx.email ?? ctx.user;
  const limit = PLANS[ctx.plan]?.per_day ?? null;
  const used = limit !== null ? Math.max(0, limit - ctx.remaining.day) : null;
  const pct = limit ? Math.min(100, Math.round(((used ?? 0) / limit) * 100)) : 0;
  return `<details class="menu">
  <summary class="menu-trigger" aria-label="Account">
    <span class="avatar" aria-hidden="true">${esc(initial(who))}</span>
    <span class="menu-chev">${icon('chevron')}</span>
  </summary>
  <div class="menu-panel" role="menu">
    <div class="menu-who">
      <span class="avatar avatar-lg" aria-hidden="true">${esc(initial(who))}</span>
      <span class="menu-id"><span class="menu-mail" title="${esc(who)}">${esc(who)}</span><span class="menu-plan">${esc(ctx.plan)} plan</span></span>
    </div>
    <div class="menu-usage">
      <div class="menu-usage-row"><span>Build actions today</span><span class="mono">${ctx.remaining.day}${limit !== null ? ` / ${limit}` : ''} left</span></div>
      ${limit !== null ? `<span class="meter" aria-hidden="true"><span style="width:${pct}%"></span></span>` : ''}
      <span class="menu-hint">Reads and exports are free. Resets at midnight UTC.</span>
    </div>
    <nav class="menu-links">
      <a href="/connect" role="menuitem">${icon('terminal')}Connect an assistant</a>
      <a href="/start/vercel" role="menuitem">${icon('globe')}Hosting on Vercel</a>
      <a href="/logout" role="menuitem">${icon('logout')}Sign out</a>
    </nav>
  </div>
</details>`;
}

export function shell(ctx: PageContext, title: string, body: string, active?: NavKey): string {
  const navItem = (href: string, label: string, key: NavKey) =>
    `<a href="${href}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#000000">
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
      <span class="quota" title="Build actions left today">${icon('bolt')}<span class="mono">${ctx.remaining.day}</span></span>
      ${accountMenu(ctx)}
    </div>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="foot">
  <span class="foot-brand">${MARK}<span>Power</span></span>
  <span class="spacer"></span>
  <button class="foot-endpoint" type="button" data-copy="${esc(ctx.baseUrl)}/mcp" title="Copy the MCP endpoint">${icon('copy')}<span class="mono">${esc(ctx.baseUrl.replace(/^https?:\/\//, ''))}/mcp</span></button>
</footer>
<div class="toast" role="status" aria-live="polite" hidden>Copied</div>
<script>
const toast = document.querySelector('.toast');
let toastTimer;
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const value = button.getAttribute('data-copy') || '';
    try { await navigator.clipboard.writeText(value); } catch { return; }
    if (!toast) return;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 1600);
  });
}
// The account menu closes on a click elsewhere or Escape, like any menu.
const menu = document.querySelector('details.menu');
document.addEventListener('click', (e) => { if (menu && menu.open && !menu.contains(e.target)) menu.open = false; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu && menu.open) { menu.open = false; menu.querySelector('summary')?.focus(); } });
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
  /** The account's Power Up setting and the form proof to change it. */
  powerUp?: { on: boolean; csrf: string };
  /** The "start something new" form, rendered by the setup module. */
  composer?: string;
  /** The New app dialog's mount point and bundle. */
  newApp?: string;
}

/**
 * The Power Up switch. A real form, so it works without JavaScript; with it,
 * flipping the switch submits by itself.
 */
export function powerUpSwitch(on: boolean, csrf: string, back = '/'): string {
  return `<form class="powerup" method="post" action="/start/power-up" data-on="${on}">
  ${csrf}
  <input type="hidden" name="back" value="${esc(back)}">
  <input type="hidden" name="power_up" value="${on ? 'off' : 'on'}">
  <div class="powerup-copy">
    <span class="powerup-title">Power Up <span class="powerup-state">${on ? 'On' : 'Off'}</span></span>
    <span class="powerup-desc">${
      on
        ? 'New runs research first, write a plan for you to approve, and are verified before publishing.'
        : 'New runs go straight to the build. Turn on for research, a plan you approve and independent verification.'
    }</span>
  </div>
  <button class="switch" type="submit" role="switch" aria-checked="${on}" aria-label="Power Up for new runs"><span></span></button>
</form>`;
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
    ? `<div class="toolbar">
  <form class="search" method="get" action="/" role="search">
    <label class="sr-only" for="q">Search projects</label>
    ${icon('search')}
    <input id="q" name="q" type="search" value="${esc(query)}" placeholder="Search projects" autocomplete="off">
    ${filter !== 'all' ? `<input type="hidden" name="state" value="${filter}">` : ''}
    ${filtered ? '<a class="clear" href="/">Clear</a>' : ''}
  </form>
  <nav class="segmented" aria-label="Filter projects">
    ${FILTERS.map(
      (f) =>
        `<a href="${esc(filterHref(query, f.key))}"${f.key === filter ? ' aria-current="page"' : ''}>${esc(f.label)}<span class="count">${counts[f.key]}</span></a>`,
    ).join('')}
  </nav>
</div>`
    : '';

  const card = ({ project, state, live }: ProjectRow): string => {
    const tone = TONE[state.phase];
    const url = live && live.ready_state === 'READY' ? absolute(live.url).replace(/^https?:\/\//, '').replace(/\/$/, '') : null;
    const meter = MILESTONES.filter((m) => m.key !== 'started')
      .map((m) => `<span data-state="${stepFor(state, m.key).state}"${m.key === 'live' && state.phase === 'done' ? ' data-live="1"' : ''}></span>`)
      .join('');
    return `<a class="pcard" href="/projects/${project.id}">
  <span class="pcard-top">
    <span class="pmark" aria-hidden="true">${esc(initial(project.name))}</span>
    <span class="pcard-id">
      <span class="pcard-name">${esc(project.name)}</span>
      <span class="pcard-sub"><span class="mono">${esc(project.slug)}</span></span>
      ${url ? `<span class="pcard-sub pcard-url">${icon('globe')}<span>${esc(url)}</span></span>` : ''}
    </span>
    <span class="chip" data-tone="${tone}">${esc(STATUS[state.phase])}</span>
  </span>
  <span class="pmeter" aria-label="${esc(phaseLabel(state.phase))}">${meter}</span>
  <span class="pcard-foot">
    <span class="pcard-mode">${modeOf(state) === 'power_up' ? `${icon('bolt')}Power Up` : 'Standard'}</span>
    <span>updated ${esc(relative(state.updated_at))}${live ? ` · ${esc(versionLabel(live.version))}` : ''}</span>
  </span>
</a>`;
  };

  const list = !projects.length
    ? rows.length
      ? `<div class="empty empty-search">
  <span class="empty-icon">${icon('search')}</span>
  <h2>No projects match</h2>
  <p>Nothing here matches ${query ? `“${esc(query)}”` : 'that filter'}${filter !== 'all' ? ' and the selected status' : ''}.</p>
  <a class="btn btn-sm" href="/">Clear search</a>
</div>`
      : `<section class="welcome-more">
  <ol class="welcome-steps">
    <li><span class="step-n">1</span><strong>Describe the app</strong><p>Name it and say what it does. Power sets up the project, the database and hosting.</p></li>
    <li><span class="step-n">2</span><strong>Your assistant builds it</strong><p>Claude, Cursor or Codex opens with the brief and connects itself to Power.</p></li>
    <li><span class="step-n">3</span><strong>Approve and publish</strong><p>Releases and anything destructive wait for you here, then ship to your Vercel.</p></li>
  </ol>
  <span class="welcome-dunes" aria-hidden="true"></span>
</section>`
    : `<div class="pgrid-cards">${projects.map(card).join('')}${
        filtered ? '' : `<button class="pcard pcard-new" type="button" data-new-app="new"><span class="pcard-new-icon">${icon('plus')}</span><span>New app</span><span class="pcard-new-sub">Describe it, pick your assistant</span></button>`
      }</div>`;

  const welcome = `<header class="welcome">
  <p class="eyebrow">No projects yet</p>
  <h1>Build an app with the assistant you already use.</h1>
  <p class="lede">Describe it once. Power prepares everything, hands it to Claude, Cursor or Codex, and publishes when you approve.</p>
  <div class="welcome-actions">
    <button class="btn btn-primary btn-lg" type="button" data-new-app="new">+ New app</button>
    <button class="btn btn-lg" type="button" data-new-app="import">Add your own app</button>
  </div>
</header>
${options.newApp ?? ''}`;

  if (!rows.length) return shell(ctx, 'Projects', `${welcome}\n${list}`, 'projects');

  const limit = PLANS[ctx.plan]?.per_day ?? null;
  const stat = (label: string, value: string, sub: string, tone = '') =>
    `<div class="stat"${tone ? ` data-tone="${tone}"` : ''}><span class="stat-l">${label}</span><span class="stat-n">${value}</span><span class="stat-sub">${sub}</span></div>`;

  return shell(
    ctx,
    'Projects',
    `<header class="page-head">
  <div>
    <h1>Projects</h1>
    <p class="lede">What your assistant is building, and the decisions it cannot make without you.</p>
  </div>
  <div class="page-actions">
    <button class="btn" type="button" data-new-app="import">Add your own app</button>
    <button class="btn btn-primary" type="button" data-new-app="new">${icon('plus')}New app</button>
  </div>
</header>
${options.newApp ?? ''}
<div class="stats">
  ${stat('Projects', String(rows.length), limit !== null && PLANS[ctx.plan]?.projects ? `of ${PLANS[ctx.plan]!.projects} on ${esc(ctx.plan)}` : 'in this workspace')}
  ${stat('Need you', String(needs), needs ? 'waiting on a decision' : 'nothing waiting', needs ? 'you' : '')}
  ${stat('Live', String(rows.filter(isLive).length), 'serving on Vercel', rows.some(isLive) ? 'live' : '')}
  ${stat('Actions left', String(ctx.remaining.day), limit !== null ? `of ${limit} today` : 'today')}
</div>
${toolbar}
${filtered && projects.length ? `<p class="result-note">${projects.length} of ${rows.length} projects</p>` : ''}
${list}`,
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
type StepState = 'done' | 'now' | 'todo' | 'skip';

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
  // A standard run chose not to have these stages. Said plainly, never shown as passed.
  if (modeOf(state) === 'standard' && (key === 'research' || key === 'plan' || key === 'verified')) {
    return { state: 'skip', detail: 'Skipped · Power Up off' };
  }
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
  const steps = MILESTONES.map((m, i) => {
    const step = stepFor(state, m.key);
    const live = m.key === 'live' && state.phase === 'done' ? ' data-live="1"' : '';
    const mark = step.state === 'done' ? icon('check') : step.state === 'skip' ? '' : `<span class="step-num">${i + 1}</span>`;
    return `<li class="step" data-state="${step.state}"${live}>
  <span class="dot" aria-hidden="true">${mark}</span>
  <span class="step-body"><span class="step-label">${esc(m.label)}</span><span class="step-when">${esc(step.detail)}</span></span>
</li>`;
  });

  if (state.phase === 'blocked') {
    steps.push(`<li class="step" data-state="now" data-stop="1">
  <span class="dot" aria-hidden="true">${icon('alert')}</span>
  <span class="step-body"><span class="step-label">Needs your help</span><span class="step-when">${esc(when(state.updated_at))}</span></span>
</li>`);
  }

  return `<ol class="stepper" aria-label="Progress">${steps.join('')}</ol>`;
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
    return `<li class="gate" data-tone="${word.tone}">
  <div class="gate-text"><div class="gate-name">${esc(g.name)}</div><div class="gate-desc">${esc(g.what)}</div></div>
  <span class="chip" data-tone="${word.tone}">${word.label}</span>
</li>`;
  }).join('');
  return `<ul class="gates">${rows}</ul>`;
}

function historyTable(state: RunState): string {
  if (!state.history.length) return '<p class="note">No activity recorded yet.</p>';
  const rows = [...state.history]
    .reverse()
    .map((entry) => {
      const label = EVENT[entry.event] ?? entry.event.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
      const detail = entry.note ? `<span class="act-note">${esc(entry.note)}</span>` : '';
      return `<li class="act">
  <span class="act-dot" aria-hidden="true"></span>
  <span class="act-body"><span class="act-title">${esc(label)}</span>${detail}</span>
  <span class="act-side"><span class="act-move mono">${esc(entry.from)} → ${esc(entry.to)}</span><time datetime="${esc(entry.at)}" title="${esc(whenDated(entry.at))}">${esc(relative(entry.at))}</time></span>
</li>`;
    })
    .join('');
  return `<ol class="activity">${rows}</ol>`;
}

/** The one thing on the page that needs the person, as a banner with its action beside it. */
function banner(tone: string, iconName: IconName, title: string, body: string, action = '', extra = ''): string {
  return `<section class="decision" data-tone="${tone}" aria-labelledby="decision-title">
  <span class="decision-icon" aria-hidden="true">${icon(iconName)}</span>
  <div class="decision-body">
    <h2 id="decision-title">${title}</h2>
    ${body}
    ${extra}
  </div>
  ${action ? `<div class="decision-action">${action}</div>` : ''}
</section>`;
}

function decision(view: ProjectView): string {
  const { project, state, approvals, publish } = view;
  const csrf = view.csrf;
  const id = project.id;

  if (state.phase === 'spec_approval') {
    return banner(
      'you',
      'alert',
      'Your plan is ready',
      '<p>Read it before you approve. Approval decides <em>what</em> gets built; the structure has already been checked by code. Your assistant cannot approve this for itself.</p>',
      `${view.spec ? `<a class="btn" href="/projects/${id}/spec">Read the plan</a>` : ''}<form method="post" action="/projects/${id}/approve-spec">${csrf}<button class="btn btn-primary" type="submit">Approve the plan</button></form>`,
      `<form class="sendback" method="post" action="/projects/${id}/reject-spec">
    ${csrf}
    <label for="reason">Or send it back with a reason</label>
    <div class="inline-form">
      <input id="reason" type="text" name="reason" placeholder="What should change?" autocomplete="off" required>
      <button class="btn" type="submit">Send back</button>
    </div>
  </form>`,
    );
  }

  const readyToShip = publish.allowed && (state.phase === 'verify' || (state.phase === 'build' && modeOf(state) === 'standard'));
  if (readyToShip) {
    if (approvals.publish_confirmed_at) {
      return banner(
        'live',
        'check',
        'Publish confirmed',
        `<p>Your assistant can publish now. Tell it to go ahead; the confirmation is used once, by that publish.</p>`,
      );
    }
    const standard = modeOf(state) === 'standard';
    return banner(
      'you',
      'globe',
      standard ? 'Ready. Publish it?' : 'Verified. Publish it?',
      `<p>${standard ? 'Typecheck and tests are green.' : "Verification passed, your plan is approved and the build's own checks are green."} Publishing makes <strong>${esc(project.name)}</strong> live on your Vercel account.</p>`,
      `<form method="post" action="/projects/${id}/confirm-publish">${csrf}<button class="btn btn-primary" type="submit">Confirm publish</button></form>`,
    );
  }

  if (state.phase === 'blocked') {
    return banner(
      'stop',
      'alert',
      'The run stopped and needs you',
      `<p>${esc(state.blocked_reason ?? 'No reason was recorded.')}</p><p class="note">Nothing has been published. Ask your assistant to restore a checkpoint, or tell it how to proceed.</p>`,
    );
  }

  if (state.phase === 'done') {
    const release = view.deployments[0] ?? null;
    const url = release ? absolute(release.url) : null;
    const version = release?.version ?? view.live.version;
    return banner(
      'live',
      'globe',
      'Live',
      `<p>${version ? `Version <span class="mono">${esc(versionLabel(version))}</span> is serving.` : 'The latest release is serving.'} Your assistant can still change it through a new run.</p>`,
      url ? `<a class="btn btn-primary" href="${esc(url)}" target="_blank" rel="noreferrer">Open the app${icon('external')}</a>` : '',
    );
  }

  return banner(
    'quiet',
    'bolt',
    'Nothing needs you',
    `<p>${esc(phaseLabel(state.phase))}. Your assistant is working; this page shows a decision here as soon as the run reaches one.</p>`,
  );
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
  <div class="inline-form">
    <input id="migration-confirm" type="text" name="confirm" autocomplete="off" required placeholder="${esc(project.slug)}">
    <button class="btn btn-primary" type="submit">Apply to live app</button>
  </div>
</form>`
    : '<p class="note">Nothing existing is removed. It reaches the live app during verification.</p>';

  return banner(
    migration.destructive ? 'you' : 'quiet',
    'db',
    esc(heading),
    `<p><strong>${esc(migration.intent)}</strong></p><ul class="list">${lines}</ul>${migration.destructive ? '<p>This can lose data. Your assistant cannot apply it without the confirmation below.</p>' : ''}`,
    '',
    action,
  );
}

function card(title: string, body: string, aside = '', cls = ''): string {
  return `<section class="card${cls ? ` ${cls}` : ''}"><header class="card-head"><h2>${title}</h2>${aside}</header>${body}</section>`;
}

function livePanel(view: ProjectView): string {
  const latest = view.deployments[0] ?? null;
  const liveUrl = latest ? absolute(latest.url) : null;
  // A new run can be in progress while the previous release is still serving,
  // so "live" is a fact about the deployment, not about the current phase.
  const serving = latest?.ready_state === 'READY';

  const body = latest
    ? `<a class="live-url" href="${esc(liveUrl!)}" target="_blank" rel="noreferrer">${icon('globe')}<span>${esc(liveUrl!.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</span>${icon('external')}</a>
<div class="card-actions">
  <a class="btn btn-sm" href="${esc(liveUrl!)}" target="_blank" rel="noreferrer">Open</a>
  <a class="btn btn-sm" href="/projects/${view.project.id}/export" download>Export code</a>
</div>`
    : `<p class="note">Nothing is live yet. ${view.publish.allowed ? 'The run is ready to publish.' : 'Publishing needs:'}</p>
${view.publish.missing.length ? `<ul class="conditions">${view.publish.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
<div class="card-actions"><a class="btn btn-sm" href="/projects/${view.project.id}/export" download>Export code</a></div>`;

  const deployments = view.deployments.length
    ? `<details class="deploys"><summary>${view.deployments.length} release${view.deployments.length === 1 ? '' : 's'}</summary><ul class="deploy-list">${view.deployments
        .map((d) => `<li><span class="mono">${esc(d.version ? versionLabel(d.version) : d.id)}</span><span class="dim">${esc(when(d.created_at))}</span></li>`)
        .join('')}</ul></details>`
    : '';

  const chip = latest
    ? `<span class="chip" data-tone="${serving ? 'live' : 'work'}">${serving ? 'Live' : 'Deploying'}${latest.version ? ` · ${esc(versionLabel(latest.version))}` : ''}</span>`
    : '<span class="chip" data-tone="work">Not published</span>';
  return card('Deployment', `${body}${deployments}`, chip);
}

/**
 * The services this project actually uses. No placeholders for email, storage
 * or jobs: Power has no provider behind them, and an empty row would read as
 * a feature that exists.
 */
function servicesPanel(view: ProjectView): string {
  const latest = view.deployments[0] ?? null;
  const serving = latest?.ready_state === 'READY';
  const row = (i: IconName, name: string, meta: string, tone: string, status: string) =>
    `<li><span class="svc-icon">${icon(i)}</span><span class="service"><span class="service-name">${name}</span><span class="service-meta">${meta}</span></span><span class="status" data-tone="${tone}">${status}</span></li>`;
  return card(
    'Services',
    `<ul class="services">
    ${row('db', 'Database', esc(view.dbLabel), 'live', 'Ready')}
    ${row('globe', 'Hosting', esc(view.deployerLabel), serving ? 'live' : 'idle', serving ? 'Serving' : 'Idle')}
    ${row('key', 'Secrets', view.secrets.length ? `${view.secrets.length} set` : 'None set', view.secrets.length ? 'live' : 'idle', view.secrets.length ? 'Set' : 'Empty')}
  </ul>`,
  );
}

function detailsPanel(view: ProjectView, budget: string): string {
  const { project, state } = view;
  return card(
    'Run',
    `<dl class="kv">
    <dt>Mode</dt><dd>${modeOf(state) === 'power_up' ? 'Power Up' : 'Standard'}</dd>
    <dt>Project ID</dt><dd><button class="copy-inline" type="button" data-copy="${esc(project.id)}" title="Copy project id">${esc(project.id)}</button></dd>
    <dt>Created</dt><dd>${esc(when(project.created_at))}</dd>
    <dt>Updated</dt><dd title="${esc(when(state.updated_at))}">${esc(relative(state.updated_at))}</dd>
    <dt>Trace</dt><dd class="truncate mono" title="${esc(state.trace_id)}">${esc(state.trace_id.slice(0, 14))}</dd>
  </dl>
  ${budget}`,
  );
}

function secretsPanel(view: ProjectView): string {
  if (!view.secrets.length) {
    return card('Secrets', '<p class="note">None set. Your assistant can request one; you enter the value here or on a one-time link, and it never reaches the conversation.</p>');
  }
  return card(
    'Secrets',
    `<ul class="secret-list">${view.secrets.map((s) => `<li><span class="mono">${esc(s.name)}</span><span class="dim">${esc(s.env)}</span></li>`).join('')}</ul>
  <p class="note">Values are never shown, here or in the conversation. Only the name and a fingerprint are visible.</p>`,
  );
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
  <div><dd>${fixes}</dd><dt>${plural(fixes, 'Fix loop', 'Fix loops')} left</dt></div>
  <div><dd>${revisions}</dd><dt>Plan ${plural(revisions, 'revision', 'revisions')}</dt></div>
  <div><dd>${refetches}</dd><dt>Research ${plural(refetches, 'refetch', 'refetches')}</dt></div>
</dl>`;

  // At done the live app is the thing to open; the workbench server is
  // yesterday's build and offering both is a way to confuse the two.
  const preview =
    view.previewUrl && state.phase !== 'done'
      ? `<a class="btn" href="${esc(view.previewUrl)}" target="_blank" rel="noreferrer">Preview${icon('external')}</a>`
      : '';

  const unpublish = !view.deployments.length ? '' : `<section class="card card-danger">
  <header class="card-head"><h2>Danger zone</h2></header>
  <details class="danger">
    <summary><span><strong>Take the live app offline</strong><span class="note">Removes the deployment. Code, history and your Vercel project stay.</span></span><span class="btn btn-sm btn-danger">Take offline…</span></summary>
    <div class="danger-body">
      <p>This removes the deployment. Your hosting project, domains, code and history stay as they are. This is not a rollback, and it cannot be undone from here.</p>
      ${view.approvals.unpublish_confirmed_at
        ? '<p class="note">Confirmed. Ask your assistant to call <code>unpublish_app</code>.</p>'
        : `<form class="confirm" method="post" action="/projects/${project.id}/confirm-unpublish">
        ${view.csrf}
        <label for="unpublish-confirm">Type <span class="mono">${esc(project.slug)}</span> to confirm</label>
        <div class="inline-form">
          <input id="unpublish-confirm" type="text" name="confirm" autocomplete="off" required placeholder="${esc(project.slug)}">
          <button class="btn btn-danger" type="submit">Take offline</button>
        </div>
      </form>`}
    </div>
  </details>
</section>`;

  const power = modeOf(state) === 'power_up';
  const body = `<nav class="crumb" aria-label="Breadcrumb"><a href="/">Projects</a><span aria-hidden="true">/</span><span aria-current="page">${esc(project.name)}</span></nav>
<header class="proj-head">
  <div class="proj-id">
    <span class="pmark pmark-lg" aria-hidden="true">${esc(initial(project.name))}</span>
    <div>
      <div class="proj-title"><h1>${esc(project.name)}</h1><span class="chip" data-tone="${TONE[state.phase]}">${esc(STATUS[state.phase])}</span></div>
      <p class="meta"><span class="mono">${esc(project.slug)}</span><span aria-hidden="true">·</span><span class="mode-badge" data-on="${power}" title="${power ? 'This run has research, a plan you approve and verification' : 'This run goes straight to the build; you still confirm before it goes live'}">${power ? `${icon('bolt')}Power Up` : 'Standard'}</span><span aria-hidden="true">·</span><span>Created ${esc(when(project.created_at))}</span></p>
    </div>
  </div>
  <div class="proj-head-actions">
    <a class="btn btn-icon" href="/projects/${project.id}/settings" aria-label="Settings" title="Settings">${icon('gear')}</a>
    ${preview}
    ${view.assistantName ? `<a class="btn btn-primary" href="/projects/${project.id}/open">${icon('terminal')}Open in ${esc(view.assistantName)}</a>` : ''}
  </div>
</header>

<section class="card card-steps">${timeline(state)}</section>
${decision(view)}
${migrationBlock(view)}

<div class="proj-grid">
  <div class="proj-main">
    ${card('Checks', gates(state), `<span class="card-sub">${power ? 'Gates this run must pass' : 'Power Up is off, so these are skipped'}</span>`)}
    ${card('Activity', historyTable(state), `<span class="card-sub">${state.history.length} event${state.history.length === 1 ? '' : 's'}</span>`)}
    ${unpublish}
  </div>

  <aside class="side">
    ${livePanel(view)}
    ${servicesPanel(view)}
    ${detailsPanel(view, budget)}
    ${secretsPanel(view)}
  </aside>
</div>`;

  return shell(ctx, project.name, body, 'projects');
}

export function specPage(view: ProjectView, ctx: PageContext): string {
  const body = `<nav class="crumb" aria-label="Breadcrumb"><a href="/">Projects</a><span aria-hidden="true">/</span><a href="/projects/${view.project.id}">${esc(view.project.name)}</a><span aria-hidden="true">/</span><span aria-current="page">Plan</span></nav>
<header class="page-head">
  <div><h1>Plan</h1><p class="meta"><span class="mono">SPEC.md</span><span aria-hidden="true">·</span><span>${view.spec ? `${view.spec.split('\n').length} lines` : 'not written yet'}</span></p></div>
  <div class="page-actions"><a class="btn" href="/projects/${view.project.id}">Back to project</a></div>
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
  <div class="page-actions"><a class="btn" href="/projects/${project.id}">Back to project</a></div>
</header>

<div class="settings-grid">
  ${card(
    'General',
    `<form class="settings-form" method="post" action="/projects/${project.id}/rename">
      ${view.csrf}
      <label for="name">Project name</label>
      <div class="inline-form">
        <input id="name" name="name" type="text" value="${esc(project.name)}" maxlength="80" required autocomplete="off">
        <button class="btn btn-primary" type="submit">Save</button>
      </div>
      ${options.saved ? `<p class="saved" role="status">${icon('check')}Saved.</p>` : ''}
      ${options.error ? `<p class="error" role="alert">${esc(options.error)}</p>` : ''}
      <p class="note">The slug <span class="mono">${esc(project.slug)}</span> stays the same. Publish, unpublish and data-change confirmations ask you to type it, so it must not move under you.</p>
    </form>`,
  )}
  ${card(
    'Project',
    `<dl class="kv">
      <dt>Project ID</dt><dd><button class="copy-inline" type="button" data-copy="${esc(project.id)}">${esc(project.id)}</button></dd>
      <dt>Slug</dt><dd class="mono">${esc(project.slug)}</dd>
      <dt>Created</dt><dd>${esc(when(project.created_at))}</dd>
      <dt>Trace</dt><dd class="truncate mono" title="${esc(view.state.trace_id)}">${esc(view.state.trace_id.slice(0, 14))}</dd>
      <dt>Database</dt><dd>${esc(view.dbLabel)}</dd>
      <dt>Hosting</dt><dd>${esc(view.deployerLabel)}</dd>
      <dt>Secrets</dt><dd>${view.secrets.length}</dd>
    </dl>`,
  )}
</div>`;
  return shell(ctx, `${project.name} settings`, body, 'projects');
}

// ----------------------------------------------------------------- connect

export interface ConnectedAssistant {
  label: string;
  token_hash: string;
  created_at: Date;
  last_used_at: Date | null;
}

export function connectPage(ctx: PageContext, assistants: { list: ConnectedAssistant[]; csrf: string; names: Record<string, string> } = { list: [], csrf: '', names: {} }): string {
  const endpoint = `${ctx.baseUrl}/mcp`;
  const free = TOOLS.filter((t) => !t.metered).length;
  const total = TOOLS.length;

  const tools = TOOLS.map(
    (t) => `<li><span class="tool-name mono">${esc(t.name)}</span><span class="tool-title">${esc(t.title)}</span><span class="tool-meta">${t.metered ? 'build action' : 'free'}${t.read_only ? ' · reads' : ''}${t.destructive ? ' · destructive' : ''}</span><span class="tool-desc">${esc(t.summary)}</span></li>`,
  ).join('');

  const connected = assistants.list.length
    ? `<ul class="tokens">${assistants.list
        .map(
          (a) => `<li><span class="token-mark">${icon('terminal')}</span><span class="token-body"><strong>${esc(assistants.names[a.label] ?? a.label)}</strong><span class="dim">Set up ${esc(relative(a.created_at.toISOString()))}${a.last_used_at ? ` · last used ${esc(relative(a.last_used_at.toISOString()))}` : ' · not used yet'}</span></span>
<form method="post" action="/start/revoke">${assistants.csrf}<input type="hidden" name="token" value="${esc(a.token_hash)}"><button class="btn btn-sm btn-danger" type="submit">Revoke</button></form></li>`,
        )
        .join('')}</ul>
<p class="note">Each holds its own token. Revoking one disconnects that tool immediately.</p>`
    : `<div class="empty empty-inline"><p>No assistant connected yet. Start a <a class="text-link" href="/?new=1">New app</a> and Power connects Claude Code, Cursor or Codex for you in one step.</p></div>`;

  const body = `<header class="page-head">
  <div>
    <h1>Connect</h1>
    <p class="lede">Power is an MCP server. Point a client at the endpoint and sign in with this account. Nothing is installed here, and no API key is involved.</p>
  </div>
  <div class="page-actions"><a class="btn btn-primary" href="/?new=1">${icon('plus')}New app</a></div>
</header>

<div class="connect-grid">
  <div class="proj-main">
    ${card(
      'Endpoint',
      `<div class="copyline">
    <code>${esc(endpoint)}</code>
    <button class="btn btn-sm" type="button" data-copy="${esc(endpoint)}">${icon('copy')}Copy</button>
  </div>
  <dl class="specs">
    <div><dt>Transport</dt><dd>Streamable HTTP</dd></div>
    <div><dt>Authorization</dt><dd>OAuth 2.1 with PKCE</dd></div>
    <div><dt>Resource metadata</dt><dd class="mono">/.well-known/oauth-protected-resource</dd></div>
  </dl>`,
      `<span class="chip" data-tone="live">${total} tools ready</span>`,
    )}
    ${card('Connected assistants', connected, `<span class="card-sub">${assistants.list.length} connected</span>`)}
    ${card(
      'Claude Code',
      `<p class="card-text">One command adds Power; Claude Code opens a sign-in page the first time it calls a tool.</p>
  <div class="copyline">
    <code>claude mcp add --transport http power ${esc(endpoint)}</code>
    <button class="btn btn-sm" type="button" data-copy="claude mcp add --transport http power ${esc(endpoint)}">${icon('copy')}Copy</button>
  </div>`,
    )}
    ${card(
      'Any MCP client',
      `<p class="card-text">Add a remote MCP server with the endpoint above. The client reads the resource metadata, discovers this server as its own authorization server, and opens a sign-in page. Afterwards it holds a token scoped to this server only.</p>`,
    )}
  </div>
  <aside class="side">
    ${card(
      'Hosting',
      `<p class="card-text">Apps publish to your own Vercel account, so you own the project, the domain and the bill.</p>
  <div class="card-actions"><a class="btn btn-sm" href="/start/vercel">${icon('globe')}Manage Vercel</a></div>`,
    )}
    ${card(
      'What it can do',
      `<p class="card-text">${total} tools, ${free} of them free. Reads and exports never count against the daily allowance; build actions do.</p>
  <details class="tool-list-wrap">
    <summary>Show every tool</summary>
    <ul class="tool-list">${tools}</ul>
  </details>`,
    )}
  </aside>
</div>`;

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

export { DASHBOARD_CSS } from './app-css.js';
