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
import { readFile } from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { apply, canPublish, phaseLabel } from '@power/runstate';
import { Redis } from 'ioredis';
import { authenticatorFromEnv, type Principal } from './auth.js';
import { PgliteDriver } from './db.js';
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
const db = new PgliteDriver(ROOT);
// Explicit, never a fallback: a publish that silently went nowhere real is
// the failure this whole path exists to remove.
const deployer =
  process.env.POWER_DEPLOYER === 'local' ? new LocalDeployer(join(ROOT, 'previews'), BASE_URL) : new VercelDeployer();

const deps: Deps = { deployer, runtime, storeFor: (u) => controlPlane.storeFor(u), sandbox, db, secrets, jobs: new Jobs(), meter, baseUrl: BASE_URL, previewBaseUrl: PREVIEW_BASE_URL };

// ---------------------------------------------------------------- helpers

function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Power</title>
<style>body{font:16px/1.5 system-ui;max-width:720px;margin:3rem auto;padding:0 1rem;color:#1a1a1a}
h1{font-size:1.4rem}h2{font-size:1.15rem;margin-top:2rem}code,pre{background:#f4f4f4;padding:.15em .35em;border-radius:4px}pre{padding:1rem;overflow:auto;white-space:pre-wrap}
button{font:inherit;padding:.5rem 1rem;border-radius:6px;border:1px solid #888;background:#fff;cursor:pointer;margin-right:.5rem}
button.primary{background:#111;color:#fff;border-color:#111}button.danger{background:#b00020;color:#fff;border-color:#b00020}
.muted{color:#666}.pill{display:inline-block;padding:.1em .6em;border-radius:999px;background:#eef;font-size:.9em;margin-right:.3em}
.warn{background:#fff4e5;border-left:4px solid #f0a020;padding:.75rem 1rem;margin:1rem 0}
form{display:inline}input[type=text],input[type=password]{font:inherit;padding:.4rem .6rem;border:1px solid #aaa;border-radius:6px;width:100%;max-width:420px;box-sizing:border-box}
ul.plain{list-style:none;padding:0}</style>${body}`);
}

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

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

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

async function projectPage(principal: Principal, id: string, res: ServerResponse): Promise<void> {
  const store = controlPlane.storeFor(principal.user_id);
  const project = await store.getProject(id);
  if (!project) return html(res, 404, '<h1>No such project</h1>');
  const state = await store.getRun(id);
  const approvals = await store.getApprovals(id);
  const artifacts = await store.getArtifacts(id);
  const publish = canPublish(state);
  const live = await sandbox.publishStatus(id);
  const secretList = await secrets.list(id);
  const migration = artifacts['migration.json'] ? (JSON.parse(artifacts['migration.json']) as { proposal: { intent: string }; verdict: { pass: boolean; destructive: boolean; summary: string[] }; promoted_at?: string }) : null;

  const gates = Object.entries(state.gates).map(([k, v]) => `<span class="pill">${k}: ${v}</span>`).join('');

  // Every form below authorises something an assistant is not allowed to do
  // for itself, so each one carries proof that it came from a page Power
  // rendered for this person.
  const csrf = csrfField(mintCsrf(SECRET_KEY, principal.user_id, id));

  let action = '';
  if (state.phase === 'spec_approval') {
    action = `<h2>Your assistant wrote a plan and needs your approval</h2>
<p><a href="/projects/${id}/spec">Read the plan</a> before deciding. Approval is a decision about <em>what</em> gets built; the structure has already been checked by code.</p>
<form method="post" action="/projects/${id}/approve-spec">${csrf}<button class="primary">Approve the plan</button></form>
<form method="post" action="/projects/${id}/reject-spec">${csrf}<input type="text" name="reason" placeholder="What should change?" required style="max-width:280px;display:inline-block"> <button>Send it back</button></form>`;
  } else if (state.phase === 'verify' && publish.allowed) {
    action = approvals.publish_confirmed_at
      ? `<h2>Ready to publish</h2><p>You've confirmed. Ask your assistant to call <code>publish_app</code>.</p>`
      : `<h2>Verified. Publish it?</h2>
<p>Every P0 requirement was verified by interaction and the checks are green. This will make <strong>${esc(project.name)}</strong> live.</p>
<form method="post" action="/projects/${id}/confirm-publish">${csrf}<button class="primary">Confirm publish</button></form>`;
  } else if (state.phase === 'blocked') {
    action = `<h2>The run stopped and needs you</h2><p>${esc(state.blocked_reason ?? '')}</p><p class="muted">Ask your assistant to restore an earlier checkpoint, or tell it how to proceed. Nothing has been published.</p>`;
  } else if (state.phase === 'done') {
    action =
      `<h2>Live</h2><p>Version <code>${live.version}</code> at <code>${esc(live.live_path ?? '')}</code></p>` +
      (approvals.unpublish_confirmed_at
        ? `<p>✓ Confirmed. Ask your assistant to call <code>unpublish_app</code>.</p>`
        : `<details><summary class="muted">Take it offline</summary>
<p class="muted">This removes the deployment. The hosting project and any domains stay in your own account, and the code and its history are untouched.</p>
<form method="post" action="/projects/${id}/confirm-unpublish">${csrf}<input type="text" name="confirm" placeholder="Type ${esc(project.slug)} to confirm" autocomplete="off" required style="max-width:280px;display:inline-block"> <button class="danger">Take ${esc(project.name)} offline</button></form></details>`);
  } else {
    action = `<p class="muted">Nothing needs you right now. Your assistant is working: <strong>${phaseLabel(state.phase)}</strong>.</p>`;
  }

  let migrationBlock = '';
  if (migration && migration.verdict.pass && !migration.promoted_at) {
    const lines = migration.verdict.summary.map((s) => `<li>${esc(s)}</li>`).join('');
    migrationBlock = migration.verdict.destructive
      ? `<h2>A data change needs your confirmation</h2>
<div class="warn"><strong>${esc(migration.proposal.intent)}</strong><ul>${lines}</ul>
<p>This change can lose data. It will only reach your live app if you type <code>${esc(project.slug)}</code> below. Your assistant cannot do this for you.</p>
${approvals.migration_confirmed_at ? '<p>✓ Confirmed. Ask your assistant to call <code>promote_migration</code>.</p>' : `<form method="post" action="/projects/${id}/confirm-migration">${csrf}<input type="text" name="confirm" placeholder="Type ${esc(project.slug)} to confirm" autocomplete="off" required style="max-width:280px;display:inline-block"> <button class="danger">Apply to live app</button></form>`}
</div>`
      : `<h2>A data change is ready</h2><p><strong>${esc(migration.proposal.intent)}</strong></p><ul>${lines}</ul><p class="muted">Nothing existing is removed. It reaches the live app when your assistant calls <code>promote_migration</code> during verification.</p>`;
  }

  html(
    res,
    200,
    `<h1>${esc(project.name)} <span class="muted">· ${phaseLabel(state.phase)}</span></h1>
<p>${gates} · retries left: fixes ${2 - state.loops.needs_fixes}, plan ${2 - state.loops.spec_revision}</p>
${action}${migrationBlock}
<h2 class="muted">Details</h2>
<p class="muted">Project <code>${id}</code> · ${artifacts['SPEC.md'] ? `<a href="/projects/${id}/spec">SPEC.md</a>` : 'no plan yet'} · secrets: ${secretList.length ? secretList.map((s) => `<code>${esc(s.name)}</code> <span class="muted">(${s.env})</span>`).join(', ') : 'none'} · <a href="/">all projects</a></p>
<details><summary class="muted">Run history</summary><pre>${esc(JSON.stringify(state.history, null, 2))}</pre></details>`,
  );
}

async function secretPage(token: string, res: ServerResponse, error?: string): Promise<void> {
  const pending = await secrets.pending(token);
  if (!pending) return html(res, 404, '<h1>This link has expired or was already used</h1><p class="muted">Ask your assistant to request the secret again.</p>');
  html(
    res,
    error ? 400 : 200,
    `<h1>Add a secret</h1>
<p>Your assistant needs <code>${esc(pending.name)}</code>${pending.provider ? ` for <strong>${esc(pending.provider)}</strong>` : ''}, for the <strong>${esc(pending.env)}</strong> environment.</p>
<p class="muted">${esc(pending.why)}</p>
${error ? `<p class="warn">${esc(error)}</p>` : ''}
<form method="post" action="/secrets/${esc(token)}" style="display:block">
<p><input type="password" name="value" placeholder="Paste the value" autocomplete="off" required autofocus></p>
<p><button class="primary">Save</button></p></form>
<p class="muted">The value is stored on the server and injected into your app's environment. It is never shown to the assistant; it only learns the name <code>${esc(pending.name)}</code>.</p>`,
  );
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
        return html(res, 200, `<h1>Saved</h1><p><code>${esc(record.name)}</code> is set for <strong>${esc(record.env)}</strong> (fingerprint <code>${record.fingerprint}</code>). You can close this tab and tell your assistant to continue.</p>`);
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
        return html(
          res,
          503,
          `<h1>Not running</h1><p class="muted">This project's preview is not up. Ask the assistant to call <code>get_preview_url</code>.</p>`,
        );
      }
      return proxyTo(req, res, port, (livePreview[2] ?? '/') + url.search);
    }

    if (url.pathname === '/mcp') return await handleMcp(req, res, principal);

    if (url.pathname === '/') {
      const projects = await controlPlane.storeFor(principal.user_id).listProjects();
      const q = await meter.remaining(principal.user_id);
      return html(
        res,
        200,
        `<h1>Power</h1><p class="muted">MCP endpoint: <code>${BASE_URL}/mcp</code> · signed in as <code>${esc(principal.user_id)}</code> (${q.plan}) · ${q.day} build actions left today</p>` +
          (projects.length
            ? `<ul class="plain">${projects.map((p) => `<li><a href="/projects/${p.id}">${esc(p.name)}</a></li>`).join('')}</ul>`
            : '<p>No projects yet. Ask your assistant to create one.</p>'),
      );
    }

    const match = /^\/projects\/([a-z0-9]+)(?:\/([a-z-]+))?$/.exec(url.pathname);
    if (!match) return text(res, 404, 'not found');
    const [, id = '', sub] = match;
    const store = controlPlane.storeFor(principal.user_id);
    const project = await store.getProject(id);
    if (!project) return text(res, 404, 'no such project');

    if (req.method === 'GET' && !sub) return await projectPage(principal, id, res);
    if (req.method === 'GET' && sub === 'spec') {
      const artifacts = await store.getArtifacts(id);
      return text(res, 200, artifacts['SPEC.md'] ?? 'No plan has been submitted yet.', 'text/markdown');
    }

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
