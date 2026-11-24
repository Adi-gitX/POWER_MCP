/**
 * Entrypoint: Streamable HTTP MCP at /mcp, plus the smallest web companion for
 * the decisions only a human may make — approve a plan, confirm a publish,
 * type a confirmation for a destructive migration, paste a secret.
 *
 * The MCP side is stateless: a fresh transport per request, no session
 * affinity, the caller resolved from the request each time. That is the shape
 * the hosted control plane has, and the local server should fail the same way.
 *
 * None of the approval endpoints is a tool. They are applied here, from a
 * browser, and nowhere else. The conversation can ask; it cannot answer.
 */
// Before anything else reads process.env.
import './env.js';
import { createReadStream, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { apply, canPublish, modeOf, phaseLabel as phaseLabelOf } from '@power/runstate';
import { nextAction } from '@power/protocol';
import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { authenticatorFromEnv, type Principal } from './auth.js';
import { PgliteDriver } from './db.js';
import { PostgresDriver } from './postgres-driver.js';
import { LocalDeployer } from './deploy-local.js';
import { VercelDeployer } from './deploy-vercel.js';
import { Jobs } from './jobs.js';
import { LocalRuntime } from './runtime.js';
import { FileLedger, MemoryQuota, Meter, RedisQuota, type QuotaStore } from './metering.js';
import { configFromEnv, resourceMetadataUrl } from './oauth/metadata.js';
import { ConsoleMailer, mailerFromEnv } from './oauth/pages.js';
import { PowerOAuthProvider } from './oauth/provider.js';
import { createOAuthApp, isOAuthPath, signOutDestination } from './oauth/routes.js';
import { sha256 } from './oauth/store.js';
import { openPgControlPlane, openPgliteControlPlane, type SetupState } from './pgstore.js';
import { readCookie } from './oauth/cookies.js';
import { LocalSandbox } from './sandbox.js';
import { csrfField, mintCsrf, sameOrigin, verifyCsrf, CSRF_FIELD } from './csrf.js';
import {
  connectPage,
  DASHBOARD_CSS,
  FAVICON,
  projectPage as renderProject,
  projectsPage,
  renderMessagePage,
  renderSecretPage,
  renderSecretSaved,
  settingsPage,
  specPage,
  validateProjectName,
  type MigrationView,
  type PageContext,
  type ProjectFilter,
  type ProjectRow,
  type ProjectView,
} from './dashboard.js';
import { PgSecrets, secretKeyFromEnv } from './secrets-pg.js';
import { assertRegistryCoverage, createMcpServer, type Deps } from './server.js';
import { composer, handoffPage, setupDonePage, setupPlatformPage, setupSkillPage, setupVercelPage } from './setup-pages.js';
import { slugify, startRun } from './handlers.js';
import { APP_NAME, AppJobs, jobView, type AppJob } from './new-app.js';
import {
  AUTOMATED,
  CONNECTS_ITSELF,
  PLATFORMS,
  launchLink,
  SETUP_CODE_TTL_MS,
  SKILL_NAME,
  SKILL_PATH,
  installerScript,
  nameFromIdea,
  openedHint,
  projectHandoffMessage,
  terminalStart,
  SKILL_ZIP_PATH,
  looksLikeTeam,
  looksLikeVercelToken,
  platformById,
  skillMarkdown,
  skillZip,
} from './setup.js';
import { DeployError } from './deploy.js';
import { fingerprint } from './secrets.js';
import { CONNECTION_TOKEN_PREFIX } from './auth.js';
import { randomToken } from './oauth/store.js';

/**
 * Read .env before anything else does.
 *
 * Searched upward from the working directory, because the server is usually
 * started by a package manager that has already moved into its own directory
 * while the file sits at the root of the repository. Node reads the file
 * itself, so there is no dependency for this, and a missing file is the normal
 * case in production where the platform supplies the environment.
 */
for (let dir = process.cwd(); ; ) {
  try {
    process.loadEnvFile(join(dir, '.env'));
    break;
  } catch {
    const parent = dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }
}

const PORT = Number(process.env.PORT ?? 4321);
const ROOT = resolve(process.env.POWER_LOCAL_ROOT ?? '.power-local');
const BASE_URL = process.env.POWER_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * Where previews are served.
 *
 * A preview is an application an assistant wrote, and it must not share an
 * origin with the pages that carry the approve-plan and confirm-publish forms.
 * Same-origin script can read a CSRF token out of Power's own HTML, so no
 * token and no header check can substitute for a separate host.
 *
 * Set POWER_PREVIEW_HOST to a hostname pointing at this same server -- a
 * subdomain is enough, because an origin is scheme, host and port, and Power's
 * session cookie is host-only. Unset, previews fall back to Power's own origin,
 * which is acceptable on loopback and is warned about loudly anywhere else.
 */
const PREVIEW_HOST = process.env.POWER_PREVIEW_HOST?.trim() || null;
const PREVIEW_BASE_URL = PREVIEW_HOST
  ? `${new URL(BASE_URL).protocol}//${PREVIEW_HOST}`
  : BASE_URL;

assertRegistryCoverage();

/**
 * The control plane holds every account, OAuth token, project and secret, and
 * it decides which of them a request can see: three mutually exclusive
 * row-level security scopes, enforced by Postgres rather than by this code.
 *
 * Postgres when DATABASE_URL is set, and PGlite on disk when it is not.
 * Chosen explicitly, and said out loud at startup, because the difference is
 * whether state survives the process: a hosted node with no DATABASE_URL would
 * keep its own private copy of every token and lose it on the next deploy.
 */
const controlPlane = process.env.DATABASE_URL
  ? await openPgControlPlane(process.env.DATABASE_URL)
  : await openPgliteControlPlane(join(ROOT, 'control-plane'));

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

// Everything OAuth hangs off one config, validated here so a bad origin is a
// startup failure rather than a connector that never arrives.
const oauthConfig = configFromEnv({ ...process.env, POWER_BASE_URL: BASE_URL });
const oauthProvider = new PowerOAuthProvider(controlPlane.oauth, oauthConfig);
const mailer = mailerFromEnv(process.env);
const oauthApp = createOAuthApp({
  store: controlPlane.oauth,
  controlPlane,
  config: oauthConfig,
  mailer,
  devLogin: process.env.POWER_DEV_LOGIN === '1',
  // A console mailer means the link went to this process's log; on loopback
  // that is a developer's own terminal, so showing it is a convenience. Off
  // loopback it would be an unauthenticated way into any account, so it stays
  // in the log where only the operator can see it.
  devLink: mailer instanceof ConsoleMailer && LOOPBACK_HOSTS.has(new URL(BASE_URL).hostname),
  signOutUrl: signOutDestination(BASE_URL),
});

const ALLOWED_ORIGINS = new Set(
  ['https://claude.ai', 'https://claude.com', ...(process.env.POWER_ALLOWED_ORIGINS ?? '').split(',')]
    .map((o) => o.trim())
    .filter(Boolean),
);
const ALLOWED_HOSTS = new Set(
  [new URL(BASE_URL).host, ...(PREVIEW_HOST ? [PREVIEW_HOST] : []), `localhost:${PORT}`, `127.0.0.1:${PORT}`, ...(process.env.POWER_ALLOWED_HOSTS ?? '').split(',')]
    .map((h) => h.trim())
    .filter(Boolean),
);

const auth = authenticatorFromEnv(process.env, {
  connections: {
    ownerOf: async (hash) => (await controlPlane.oauth.readConnectionToken(hash))?.user_id ?? null,
    planOf: (u) => controlPlane.planOf(u),
  },
  oauth: { verifier: oauthProvider, planOf: (u) => controlPlane.planOf(u), resource: oauthConfig.resource },
  // The browser half: the same cookie the OAuth login sets. Without it the
  // dashboard only answered bearer tokens, so a person who had just signed in
  // was still a stranger to every page.
  session: {
    userIdForSession: async (id) => (await controlPlane.oauth.readSession(sha256(id)))?.user_id ?? null,
    planOf: (u) => controlPlane.planOf(u),
  },
  host: new URL(BASE_URL).hostname,
});
const quota: QuotaStore = process.env.REDIS_URL ? new RedisQuota(new Redis(process.env.REDIS_URL)) : new MemoryQuota();
const meter = new Meter(quota, new FileLedger(join(ROOT, 'ledger.jsonl')), (u) => controlPlane.planOf(u));
const SECRET_KEY = secretKeyFromEnv(process.env, LOOPBACK_HOSTS.has(new URL(BASE_URL).hostname));
const secrets = new PgSecrets(controlPlane.sql, SECRET_KEY);
const sandbox = new LocalSandbox(ROOT);
// A project's own dev server, so it can be seen while it is being built.
const runtime = new LocalRuntime((id) => join(ROOT, 'projects', id));
// The project database. PGlite needs nothing installed; a real Postgres is
// what a hosted node uses, and the driver interface is the same either way.
// Chosen explicitly, never by falling back: a project that silently moved
// engines between boots would lose its data with nothing in the logs.
const db = process.env.POWER_PROJECT_DATABASE_URL
  ? new PostgresDriver(process.env.POWER_PROJECT_DATABASE_URL)
  : new PgliteDriver(ROOT);
// Explicit, never a fallback: a publish that silently went nowhere real is
// the failure this whole path exists to remove.
const deployer =
  process.env.POWER_DEPLOYER === 'local' ? new LocalDeployer(join(ROOT, 'previews'), BASE_URL) : new VercelDeployer();

const deps: Deps = {
  deployer,
  runtime,
  storeFor: (u) => controlPlane.storeFor(u),
  sandbox,
  db,
  secrets,
  jobs: new Jobs(),
  meter,
  baseUrl: BASE_URL,
  previewBaseUrl: PREVIEW_BASE_URL,
  powerUpDefault: async (u) => (await controlPlane.getSetup(u)).power_up === true,
  onProjectCall: (u, p) => void notePickedUp(u, p),
  pendingHandoff: async (u) => {
    // Started from "New app" in the last day, and no assistant has called on it yet.
    const setup = await controlPlane.getSetup(u);
    const store = controlPlane.storeFor(u);
    const recent = (await store.listProjects())
      .filter((p) => !setup.handoffs?.[p.id] && Date.now() - new Date(p.created_at).getTime() < 24 * 3600 * 1000)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    for (const p of recent) {
      const brief = (await store.getArtifacts(p.id))['BRIEF.md'];
      if (brief) return { project_id: p.id, name: p.name, brief: brief.replace(/^# .*\n+/, '').trim() };
    }
    return null;
  },
};

// ---------------------------------------------------------------- helpers

function text(res: ServerResponse, status: number, body: string, type = 'text/plain'): void {
  res.writeHead(status, { 'content-type': `${type}; charset=utf-8` });
  res.end(body);
}

function redirect(res: ServerResponse, to: string): void {
  res.writeHead(303, { location: to });
  res.end();
}

/**
 * Read a form body with a ceiling.
 *
 * This is reachable before authentication, on the secret form, so an
 * unbounded read here is a way to exhaust the process with one request. The
 * previous version concatenated the whole stream into a string with no limit.
 */
async function readForm(req: IncomingMessage, limitBytes = 64 * 1024): Promise<URLSearchParams> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limitBytes) {
    req.destroy();
    throw new PayloadTooLarge();
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buf.length;
    if (total > limitBytes) {
      req.destroy();
      throw new PayloadTooLarge();
    }
    chunks.push(buf);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

class PayloadTooLarge extends Error {
  constructor() {
    super('request body too large');
    this.name = 'PayloadTooLarge';
  }
}

// ---------------------------------------------------------------- MCP

async function handleMcp(req: IncomingMessage, res: ServerResponse, principal: Principal): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    // The transport has supported these all along and was given none of them.
    enableDnsRebindingProtection: true,
    allowedHosts: [...ALLOWED_HOSTS],
    allowedOrigins: [...ALLOWED_ORIGINS],
  });
  const server = createMcpServer(deps, principal);
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

// ---------------------------------------------------------------- pages

/** Everything a page needs about the person looking at it. */
async function pageContext(principal: Principal): Promise<PageContext> {
  const remaining = await meter.remaining(principal.user_id);
  // The address they signed in with, not the opaque id. A page that greets
  // someone as `usr_9f3c…` reads as a leaked internal identifier.
  const email = await controlPlane.sql
    .query<{ email: string | null }>(`select email from users where id = $1`, [principal.user_id])
    .then(({ rows }) => rows[0]?.email ?? null)
    .catch(() => null);
  return {
    baseUrl: BASE_URL,
    user: principal.user_id,
    email,
    plan: remaining.plan,
    remaining: { day: remaining.day, week: remaining.week },
  };
}

function page(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

/** A migration artifact written by an older version may not parse; show nothing rather than fail the page. */
function parseMigration(raw: string | undefined): MigrationView | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      proposal?: { intent?: string };
      verdict?: { pass?: boolean; destructive?: boolean; summary?: string[] };
      promoted_at?: string | null;
    };
    if (!parsed.proposal?.intent || !parsed.verdict) return null;
    return {
      intent: parsed.proposal.intent,
      pass: parsed.verdict.pass === true,
      destructive: parsed.verdict.destructive === true,
      summary: parsed.verdict.summary ?? [],
      promoted_at: parsed.promoted_at ?? undefined,
    };
  } catch {
    return null;
  }
}

