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
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { apply, canPublish, phaseLabel } from '@power/runstate';
import { Redis } from 'ioredis';
import { authenticatorFromEnv, type Principal } from './auth.js';
import { PgliteDriver } from './db.js';
import { Jobs } from './jobs.js';
import { FileLedger, MemoryQuota, Meter, RedisQuota, type QuotaStore } from './metering.js';
import { openPgliteControlPlane } from './pgstore.js';
import { LocalSandbox } from './sandbox.js';
import { MemorySecrets } from './secrets.js';
import { assertRegistryCoverage, createMcpServer, type Deps } from './server.js';

const PORT = Number(process.env.PORT ?? 4321);
const ROOT = resolve(process.env.POWER_LOCAL_ROOT ?? '.power-local');
const BASE_URL = process.env.POWER_BASE_URL ?? `http://localhost:${PORT}`;

assertRegistryCoverage();

const controlPlane = await openPgliteControlPlane(join(ROOT, 'control-plane'));
const auth = authenticatorFromEnv(process.env);
const quota: QuotaStore = process.env.REDIS_URL ? new RedisQuota(new Redis(process.env.REDIS_URL)) : new MemoryQuota();
const meter = new Meter(quota, new FileLedger(join(ROOT, 'ledger.jsonl')), (u) => controlPlane.planOf(u));
const secrets = new MemorySecrets();
const sandbox = new LocalSandbox(ROOT);
const db = new PgliteDriver(ROOT);
const deps: Deps = { storeFor: (u) => controlPlane.storeFor(u), sandbox, db, secrets, jobs: new Jobs(), meter, baseUrl: BASE_URL };

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

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return new URLSearchParams(raw);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// ---------------------------------------------------------------- MCP

async function handleMcp(req: IncomingMessage, res: ServerResponse, principal: Principal): Promise<void> {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
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

  let action = '';
  if (state.phase === 'spec_approval') {
    action = `<h2>Your assistant wrote a plan and needs your approval</h2>
<p><a href="/projects/${id}/spec">Read the plan</a> before deciding. Approval is a decision about <em>what</em> gets built; the structure has already been checked by code.</p>
<form method="post" action="/projects/${id}/approve-spec"><button class="primary">Approve the plan</button></form>
<form method="post" action="/projects/${id}/reject-spec"><input type="text" name="reason" placeholder="What should change?" required style="max-width:280px;display:inline-block"> <button>Send it back</button></form>`;
  } else if (state.phase === 'verify' && publish.allowed) {
    action = approvals.publish_confirmed_at
      ? `<h2>Ready to publish</h2><p>You've confirmed. Ask your assistant to call <code>publish_app</code>.</p>`
      : `<h2>Verified. Publish it?</h2>
<p>Every P0 requirement was verified by interaction and the checks are green. This will make <strong>${esc(project.name)}</strong> live.</p>
<form method="post" action="/projects/${id}/confirm-publish"><button class="primary">Confirm publish</button></form>`;
  } else if (state.phase === 'blocked') {
    action = `<h2>The run stopped and needs you</h2><p>${esc(state.blocked_reason ?? '')}</p><p class="muted">Ask your assistant to restore an earlier checkpoint, or tell it how to proceed. Nothing has been published.</p>`;
  } else if (state.phase === 'done') {
    action = `<h2>Live</h2><p>Version <code>${live.version}</code> at <code>${esc(live.live_path ?? '')}</code></p>`;
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
${approvals.migration_confirmed_at ? '<p>✓ Confirmed. Ask your assistant to call <code>promote_migration</code>.</p>' : `<form method="post" action="/projects/${id}/confirm-migration"><input type="text" name="confirm" placeholder="Type ${esc(project.slug)} to confirm" autocomplete="off" required style="max-width:280px;display:inline-block"> <button class="danger">Apply to live app</button></form>`}
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

// ---------------------------------------------------------------- routing

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', BASE_URL);
  try {
    if (url.pathname === '/health') return text(res, 200, 'ok');

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
    if (!principal) {
      res.setHeader('www-authenticate', 'Bearer realm="power"');
      return text(res, 401, 'unauthorised');
    }
    await controlPlane.ensureUser(principal.user_id, principal.plan);

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
    const state = await store.getRun(id);
    const approvals = await store.getApprovals(id);
    const now = new Date().toISOString();

    if (sub === 'approve-spec') {
      await store.putRun(id, apply(state, { type: 'spec_approved' }));
      await store.putApprovals(id, { ...approvals, spec_approved_at: now });
      return redirect(res, `/projects/${id}`);
    }
    if (sub === 'reject-spec') {
      const reason = (await readForm(req)).get('reason') ?? 'rejected by the user';
      await store.putRun(id, apply(state, { type: 'spec_rejected', reason }));
      return redirect(res, `/projects/${id}`);
    }
    if (sub === 'confirm-publish') {
      if (!canPublish(state).allowed) return text(res, 409, 'not ready to publish');
      await store.putApprovals(id, { ...approvals, publish_confirmed_at: now });
      return redirect(res, `/projects/${id}`);
    }
    if (sub === 'confirm-migration') {
      // Typed confirmation: the project slug, exactly. A button is too easy to click.
      const typed = (await readForm(req)).get('confirm') ?? '';
      if (typed.trim() !== project.slug) return text(res, 400, `type "${project.slug}" exactly to confirm`);
      await store.putApprovals(id, { ...approvals, migration_confirmed_at: now });
      return redirect(res, `/projects/${id}`);
    }
    return text(res, 404, 'not found');
  } catch (error) {
    console.error('[power] request failed', error);
    if (!res.headersSent) text(res, 500, (error as Error).message);
  }
});

server.listen(PORT, () => {
  console.log(`power  mcp:   ${BASE_URL}/mcp`);
  console.log(`power  web:   ${BASE_URL}/`);
  console.log(`power  data:  ${ROOT}`);
  console.log(`power  auth:  ${process.env.POWER_TOKENS ? 'bearer tokens' : 'dev (no tokens configured)'}`);
  console.log(`power  quota: ${process.env.REDIS_URL ? 'redis' : 'in-memory'}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    void Promise.all([db.close(), controlPlane.close()]).finally(() => process.exit(0));
  });
}
