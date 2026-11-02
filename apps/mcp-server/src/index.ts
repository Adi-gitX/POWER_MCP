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
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { apply, canPublish } from '@power/runstate';
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
import { mailerFromEnv } from './oauth/pages.js';
import { PowerOAuthProvider } from './oauth/provider.js';
import { createOAuthApp, isOAuthPath } from './oauth/routes.js';
import { openPgControlPlane, openPgliteControlPlane } from './pgstore.js';
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

// Everything OAuth hangs off one config, validated here so a bad origin is a
// startup failure rather than a connector that never arrives.
const oauthConfig = configFromEnv({ ...process.env, POWER_BASE_URL: BASE_URL });
const oauthProvider = new PowerOAuthProvider(controlPlane.oauth, oauthConfig);
const oauthApp = createOAuthApp({
  store: controlPlane.oauth,
  controlPlane,
  config: oauthConfig,
  mailer: mailerFromEnv(process.env),
  devLogin: process.env.POWER_DEV_LOGIN === '1',
});

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

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
  oauth: { verifier: oauthProvider, planOf: (u) => controlPlane.planOf(u), resource: oauthConfig.resource },
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

const deps: Deps = { deployer, runtime, storeFor: (u) => controlPlane.storeFor(u), sandbox, db, secrets, jobs: new Jobs(), meter, baseUrl: BASE_URL, previewBaseUrl: PREVIEW_BASE_URL };

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
  return {
    baseUrl: BASE_URL,
    user: principal.user_id,
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
  page(res, 200, projectsPage(rows, await pageContext(principal), { q, filter }));
}

async function settingsPageFor(principal: Principal, id: string, url: URL, res: ServerResponse): Promise<void> {
  const view = await projectView(principal, id);
  if (!view) return page(res, 404, renderMessagePage('No such project', 'This project does not exist, or it belongs to another account.'));
  page(res, 200, settingsPage(view, await pageContext(principal), { saved: url.searchParams.get('saved') === '1' }));
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
    if (!principal) return unauthorised(res);
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

    if (url.pathname === '/mcp') return await handleMcp(req, res, principal);

    if (req.method === 'GET' && url.pathname === '/') return await projectsHome(principal, url, res);
    if (req.method === 'GET' && url.pathname === '/projects') return redirect(res, '/');
    if (req.method === 'GET' && url.pathname === '/connect') {
      return page(res, 200, connectPage(await pageContext(principal)));
    }

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