function projectView(principal: Principal, id: string): Promise<ProjectView | null> {
  return (async () => {
    const store = controlPlane.storeFor(principal.user_id);
    const project = await store.getProject(id);
    if (!project) return null;
    const [state, approvals, artifacts, live, secretList, deployments] = await Promise.all([
      store.getRun(id),
      store.getApprovals(id),
      store.getArtifacts(id),
      sandbox.publishStatus(id),
      secrets.list(id),
      store.listDeployments(id, 'production', 8),
    ]);
    const port = runtime.portFor(id);
    return {
      project,
      state,
      approvals,
      publish: canPublish(state),
      live,
      deployments,
      secrets: secretList,
      migration: parseMigration(artifacts['migration.json']),
      spec: artifacts['SPEC.md'] ?? null,
      previewUrl: port ? `/preview/${id}/` : null,
      // Every form below authorises something an assistant is not allowed to do
      // for itself, so each one carries proof that it came from a page Power
      // rendered for this person.
      csrf: csrfField(mintCsrf(SECRET_KEY, principal.user_id, id)),
      dbLabel: process.env.POWER_PROJECT_DATABASE_URL ? 'Postgres' : 'PGlite (local)',
      deployerLabel: deployer.provider === 'vercel' ? 'Vercel' : 'Local previews',
      assistantName: platformById((await controlPlane.getSetup(principal.user_id)).platform)?.name ?? null,
    };
  })();
}

async function projectPage(principal: Principal, id: string, res: ServerResponse): Promise<void> {
  const view = await projectView(principal, id);
  if (!view) return page(res, 404, renderMessagePage('No such project', 'This project does not exist, or it belongs to another account.'));
  page(res, 200, renderProject(view, await pageContext(principal)));
}

async function specPageFor(principal: Principal, id: string, res: ServerResponse): Promise<void> {
  const view = await projectView(principal, id);
  if (!view) return page(res, 404, renderMessagePage('No such project', 'This project does not exist, or it belongs to another account.'));
  page(res, 200, specPage(view, await pageContext(principal)));
}

async function projectsHome(principal: Principal, url: URL, res: ServerResponse): Promise<void> {
  const store = controlPlane.storeFor(principal.user_id);
  const projects = await store.listProjects();
  // Someone new — no projects, setup never finished — lands in setup rather
  // than on an empty list. "Start building" on the site comes through here.
  const firstVisit = !projects.length;
  const rows: ProjectRow[] = await Promise.all(
    projects.map(async (project) => ({
      project,
      state: await store.getRun(project.id),
      live: await store.latestDeployment(project.id, 'production'),
    })),
  );
  // Search is a GET so it survives a reload, a bookmark and a browser with no
  // JavaScript. The cap is there so a 10 KB query cannot end up in the page.
  const q = (url.searchParams.get('q') ?? '').slice(0, 200);
  const raw = url.searchParams.get('state');
  const filter: ProjectFilter = raw === 'needs-you' || raw === 'live' ? raw : 'all';
  const setup = await controlPlane.getSetup(principal.user_id);
  const assistant = platformById(setup.platform);
  page(
    res,
    200,
    projectsPage(rows, await pageContext(principal), {
      q,
      filter,
      powerUp: { on: setup.power_up === true, csrf: setupCsrf(principal) },
      newApp: newAppMount(principal, setup, projects.length > 0, firstVisit),
    }),
  );
}

async function settingsPageFor(principal: Principal, id: string, url: URL, res: ServerResponse): Promise<void> {
  const view = await projectView(principal, id);
  if (!view) return page(res, 404, renderMessagePage('No such project', 'This project does not exist, or it belongs to another account.'));
  page(res, 200, settingsPage(view, await pageContext(principal), { saved: url.searchParams.get('saved') === '1' }));
}

// ------------------------------------------------------------------- setup

/** One CSRF scope for every setup form, bound to the account. */
const SETUP_SCOPE = 'setup';
const setupCsrf = (principal: Principal) => csrfField(mintCsrf(SECRET_KEY, principal.user_id, SETUP_SCOPE));

/** Only used to check a token before it is saved; publishing uses the configured deployer. */
const vercelCheck = new VercelDeployer();

async function serveSkill(req: IncomingMessage, url: URL, res: ServerResponse): Promise<void> {
  const platform = platformById(url.searchParams.get('for')) ?? platformById('claude-code')!;
  const markdown = skillMarkdown(BASE_URL, platform);
  const zip = url.pathname === SKILL_ZIP_PATH;
  const download = zip || url.searchParams.get('download') === '1';
  if (download) {
    // A signed-in download ticks the step off. Anonymous fetches (curl) are fine
    // too; they just are not attributed to anyone.
    const principal = await auth.authenticate(req).catch(() => null);
    if (principal) {
      await controlPlane.ensureUser(principal.user_id, principal.plan);
      await controlPlane.updateSetup(principal.user_id, { skill_downloaded_at: new Date().toISOString(), skill_platform: platform.id });
    }
  }
  const body = zip ? skillZip(markdown) : Buffer.from(markdown, 'utf8');
  res.writeHead(200, {
    'content-type': zip ? 'application/zip' : 'text/markdown; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...(download ? { 'content-disposition': `attachment; filename="${zip ? `${SKILL_NAME}.zip` : 'SKILL.md'}"` } : {}),
  });
  res.end(body);
}

async function setupRoute(req: IncomingMessage, url: URL, principal: Principal, res: ServerResponse): Promise<void> {
  const user = principal.user_id;
  const sub = url.pathname.replace(/^\/start\/?/, '');
  const ctx = await pageContext(principal);
  const csrf = setupCsrf(principal);
  let setup = await controlPlane.getSetup(user);

  if (req.method === 'GET') {
    // "New app" replaced the step-by-step wizard; its first page sends you there.
    if (sub === '') return redirect(res, '/?new=1');
    const platform = platformById(setup.platform);
    // The skill is for a particular assistant; without one, pick it first.
    if (!platform && sub === 'skill') return redirect(res, '/start');
    if (sub === 'skill') {
      // A fresh single-use code per view: the command on screen always works,
      // and one copied an hour ago does not.
      const code = AUTOMATED.has(platform!.id) ? await mintSetupCode(user, platform!.id) : null;
      const live = await setupStatus(user, setup);
      return page(res, 200, setupSkillPage(ctx, platform!, setup, { csrf, code, autoLaunch: url.searchParams.get('go') === '1', live }));
    }
    if (sub === 'status') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return void res.end(JSON.stringify(await setupStatus(user, setup)));
    }
    if (sub === 'vercel') return page(res, 200, setupVercelPage(ctx, setup, { csrf, justConnected: url.searchParams.get('connected') === '1', ...(await vercelPageState(user)) }));
    if (sub === 'vercel/authorize') {
      if (!VERCEL_OAUTH) return redirect(res, '/start/vercel');
      const state = randomToken();
      res.setHeader('set-cookie', `${VERCEL_STATE_COOKIE}=${state}; Path=/start/vercel; HttpOnly; SameSite=Lax; Max-Age=600${BASE_URL.startsWith('https:') ? '; Secure' : ''}`);
      return redirect(res, `${VERCEL_WEB}/integrations/${encodeURIComponent(VERCEL_OAUTH.slug)}/new?state=${state}`);
    }
    if (sub === 'vercel/callback') return await vercelCallback(req, url, user, setup, res, ctx, csrf);
    if (sub === 'done') {
      const start = composer({ csrf, powerUp: setup.power_up === true, ...(platform ? { platform } : {}) });
      return page(res, 200, setupDonePage(ctx, platform, setup, csrf, start));
    }
    return text(res, 404, 'not found');
  }
  if (req.method !== 'POST') return text(res, 405, 'method not allowed');

  // The same two checks as every other form that changes an account.
  const origin = sameOrigin(req.headers, new URL(BASE_URL).origin);
  if (!origin.ok) return text(res, 403, `refused: ${origin.reason}`);
  const form = await readForm(req);
  const check = verifyCsrf(SECRET_KEY, form.get(CSRF_FIELD), user, SETUP_SCOPE);
  if (!check.ok) {
    return text(res, 403, check.reason === 'expired' ? 'this page is too old to act on. Reload it and try again.' : 'refused: this form did not come from Power.');
  }

  if (sub === '') {
    const platform = platformById(form.get('platform'));
    if (!platform) return page(res, 400, setupPlatformPage(ctx, setup, { csrf, error: 'Pick the assistant you build with.' }));
    await controlPlane.updateSetup(user, { platform: platform.id });
    // `go` opens the assistant straight away, the way picking it implies.
    return redirect(res, '/start/skill?go=1');
  }
  if (sub === 'power-up') {
    // The account's default for new runs. A run already under way keeps the
    // mode it started with; the next create_project or start_run uses this.
    await controlPlane.updateSetup(user, { power_up: form.get('power_up') === 'on' });
    const back = form.get('back') ?? '/';
    return redirect(res, back.startsWith('/') && !back.startsWith('//') ? back : '/');
  }
  if (sub === 'later') {
    await controlPlane.updateSetup(user, { completed_at: setup.completed_at ?? new Date().toISOString() });
    return redirect(res, '/');
  }
  if (sub === 'vercel/skip') {
    await controlPlane.updateSetup(user, { vercel_skipped_at: new Date().toISOString(), completed_at: setup.completed_at ?? new Date().toISOString() });
    return redirect(res, '/');
  }
  if (sub === 'vercel') {
    const token = (form.get('token') ?? '').trim();
    const team = (form.get('team') ?? '').trim();
    const fail = async (error: string) =>
      page(res, 400, setupVercelPage(ctx, setup, { csrf, error, team, ...(await vercelPageState(user)) }));
    if (!looksLikeVercelToken(token)) return await fail('That does not look like a Vercel access token. Copy the whole token from vercel.com/account/settings/tokens.');
    if (team && !looksLikeTeam(team)) return await fail('A team is its ID (team_…) or its slug, with no spaces.');

    let account: string;
    let teamId = '';
    let teamName: string | undefined;
    try {
      account = (await vercelCheck.whoami({ token, teamId: null })).account;
      if (team) {
        const found = await vercelCheck.team({ token, teamId: team });
        teamId = found.id;
        teamName = found.slug;
      }
    } catch (error) {
      if (!(error instanceof DeployError)) throw error;
      return await fail(
        error.kind === 'auth'
          ? team
            ? 'Vercel did not accept that token for this team. Check the token’s scope, or leave the team empty for your personal account.'
            : 'Vercel did not accept that token. It may be expired or mistyped; create a new one and try again.'
          : error.kind === 'transport'
            ? 'Could not reach Vercel to check the token. Try again in a moment.'
            : team
              ? 'Vercel could not find that team. Use the team ID from the team’s settings, or its slug.'
              : 'Vercel rejected the check. Try a new token.',
      );
    }

    await saveVercel(user, token, teamId);
    setup = await controlPlane.updateSetup(user, {
      vercel_account: account,
      vercel_team: teamName ?? '',
      vercel_connected_at: new Date().toISOString(),
      vercel_via: 'token',
      completed_at: setup.completed_at ?? new Date().toISOString(),
    });
    return redirect(res, '/start/vercel?connected=1');
  }
  if (sub === 'revoke') {
    const hash = form.get('token') ?? '';
    await controlPlane.oauth.revokeConnectionToken(user, hash);
    return redirect(res, '/connect');
  }
  return text(res, 404, 'not found');
}

/**
 * What the setup page polls: only what moves the checklist, nothing secret.
 * "Connected" means a token made for *this* assistant has been used, so
 * switching assistants does not inherit an earlier tick.
 */
async function setupStatus(user: string, setup: SetupState) {
  const tokens = setup.platform ? await controlPlane.oauth.listConnectionTokens(user) : [];
  return {
    platform: setup.platform ?? null,
    installed: Boolean(setup.installer_ran_at && setup.installer_platform === setup.platform),
    connected: tokens.some((t) => t.label === setup.platform && t.last_used_at !== null),
    client: setup.mcp_client ?? null,
    vercel: Boolean(setup.vercel_connected_at),
  };
}

// ------------------------------------------------------- Vercel authorization

/**
 * Vercel's integration OAuth: the person approves Power in Vercel, Vercel
 * sends back a code, and the code becomes a token scoped to the account or
 * team they picked. Needs an integration registered for this deployment;
 * without one the page falls back to pasting a token.
 */
const VERCEL_OAUTH =
  process.env.POWER_VERCEL_CLIENT_ID && process.env.POWER_VERCEL_CLIENT_SECRET && process.env.POWER_VERCEL_INTEGRATION_SLUG
    ? {
        clientId: process.env.POWER_VERCEL_CLIENT_ID,
        clientSecret: process.env.POWER_VERCEL_CLIENT_SECRET,
        slug: process.env.POWER_VERCEL_INTEGRATION_SLUG,
      }
    : null;
const VERCEL_WEB = (process.env.POWER_VERCEL_WEB_URL?.trim() || 'https://vercel.com').replace(/\/+$/, '');
const VERCEL_API = (process.env.POWER_VERCEL_API_URL?.trim() || 'https://api.vercel.com').replace(/\/+$/, '');
const VERCEL_STATE_COOKIE = 'power_vercel_state';

async function vercelCallback(req: IncomingMessage, url: URL, user: string, setup: SetupState, res: ServerResponse, ctx: PageContext, csrf: string): Promise<void> {
  const fail = async (error: string) => page(res, 400, setupVercelPage(ctx, setup, { csrf, error, ...(await vercelPageState(user)) }));
  if (!VERCEL_OAUTH) return redirect(res, '/start/vercel');
  // The state proves this browser started the flow; without it a link could
  // attach someone else's Vercel account to this Power account.
  const expected = readCookie(req.headers.cookie, VERCEL_STATE_COOKIE);
  res.setHeader('set-cookie', `${VERCEL_STATE_COOKIE}=; Path=/start/vercel; HttpOnly; SameSite=Lax; Max-Age=0`);
  const state = url.searchParams.get('state') ?? '';
  if (!expected || !state || state !== expected) return await fail('That Vercel approval did not start here, or it took too long. Try Connect with Vercel again.');
  const code = url.searchParams.get('code');
  if (!code) return await fail('Vercel did not approve the connection. Try again, and choose Install when Vercel asks.');

  let exchanged: { access_token?: string; team_id?: string | null };
  try {
    const response = await fetch(`${VERCEL_API}/v2/oauth/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: VERCEL_OAUTH.clientId,
        client_secret: VERCEL_OAUTH.clientSecret,
        code,
        redirect_uri: `${BASE_URL}/start/vercel/callback`,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return await fail('Vercel would not complete the connection. Try Connect with Vercel again.');
    exchanged = (await response.json()) as typeof exchanged;
  } catch {
    return await fail('Could not reach Vercel to finish connecting. Try again in a moment.');
  }
  const token = exchanged.access_token;
  if (!token) return await fail('Vercel did not return an access token. Try again.');
  const teamId = exchanged.team_id ?? url.searchParams.get('teamId') ?? '';

  let account: string;
  let teamSlug = '';
  try {
    account = (await vercelCheck.whoami({ token, teamId: null })).account;
    if (teamId) teamSlug = (await vercelCheck.team({ token, teamId })).slug;
  } catch {
    return await fail('Vercel approved the connection, but the token it issued does not work. Try again.');
  }
  await saveVercel(user, token, teamId);
  await controlPlane.updateSetup(user, {
    vercel_account: account,
    vercel_team: teamSlug,
    vercel_connected_at: new Date().toISOString(),
    vercel_via: 'oauth',
    completed_at: setup.completed_at ?? new Date().toISOString(),
  });
  return redirect(res, '/start/vercel?connected=1');
}

/** The same two account secrets `publish_app` reads, through the same encrypted store. */
async function saveVercel(user: string, token: string, teamId: string): Promise<void> {
  const why = 'Saved from setup so every project publishes to your own Vercel account.';
  for (const [name, value] of [['POWER_DEPLOY_TOKEN', token], ['POWER_DEPLOY_TEAM_ID', teamId]] as const) {
    const pending = await secrets.request({ user_id: user, project_id: null, name, env: 'live', provider: 'hosting', why });
    await secrets.set(pending.token, value);
  }
}

// ----------------------------------------------------------- automated setup

async function mintSetupCode(userId: string, platform: string): Promise<string> {
  const code = randomToken();
  await controlPlane.oauth.insertSetupCode({
    code_hash: sha256(code),
    user_id: userId,
    platform,
    expires_at: new Date(Date.now() + SETUP_CODE_TTL_MS),
  });
  return code;
}

async function installerRoute(req: IncomingMessage, code: string, action: 'token' | 'done' | undefined, res: ServerResponse): Promise<void> {
  const hash = sha256(code);
  if (!action) {
    if (req.method !== 'GET') return text(res, 405, 'method not allowed');
    const found = await controlPlane.oauth.readSetupCode(hash);
    const platform = found ? platformById(found.platform) : undefined;
    res.setHeader('cache-control', 'no-store');
    if (!found || !platform || !platform.skillsDir) {
      // Still a valid script, so `| sh` says something useful instead of a syntax error.
      return text(res, 200, `#!/bin/sh\necho "Power setup: this setup command has expired or was already used. Open ${BASE_URL}/start/skill for a new one."\nexit 1\n`);
    }
    const profile = await controlPlane.oauth.profileOf(found.user_id);
    return text(res, 200, installerScript({ platform, baseUrl: BASE_URL, code, account: profile?.email ?? found.user_id }));
  }
  if (req.method !== 'POST') return text(res, 405, 'method not allowed');
  if (action === 'token') {
    // Exactly once: a replayed or leaked command gets nothing.
    const used = await controlPlane.oauth.exchangeSetupCode(hash);
    if (!used) return text(res, 410, 'expired or already used');
    const token = `${CONNECTION_TOKEN_PREFIX}${randomToken()}`;
    await controlPlane.oauth.insertConnectionToken({ token_hash: sha256(token), user_id: used.user_id, label: used.platform });
    res.setHeader('cache-control', 'no-store');
    return text(res, 200, token);
  }
  const found = await controlPlane.oauth.readSetupCode(hash);
  if (!found) return text(res, 410, 'expired');
  const now = new Date().toISOString();
  await controlPlane.updateSetup(found.user_id, {
    installer_ran_at: now,
    installer_platform: found.platform,
    skill_downloaded_at: now,
    skill_platform: found.platform,
  });
  res.writeHead(204);
  res.end();
}

/**
 * The moment setup is proven: a tool holding this account's connection token
 * calls the MCP endpoint. Recorded once, with the client's own name.
 */
const connectedSeen = new Set<string>();

async function noteAssistantConnected(req: IncomingMessage, principal: Principal): Promise<void> {
  if (!(req.headers.authorization ?? '').startsWith(`Bearer ${CONNECTION_TOKEN_PREFIX}`)) return;
  try {
    const agent = String(req.headers['user-agent'] ?? '').split(/[\s/(]/)[0]!.slice(0, 40);
    // Once per account and client per process: a tool call is not a reason to write.
    const seen = `${principal.user_id}:${agent}`;
    if (connectedSeen.has(seen)) return;
    connectedSeen.add(seen);
    await controlPlane.updateSetup(principal.user_id, { mcp_connected_at: new Date().toISOString(), mcp_client: agent || 'MCP client' });
  } catch (error) {
    console.error('[power] could not record the assistant connection', error);
  }
}

// ---------------------------------------------------------------- new app

const appJobs = new AppJobs({
  reserve: async (user) => (await meter.reserve(user)).granted,
  createProject: async (job) => {
    const id = randomBytes(5).toString('hex');
    const store = controlPlane.storeFor(job.user);
    await sandbox.create(id, job.name);
    await store.createProject({ id, name: job.name, slug: job.name, created_at: new Date().toISOString() }, startRun(`run_${id}`, job.mode));
    const brief = `# ${job.name}\n\n${job.description || '(No description yet: ask what to build.)'}\n${job.importPath ? `\nExisting code: ${job.importPath}\n` : ''}`;
    await store.putArtifact(id, 'BRIEF.md', brief);
    await sandbox.writeFile(id, 'BRIEF.md', brief);
    await meter.record({ at: new Date().toISOString(), request_id: `app_${job.id}`, user_id: job.user, project_id: id, tool: 'create_project', outcome: 'ok', billable: true, duration_ms: 0 });
    return id;
  },
  toolConnected: async (user, tool) => (CONNECTS_ITSELF.has(tool as never) ? assistantConnected(user, tool) : true),
  mintSetupCode: (user, tool) => mintSetupCode(user, tool),
  hosting: async (user) => {
    const setup = await controlPlane.getSetup(user);
    if (!setup.vercel_connected_at || !(await secrets.accountValue(user, 'POWER_DEPLOY_TOKEN'))) return null;
    return { account: setup.vercel_account ?? 'Vercel' };
  },
  hostingLabel: deployer instanceof LocalDeployer ? 'local previews while you build here' : '',
  provisionDatabase: async (projectId) => {
    await db.provision(projectId);
  },
  finish: async (job) => {
    await sandbox.checkpoint(job.projectId!, `Set up ${job.name}`, { 'Power-Phase': 'intake', 'Power-Setup': 'new-app' });
    const setup = await controlPlane.getSetup(job.user);
    await controlPlane.updateSetup(job.user, { completed_at: setup.completed_at ?? new Date().toISOString() });
  },
  toolName: (tool) => platformById(tool)?.name ?? 'your assistant',
  connectHref: VERCEL_OAUTH ? '/start/vercel/authorize' : '/start/vercel',
});

/** The dialog's mount point, config and bundle, for any page with a "New app" button. */
function newAppMount(principal: Principal, setup: SetupState, returning: boolean, autoOpen: boolean): string {
  const config = {
    csrf: mintCsrf(SECRET_KEY, principal.user_id, SETUP_SCOPE),
    tools: PLATFORMS.filter((p) => p.id !== 'claude-app').map((p) => ({ id: p.id, name: p.id === 'other' ? 'Another tool' : p.name, blurb: p.blurb, mark: p.mark })),
    tool: setup.platform && setup.platform !== 'claude-app' ? setup.platform : null,
    returning: returning || Boolean(setup.platform && setup.platform !== 'claude-app'),
    powerUp: setup.power_up === true,
  };
  return `<div data-new-app-root></div>
<script type="application/json" id="new-app-config">${JSON.stringify(config).replace(/</g, '\\u003c')}</script>
<link rel="stylesheet" href="/assets/otp/new-app.css?v=${ASSET_VERSION}">
<script src="/assets/otp/new-app.js?v=${ASSET_VERSION}" defer></script>${autoOpen ? `<script>if(!location.search.includes('new='))history.replaceState(null,'','?new=1')</script>` : ''}`;
}

async function readJson(req: IncomingMessage, limitBytes = 32 * 1024): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limitBytes) throw new PayloadTooLarge();
  }
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** The hand-off for a finished job: the message, the link that opens the tool with it, and the recovery routes. */
async function handoffFor(job: AppJob) {
  const platform = platformById(job.tool)!;
  const message = projectHandoffMessage({
    platform,
    baseUrl: BASE_URL,
    project: { id: job.projectId!, name: job.name },
    mode: job.mode,
    idea: job.description,
    importPath: job.importPath,
    installCode: job.installCode,
  });
  // The terminal route connects first and only then starts the assistant, so
  // its very first session already has Power's tools: no restart, no re-asking.
  const startMessage = job.installCode
    ? projectHandoffMessage({ platform, baseUrl: BASE_URL, project: { id: job.projectId!, name: job.name }, mode: job.mode, idea: job.description, importPath: job.importPath, installCode: null })
    : message;
  const start = terminalStart(platform, startMessage);
  const terminal = start ? (job.installCode ? `curl -fsSL ${BASE_URL}/setup/${job.installCode} | sh && ${start}` : start) : null;
  return {
    tool: platform.id,
    tool_name: platform.name,
    message,
    deeplink: launchLink(platform, message),
    download_url: platform.installUrl ?? null,
    opened_hint: openedHint(platform),
    terminal,
    connect_first: Boolean(job.installCode),
    project_url: `/projects/${job.projectId}`,
  };
}

/**
 * The dialog's API. Same session as the pages; every write also proves it
 * came from a page Power rendered (the setup CSRF token, in a header) and
 * from Power's own origin.
 */
async function appsApi(req: IncomingMessage, url: URL, principal: Principal, res: ServerResponse): Promise<void> {
  const user = principal.user_id;
  if (req.method === 'POST') {
    const origin = sameOrigin(req.headers, new URL(BASE_URL).origin);
    if (!origin.ok) return json(res, 403, { error: 'cross_origin', message: origin.reason });
    const check = verifyCsrf(SECRET_KEY, String(req.headers['x-power-csrf'] ?? ''), user, SETUP_SCOPE);
    if (!check.ok) return json(res, 403, { error: 'csrf', message: check.reason === 'expired' ? 'This page is too old. Reload it and try again.' : 'Refused.' });
  }

  if (url.pathname === '/api/apps' && req.method === 'POST') {
    const body = await readJson(req);
    const tool = String(body.tool ?? '');
    const name = String(body.name ?? '').trim();
    const description = String(body.description ?? '').trim().slice(0, 1500);
    const importPath = typeof body.import_path === 'string' && body.import_path.trim() ? body.import_path.trim().slice(0, 300) : null;
    const powerUp = body.power_up === true;
    if (!platformById(tool) || tool === 'claude-app') return json(res, 400, { error: 'tool', message: 'Pick the coding tool you use.' });
    if (!APP_NAME.test(name)) return json(res, 400, { error: 'name', message: 'Use lowercase letters, numbers and single hyphens, starting with a letter.' });
    const taken = (await controlPlane.storeFor(user).listProjects()).some((p) => p.slug === name);
    if (taken) return json(res, 409, { error: 'name_taken', message: `You already have an app called ${name}. Pick another name.` });
    // The choices carry over to the next app, as the reference flow does.
    await controlPlane.updateSetup(user, { platform: tool, power_up: powerUp });
    const job = appJobs.start({ user, tool, name, description, mode: powerUp ? 'power_up' : 'standard', importPath });
    return json(res, 201, jobView(job));
  }

  const jobMatch = /^\/api\/apps\/jobs\/([A-Za-z0-9_-]+)(?:\/(retry|skip))?$/.exec(url.pathname);
  if (jobMatch) {
    const job = appJobs.get(jobMatch[1]!, user);
    if (!job) return json(res, 404, { error: 'no_job', message: 'This setup is no longer running. Start it again.' });
    if (req.method === 'POST' && jobMatch[2] === 'skip') appJobs.skip(job);
    else if (jobMatch[2] === 'retry' || (req.method === 'GET' && job.blocker)) await appJobs.retry(job);
    return json(res, 200, { ...jobView(job), handoff: job.done ? await handoffFor(job) : null });
  }

  return json(res, 404, { error: 'not_found' });
}

// ------------------------------------------------------------ project hand-off

const pickedUp = new Set<string>();

/** Records the first tool call an assistant makes on a project. Once per project per process. */
async function notePickedUp(user: string, projectId: string): Promise<void> {
  const key = `${user}:${projectId}`;
  if (pickedUp.has(key)) return;
  pickedUp.add(key);
  try {
    const setup = await controlPlane.getSetup(user);
    if (setup.handoffs?.[projectId]) return;
    await controlPlane.updateSetup(user, { handoffs: { ...(setup.handoffs ?? {}), [projectId]: new Date().toISOString() } });
  } catch (error) {
    pickedUp.delete(key);
    console.error('[power] could not record the hand-off', error);
  }
}

/** Is this assistant already connected to the account? A used token for it says yes. */
async function assistantConnected(user: string, platformId: string): Promise<boolean> {
  return (await controlPlane.oauth.listConnectionTokens(user)).some((t) => t.label === platformId && t.last_used_at !== null);
}

/**
 * The browser's half of create_project: the person says what to build, Power
 * creates the project with the run's mode, and hands it to their assistant.
 * Billed as one build action, like the tool.
 */
async function newProjectFromBrowser(req: IncomingMessage, principal: Principal, res: ServerResponse): Promise<void> {
  const origin = sameOrigin(req.headers, new URL(BASE_URL).origin);
  if (!origin.ok) return text(res, 403, `refused: ${origin.reason}`);
  const form = await readForm(req);
  const check = verifyCsrf(SECRET_KEY, form.get(CSRF_FIELD), principal.user_id, SETUP_SCOPE);
  if (!check.ok) return text(res, 403, check.reason === 'expired' ? 'this page is too old to act on. Reload it and try again.' : 'refused: this form did not come from Power.');

  const idea = (form.get('idea') ?? '').trim();
  if (idea.length < 4) return redirect(res, '/');
  const reservation = await meter.reserve(principal.user_id);
  if (!reservation.granted) {
    return page(res, 429, renderMessagePage('Out of build actions', `This plan's ${reservation.exhausted?.window ?? 'daily'} allowance is used up. It resets ${reservation.exhausted?.resets_at ?? 'soon'}.`));
  }
  const mode = form.get('power_up') === 'on' ? 'power_up' : 'standard';
  const id = randomBytes(5).toString('hex');
  const name = nameFromIdea(idea);
  const store = controlPlane.storeFor(principal.user_id);
  await sandbox.create(id, slugify(name));
  await store.createProject({ id, name, slug: slugify(name), created_at: new Date().toISOString() }, startRun(`run_${id}`, mode));
  // The request in the person's words, beside the code, so any assistant can read it later.
  await store.putArtifact(id, 'BRIEF.md', `# ${name}\n\n${idea}\n`);
  await sandbox.writeFile(id, 'BRIEF.md', `# ${name}\n\n${idea}\n`);
  await meter.record({ at: new Date().toISOString(), request_id: `web_${id}`, user_id: principal.user_id, project_id: id, tool: 'create_project', outcome: 'ok', billable: true, duration_ms: 0 });
  return redirect(res, `/projects/${id}/open?go=1`);
}

async function openInAssistant(principal: Principal, id: string, statusOnly: boolean, url: URL, res: ServerResponse): Promise<void> {
  const user = principal.user_id;
  const store = controlPlane.storeFor(user);
  const project = await store.getProject(id);
  if (!project) return page(res, 404, renderMessagePage('No such project', 'This project does not exist, or it belongs to another account.'));
  const state = await store.getRun(id);
  const setup = await controlPlane.getSetup(user);

  if (statusOnly) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return void res.end(JSON.stringify({ picked_up: Boolean(setup.handoffs?.[id]), phase: phaseLabelOf(state.phase) }));
  }

  const platform = platformById(setup.platform);
  if (!platform) return redirect(res, '/start');
  const artifacts = await store.getArtifacts(id);
  const brief = artifacts['BRIEF.md']?.replace(/^# .*\n+/, '').trim();
  const fresh = state.history.length <= 1 && !setup.handoffs?.[id];
  const installs = AUTOMATED.has(platform.id) && CONNECTS_ITSELF.has(platform.id) && !(await assistantConnected(user, platform.id));
  const message = projectHandoffMessage({
    platform,
    baseUrl: BASE_URL,
    project,
    mode: modeOf(state),
    ...(fresh && brief ? { idea: brief } : { progress: { phase: phaseLabelOf(state.phase), next: nextAction(state)?.tool ?? null } }),
    installCode: installs ? await mintSetupCode(user, platform.id) : null,
  });
  page(
    res,
    200,
    handoffPage(await pageContext(principal), {
      csrf: setupCsrf(principal),
      project,
      platform,
      message,
      launch: launchLink(platform, message),
      terminal: terminalStart(platform, message),
      installs,
      autoLaunch: url.searchParams.get('go') === '1',
      pickedUp: Boolean(setup.handoffs?.[id]),
      mode: modeOf(state),
    }),
  );
}

async function vercelPageState(user: string): Promise<{ localDeployer: boolean; token: { fingerprint: string } | null; oauth: boolean }> {
  const token = await secrets.accountValue(user, 'POWER_DEPLOY_TOKEN');
  return { localDeployer: deployer instanceof LocalDeployer, token: token ? { fingerprint: fingerprint(token) } : null, oauth: Boolean(VERCEL_OAUTH) };
}

async function secretPage(token: string, res: ServerResponse, error?: string): Promise<void> {
  const pending = await secrets.pending(token);
  if (!pending) return page(res, 404, renderSecretPage(null));
  page(res, error ? 400 : 200, renderSecretPage(pending, error));
}

/** Static files from a local deployment. Path traversal is refused, not sanitised. */
async function servePreview(local: LocalDeployer, id: string, rest: string, res: ServerResponse): Promise<void> {
  const root = local.dirFor(id);
  const wanted = rest === '' || rest.endsWith('/') ? `${rest}index.html` : rest;

  // A release is laid out the way its framework wants, not the way this route
  // once assumed. The template's page is at public/index.html, so looking only
  // at the release root answered 404 for every app Power generates.
  for (const candidate of [wanted, `public/${wanted}`]) {
    const target = resolve(root, candidate);
    if (target !== root && !target.startsWith(root + sep)) return text(res, 400, 'bad path');
    try {
      const body = await readFile(target);
      const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
      return;
    } catch {
      // Try the next layout.
    }
  }
  text(res, 404, 'not found');
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/** Forward a request to a project's dev server and stream the answer back. */
function proxyTo(req: IncomingMessage, res: ServerResponse, port: number, path: string): void {
  const upstream = httpRequest(
    { host: '127.0.0.1', port, path, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    },
  );
  upstream.on('error', (error) => {
    // The child died mid-request. Say so rather than hanging.
    if (!res.headersSent) text(res, 502, `the preview stopped responding: ${error.message}`);
    else res.end();
  });
  req.pipe(upstream);
}

// ------------------------------------------------------------ http guards


/**
 * `www-authenticate` has to be exposed or a browser-based client cannot read
 * the challenge that tells it where to sign in.
 */
function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
  }
  res.setHeader('access-control-expose-headers', 'mcp-session-id, www-authenticate');
}

function preflight(req: IncomingMessage, res: ServerResponse): void {
  applyCors(req, res);
  res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader(
    'access-control-allow-headers',
    'authorization, content-type, mcp-session-id, mcp-protocol-version, last-event-id',
  );
  res.setHeader('access-control-max-age', '86400');
  res.writeHead(204);
  res.end();
}

/**
 * The challenge Claude follows to find the authorization server. Without the
 * `resource_metadata` pointer it has nothing to go on and the connection fails
 * with no useful error on either side.
 */
/** A browser following a link or loading a page, not a client calling the API. */
function browserNavigation(req: IncomingMessage): boolean {
  return req.method === 'GET' && (req.headers.accept ?? '').includes('text/html');
}

function unauthorised(res: ServerResponse): void {
  res.setHeader(
    'www-authenticate',
    `Bearer realm="power", error="invalid_token", resource_metadata="${resourceMetadataUrl(oauthConfig)}"`,
  );
  res.writeHead(401, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'invalid_token', error_description: 'A valid OAuth access token is required.' }));
}

/** The host the client actually asked for, without its port. */
function hostOf(req: IncomingMessage): string {
  return (req.headers.host ?? '').split(':')[0] ?? '';
}

// ---------------------------------------------------------------- routing

/** Read once at boot: two files, 63 KB, and every page needs them. */
const FONTS = new Map<string, Buffer>(
  ['inter-latin.woff2', 'fragment-mono-latin.woff2'].flatMap((name) => {
    try {
      return [[`/assets/fonts/${name}`, readFileSync(new URL(`../assets/fonts/${name}`, import.meta.url))] as const];
    } catch {
      // A checkout that has not copied the fonts yet still serves pages, in
      // the system fallback stack, instead of refusing to start.
      return [];
    }
  }),
);

/**
 * The sign-in code input: apps/site's OtpInput component, compiled by
 * `pnpm --filter @power/site build:otp`. Missing files are fine; the page
 * falls back to its plain boxes.
 */
/** Changes on every restart, so a rebuilt bundle is never served from a stale cache. */
const ASSET_VERSION = Date.now().toString(36);
const OTP_ASSETS = new Map<string, { body: Buffer; type: string }>(
  [
    // The landing page's own imagery, so the app shares its sky, not an imitation of it.
    ['../img/hero-bg.jpg', 'image/jpeg'],
    ['../img/dunes.webp', 'image/webp'],
    ['otp.js', 'text/javascript; charset=utf-8'],
    ['otp.css', 'text/css; charset=utf-8'],
    ['new-app.js', 'text/javascript; charset=utf-8'],
    ['new-app.css', 'text/css; charset=utf-8'],
  ].flatMap(([name, type]) => {
    try {
      const path = name!.startsWith('../') ? `/assets/${name!.slice(3)}` : `/assets/otp/${name}`;
      return [[path, { body: readFileSync(new URL(`../assets/otp/${name}`, import.meta.url)), type: type! }]] as const;
    } catch {
      return [];
    }
  }),
);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', BASE_URL);
  try {
    if (req.method === 'OPTIONS') return preflight(req, res);
    applyCors(req, res);

    // The stylesheet is public and content-free; everything else below needs a
    // session. It is revalidated rather than cached, because a stale design is
    // worse than one extra request, and the version query handles the rest.
    if (url.pathname === '/assets/dashboard.css') {
      res.writeHead(200, {
        'content-type': 'text/css; charset=utf-8',
        'cache-control': 'no-cache',
        'content-length': String(Buffer.byteLength(DASHBOARD_CSS)),
      });
      return void res.end(DASHBOARD_CSS);
    }
    if (url.pathname === '/assets/favicon.svg') {
      res.writeHead(200, {
        'content-type': 'image/svg+xml',
        'cache-control': 'public, max-age=86400',
        'content-length': String(Buffer.byteLength(FAVICON)),
      });
      return void res.end(FAVICON);
    }
    // The same two faces the marketing site uses. Served from here so the app
    // and the site are typographically identical rather than merely similar;
    // a font that silently 404s would fall back and undo the whole design.
    const otpAsset = OTP_ASSETS.get(url.pathname);
    if (otpAsset) {
      res.writeHead(200, {
        'content-type': otpAsset.type,
        'cache-control': 'public, max-age=3600',
        'content-length': String(otpAsset.body.length),
      });
      return void res.end(otpAsset.body);
    }
    const font = FONTS.get(url.pathname);
    if (font) {
      res.writeHead(200, {
        'content-type': 'font/woff2',
        'cache-control': 'public, max-age=31536000, immutable',
        'access-control-allow-origin': '*',
        'content-length': String(font.length),
      });
      return void res.end(font);
    }

    // A health check that answers 200 unconditionally is worse than none: the
    // platform keeps a node in rotation, and every tool call fails, because the
    // one thing that can actually be broken is the database this never touched.
    if (url.pathname === '/health') {
      try {
        await controlPlane.sql.query('select 1');
      } catch (error) {
        return text(res, 503, `control plane unreachable: ${(error as Error).message}`);
      }
      return text(res, 200, 'ok');
    }

    // The origin split, enforced both ways.
    //
    // On the preview host nothing of Power's own exists: no project pages, no
    // MCP endpoint, no sign-in, no OAuth. That is the point -- an application
    // an assistant wrote is served there, and it must not be able to reach the
    // forms that authorise a publish, even with a stolen token, because it
    // cannot reach them at all.
    //
    // On Power's own host, previews stop being served once a preview host
    // exists, so there is no second route back to the same-origin problem.
    const onPreviewHost = PREVIEW_HOST !== null && hostOf(req) === PREVIEW_HOST;
    if (onPreviewHost && !/^\/(preview|previews)\//.test(url.pathname)) {
      return text(res, 404, 'not found');
    }
    if (PREVIEW_HOST !== null && !onPreviewHost && /^\/preview\//.test(url.pathname)) {
      return text(res, 404, `previews are served from ${PREVIEW_HOST}`);
    }

    // Locally deployed releases, served so a publish produces a URL that opens.
    const preview = /^\/previews\/(dpl_local_[a-z0-9_]+)\/(.*)$/.exec(url.pathname);
    if (preview && deployer instanceof LocalDeployer) {
      return await servePreview(deployer, preview[1]!, preview[2]!, res);
    }

    // Discovery, sign-in and consent all live in the Express app, and all of
    // them have to answer before anything is authenticated.
    if (isOAuthPath(url.pathname)) return oauthApp(req, res);

    // The Power skill is public: it holds instructions and this server's
    // address, nothing about any account, and a terminal `curl` has no session.
    if (req.method === 'GET' && (url.pathname === SKILL_PATH || url.pathname === SKILL_ZIP_PATH)) {
      return await serveSkill(req, url, res);
    }

    // The setup installer and its two callbacks. Authorised by the one-time
    // code in the path, not by a session: they are called from a terminal.
    const installer = /^\/setup\/([A-Za-z0-9_-]{20,100})(?:\/(token|done))?$/.exec(url.pathname);
    if (installer) return await installerRoute(req, installer[1]!, installer[2] as 'token' | 'done' | undefined, res);

    // Secret forms are reached by an unguessable token, not by login.
    const secretMatch = /^\/secrets\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (secretMatch) {
      const token = secretMatch[1]!;
      if (req.method === 'GET') return await secretPage(token, res);
      if (req.method === 'POST') {
        if (!(await secrets.pending(token))) return await secretPage(token, res);
        const value = (await readForm(req)).get('value') ?? '';
        if (value.length < 8) return await secretPage(token, res, 'That value is too short to be a credential.');
        const record = await secrets.set(token, value);
        return page(res, 200, renderSecretSaved(record));
      }
      return text(res, 405, 'method not allowed');
    }

    const principal = await auth.authenticate(req);
    if (!principal) {
      // A person who is not signed in gets the sign-in page and comes back to
      // where they were. An API call still gets the bearer challenge it can
      // act on. Without this split, the dashboard was a 401 page with no way
      // to reach the login form that would have fixed it.
      if (browserNavigation(req) && url.pathname !== '/mcp') {
        return redirect(res, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
      }
      return unauthorised(res);
    }
    await controlPlane.ensureUser(principal.user_id, principal.plan);

    // A project's preview, proxied so the URL lives on Power's own origin.
    // A port on the server's loopback is no use to anyone else once Power is
    // hosted; a path under this origin is.
    const livePreview = /^\/preview\/([a-z0-9]+)(\/.*)?$/.exec(url.pathname);
    if (livePreview) {
      const projectId = livePreview[1]!;
      const owned = await controlPlane.storeFor(principal.user_id).getProject(projectId);
      if (!owned) return text(res, 404, 'no such project');
      const port = runtime.portFor(projectId);
      if (!port) {
        return page(
          res,
          503,
          renderMessagePage('Not running', 'This project has no dev server up. Ask the assistant to call get_preview_url.'),
        );
      }
      return proxyTo(req, res, port, (livePreview[2] ?? '/') + url.search);
    }

    if (url.pathname === '/mcp') {
      void noteAssistantConnected(req, principal);
      return await handleMcp(req, res, principal);
    }

    if (req.method === 'GET' && url.pathname === '/') return await projectsHome(principal, url, res);
    if (req.method === 'GET' && url.pathname === '/projects') return redirect(res, '/');
    if (req.method === 'GET' && url.pathname === '/connect') {
      const list = await controlPlane.oauth.listConnectionTokens(principal.user_id);
      const names = Object.fromEntries(PLATFORMS.map((p) => [p.id, p.name]));
      return page(res, 200, connectPage(await pageContext(principal), { list, csrf: setupCsrf(principal), names }));
    }

    if (url.pathname === '/start' || url.pathname.startsWith('/start/')) return await setupRoute(req, url, principal, res);

    // The anti-lock-in promise has to be reachable from a browser, not just a
    // path on the server's disk. `export_project` hands back this URL; the
    // bundle is built from the project's git history and streamed as a file.
    const exportMatch = /^\/projects\/([a-z0-9]+)\/export$/.exec(url.pathname);
    if (req.method === 'GET' && exportMatch) {
      const projectId = exportMatch[1]!;
      const owned = await controlPlane.storeFor(principal.user_id).getProject(projectId);
      if (!owned) return text(res, 404, 'no such project');
      const bundle = await sandbox.exportBundle(projectId);
      const size = (await stat(bundle.path)).size;
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(size),
        'content-disposition': `attachment; filename="${owned.slug}.bundle"`,
        'cache-control': 'no-store',
      });
      createReadStream(bundle.path).pipe(res);
      return;
    }

    if (url.pathname.startsWith('/api/apps')) return await appsApi(req, url, principal, res);
    if (url.pathname === '/projects/new' && req.method === 'POST') return await newProjectFromBrowser(req, principal, res);
    const opening = /^\/projects\/([a-z0-9]+)\/open(\/status)?$/.exec(url.pathname);
    if (opening && req.method === 'GET') return await openInAssistant(principal, opening[1]!, Boolean(opening[2]), url, res);

    const match = /^\/projects\/([a-z0-9]+)(?:\/([a-z-]+))?$/.exec(url.pathname);
    if (!match) return text(res, 404, 'not found');
    const [, id = '', sub] = match;
    const store = controlPlane.storeFor(principal.user_id);
    const project = await store.getProject(id);
    if (!project) return text(res, 404, 'no such project');

    if (req.method === 'GET' && !sub) return await projectPage(principal, id, res);
    if (req.method === 'GET' && sub === 'spec') return await specPageFor(principal, id, res);
    if (req.method === 'GET' && sub === 'settings') return await settingsPageFor(principal, id, url, res);

    if (req.method !== 'POST') return text(res, 405, 'method not allowed');

    // Nothing below this line may run for a request Power cannot attribute to
    // a page it rendered for this person. These four endpoints are the human
    // decisions -- approving a plan, and confirming a change to the live app --
    // and they were reachable by any page on the internet that could get a
    // logged-in browser to submit a form.
    const origin = sameOrigin(req.headers, new URL(BASE_URL).origin);
    if (!origin.ok) return text(res, 403, `refused: ${origin.reason}`);

    const form = await readForm(req);
    const csrf = verifyCsrf(SECRET_KEY, form.get(CSRF_FIELD), principal.user_id, id);
    if (!csrf.ok) {
      return text(
        res,
        403,
        csrf.reason === 'expired'
          ? 'this page is too old to act on. Reload the project page and try again.'
          : 'refused: this form did not come from Power.',
      );
    }

    const state = await store.getRun(id);
    const approvals = await store.getApprovals(id);
    const now = new Date().toISOString();

    if (sub === 'rename') {
      const check = validateProjectName(form.get('name') ?? '');
      if (!check.ok) {
        const view = await projectView(principal, id);
        if (!view) return text(res, 404, 'no such project');
        return page(res, 400, settingsPage(view, await pageContext(principal), { error: check.error }));
      }
      await store.renameProject(id, check.name);
      return redirect(res, `/projects/${id}/settings?saved=1`);
    }
    if (sub === 'approve-spec') {
      await store.putRun(id, apply(state, { type: 'spec_approved' }));
      await store.putApprovals(id, { ...approvals, spec_approved_at: now });
      return redirect(res, `/projects/${id}`);
    }
    if (sub === 'reject-spec') {
      const reason = form.get('reason') ?? 'rejected by the user';
      await store.putRun(id, apply(state, { type: 'spec_rejected', reason }));
      return redirect(res, `/projects/${id}`);
    }
    if (sub === 'confirm-publish') {
      if (!canPublish(state).allowed) return text(res, 409, 'not ready to publish');
      await store.putApprovals(id, { ...approvals, publish_confirmed_at: now });
      return redirect(res, `/projects/${id}`);
    }
    if (sub === 'confirm-unpublish') {
      // Typed, not a button: this is the most destructive thing Power can do
      // on a user's behalf, and it is the opposite of publishing, so it never
      // shares the publish confirmation.
      const typed = form.get('confirm') ?? '';
      if (typed.trim() !== project.slug) return text(res, 400, `type "${project.slug}" exactly to confirm`);
      await store.putApprovals(id, { ...approvals, unpublish_confirmed_at: now });
      return redirect(res, `/projects/${id}`);
    }
    if (sub === 'confirm-migration') {
      // Typed confirmation: the project slug, exactly. A button is too easy to click.
      const typed = form.get('confirm') ?? '';
      if (typed.trim() !== project.slug) return text(res, 400, `type "${project.slug}" exactly to confirm`);
      await store.putApprovals(id, { ...approvals, migration_confirmed_at: now });
      return redirect(res, `/projects/${id}`);
    }
    return text(res, 404, 'not found');
  } catch (error) {
    console.error('[power] request failed', error);
    if (error instanceof PayloadTooLarge) {
      if (!res.headersSent) text(res, 413, 'request body too large');
      return;
    }
    if (!res.headersSent) text(res, 500, 'internal error');
  }
});

// A short request timeout would cut streaming responses off mid-flight, so it
// is generous; the headers timeout is what actually sheds a slow-loris.
server.headersTimeout = 10_000;
server.requestTimeout = 60_000;
server.keepAliveTimeout = 65_000;
server.maxHeadersCount = 64;

server.listen(PORT, () => {
  console.log(`power  mcp:   ${BASE_URL}/mcp`);
  console.log(`power  web:   ${BASE_URL}/`);
  console.log(`power  data:  ${ROOT}`);
  // Say which one, because the difference is whether anything survives a
  // deploy, and getting it wrong is silent until the first restart.
  console.log(`power  state: ${process.env.DATABASE_URL ? 'postgres' : `pglite at ${ROOT}/control-plane (not durable across deploys)`}`);
  console.log(`power  oauth: ${oauthConfig.issuer}/.well-known/oauth-authorization-server`);
  console.log(`power  auth:  ${[process.env.POWER_DEV_AUTH === '1' ? 'dev' : '', process.env.POWER_TOKENS ? 'bearer tokens' : '', 'oauth'].filter(Boolean).join(' + ')}`);
  console.log(`power  quota: ${process.env.REDIS_URL ? 'redis' : 'in-memory'}`);
  console.log(`power  prevw: ${PREVIEW_HOST ? PREVIEW_BASE_URL : `${BASE_URL} (same origin)`}`);
  console.log(
    `power  appdb: ${process.env.POWER_PROJECT_DATABASE_URL ? 'postgres' : 'pglite over a socket'}`,
  );
  if (!PREVIEW_HOST && !LOOPBACK_HOSTS.has(new URL(BASE_URL).hostname)) {
    // Not fatal, because refusing to start would be worse for someone who has
    // already deployed. Loud, because the consequence is that an application
    // an assistant wrote shares an origin with the forms that authorise a
    // publish, and same-origin script can read the token that protects them.
    console.warn(
      '[power] POWER_PREVIEW_HOST is unset off loopback. Previews share this origin, so a\n' +
        '        generated app can read the CSRF token out of Power\u2019s own pages and confirm\n' +
        '        its own publish. Point a subdomain at this server and set it.',
    );
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    void Promise.all([runtime.stopAll(), db.close(), controlPlane.close()]).finally(() => process.exit(0));
  });
}
