/**
 * Building the MCP server: every handler registered through one `wrap()`.
 *
 * wrap() is the enforcement point. For a call it, in order:
 *
 *   1. resolves the caller's store (tenant-scoped);
 *   2. reserves a build action if the tool is metered — before anything runs,
 *      so concurrent calls cannot both slip under the cap;
 *   3. loads the project and its run state from the store (never from memory)
 *      and runs the guard;
 *   4. runs the handler — inside a job if the tool is slow — applies and
 *      persists its events, and rebuilds the context from the *new* state;
 *   5. releases the reservation if the outcome was a refusal or an error, so
 *      the user only ever pays for work that passed;
 *   6. scrubs every known secret value out of the payload;
 *   7. writes the ledger row.
 *
 * Because the context is rebuilt after the events, `next_action` in a response
 * always describes the world the call left behind, not the one it found.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { StateError, apply, type RunState } from '@power/runstate';
import { buildContext, guard, lookupTool, ok, refuse, TOOLS, type ContextBlock, type PowerResponse } from '@power/protocol';
import type { Principal } from './auth.js';
import { DbError, type DbDriver } from './db.js';
import { TOOL_DEFS, ToolError, type HandlerCtx } from './handlers.js';
import type { Deployer } from './deploy.js';
import type { Runtime } from './runtime.js';
import type { Jobs } from './jobs.js';
import type { Meter } from './metering.js';
import { SERVER_INSTRUCTIONS } from './prompts.js';
import { toErrorResult, toResult } from './respond.js';
import { SandboxError, type Sandbox } from './sandbox.js';
import { scrubDeep, type SecretStore } from './secrets.js';
import { NotFound, type Store } from './store.js';

export interface Deps {
  deployer: Deployer;
  runtime: Runtime;
  storeFor: (userId: string) => Store;
  sandbox: Sandbox;
  db: DbDriver;
  secrets: SecretStore;
  jobs: Jobs;
  meter: Meter;
  baseUrl: string;
  previewBaseUrl: string;
  /** The account's Power Up setting, for runs that do not choose. */
  powerUpDefault: (userId: string) => Promise<boolean>;
  /** The newest project started in the browser that no assistant has picked up yet. */
  pendingHandoff?: (userId: string) => Promise<{ project_id: string; name: string; brief: string } | null>;
  /** A tool call touched this project: how the hand-off page knows the assistant picked it up. */
  onProjectCall?: (userId: string, projectId: string) => void;
}

/** How long a slow tool waits before handing back a job id. */
const JOB_WAIT_MS = 20_000;

/** Every handler must be a tool the registry knows. Checked once, at startup. */
export function assertRegistryCoverage(): void {
  const handlers = Object.keys(TOOL_DEFS);
  const registry = TOOLS.map((t) => t.name);

  const unknown = handlers.filter((name) => !lookupTool(name));
  if (unknown.length) throw new Error(`handlers with no registry entry: ${unknown.join(', ')}`);

  // The other direction, which used to go unchecked. A registry entry with no
  // handler is advertised in tools/list and fails when a model calls it, and
  // it is how the published count drifted to ten above what was served.
  const unimplemented = registry.filter((name) => !(name in TOOL_DEFS));
  if (unimplemented.length) throw new Error(`registry entries with no handler: ${unimplemented.join(', ')}`);
}

export function createMcpServer(deps: Deps, principal: Principal): McpServer {
  const server = new McpServer({ name: 'power', version: '0.1.0' }, { instructions: SERVER_INSTRUCTIONS });

  for (const [name, def] of Object.entries(TOOL_DEFS)) {
    const spec = lookupTool(name)!;
    server.registerTool(
      name,
      {
        title: spec.title,
        // The phase is part of the description because a model otherwise
        // discovers legality only by being refused, and a refusal costs a turn.
        description: `${spec.summary}${spec.metered ? '' : ' Free.'}`,
        inputSchema: def.schema,
        // Declared on the spec, not inferred from billing. A client uses these
        // to decide what to confirm with a person.
        annotations: {
          readOnlyHint: spec.read_only,
          destructiveHint: spec.destructive,
          idempotentHint: spec.idempotent,
          openWorldHint: spec.open_world,
        },
      },
      async (args, extra): Promise<CallToolResult> =>
        wrap(name, args as Record<string, unknown>, deps, principal, String(extra.requestId)),
    );
  }

  return server;
}

type Outcome = { kind: 'ok'; result: CallToolResult } | { kind: 'refused'; result: CallToolResult } | { kind: 'error'; result: CallToolResult };

async function wrap(
  name: string,
  args: Record<string, unknown>,
  deps: Deps,
  principal: Principal,
  requestId: string,
): Promise<CallToolResult> {
  const startedAt = Date.now();
  const spec = lookupTool(name)!;
  const store = deps.storeFor(principal.user_id);
  const projectId = typeof args.project_id === 'string' ? args.project_id : null;

  // ---- 2. Reserve before running. A refusal here is not an error: nothing is broken.
  if (spec.metered) {
    const reservation = await deps.meter.reserve(principal.user_id);
    if (!reservation.granted) {
      const ex = reservation.exhausted!;
      const context = projectId ? await safeContext(store, projectId) : undefined;
      const message =
        `You've used today's ${ex.limit} build actions on the ${principal.plan} plan` +
        (ex.window === 'week' ? ' (weekly pool)' : '') +
        `. Reads are still free. Resets ${ex.resets_at}. Tell the user; do not keep retrying.`;
      const result = context
        ? toResult(refuse('quota_exhausted', message, context))
        : toResult({ ok: false, reason: 'quota_exhausted', failures: [], message, billed: false } as never);
      await deps.meter.record({ at: new Date().toISOString(), request_id: requestId, user_id: principal.user_id, project_id: projectId, tool: name, outcome: 'refused', billable: false, duration_ms: Date.now() - startedAt });
      return result;
    }
  }

  const outcome = await execute(name, args, deps, store, principal);

  // ---- 5. Only successful, metered work is paid for.
  const billable = spec.metered && outcome.kind === 'ok';
  if (spec.metered && !billable) await deps.meter.release(principal.user_id);

  // ---- 5b. A job that outlived the client's wait was reported as a refusal
  // and had its reservation released, so its work was never billed. It is
  // billed once, here, when the model collects it.
  let lateBill: { tool: string; projectId: string | null } | null = null;
  if (name === 'get_job' && outcome.kind === 'ok') {
    lateBill = deps.jobs.claimBill(String(args.job_id), principal.user_id);
    if (lateBill && lookupTool(lateBill.tool)?.metered) {
      // Already done, so quota being exhausted cannot un-spend it. Reserve to
      // keep the count honest and let the next call be the one that refuses.
      await deps.meter.reserve(principal.user_id);
      await deps.meter.record({
        at: new Date().toISOString(),
        request_id: requestId,
        user_id: principal.user_id,
        project_id: lateBill.projectId,
        tool: lateBill.tool,
        outcome: 'ok',
        billable: true,
        duration_ms: Date.now() - startedAt,
      });
    }
  }

  // ---- 6. Nothing leaves with a secret in it.
  //
  // get_job hands back another tool's result, and it is that tool's project
  // whose secrets have to be scrubbed. The poll carries no project_id of its
  // own, which is why a run_tests slow enough to become a job used to return
  // its output unredacted -- the fast path was scrubbed and the slow one was not.
  let result = outcome.result;
  const scrubFor = projectId ?? (name === 'get_job' ? deps.jobs.projectOf(String(args.job_id), principal.user_id) : null);
  if (scrubFor) {
    const values = await deps.secrets.allValues(scrubFor);
    if (values.length) result = scrubDeep(result, values);
  }

  // ---- 7. The record of what happened.
  await deps.meter.record({
    at: new Date().toISOString(),
    request_id: requestId,
    user_id: principal.user_id,
    project_id: projectId,
    tool: name,
    outcome: outcome.kind === 'ok' ? 'ok' : outcome.kind === 'refused' ? 'refused' : 'error',
    billable,
    duration_ms: Date.now() - startedAt,
  });
  return result;
}

async function safeContext(store: Store, projectId: string): Promise<ContextBlock | undefined> {
  try {
    const state = await store.getRun(projectId);
    return buildContext({ projectId, state, lastErrors: await store.getGateErrors(projectId) });
  } catch {
    return undefined;
  }
}

async function execute(name: string, args: Record<string, unknown>, deps: Deps, store: Store, principal: Principal): Promise<Outcome> {
  const spec = lookupTool(name)!;
  const def = TOOL_DEFS[name]!;
  const env = spec.live_capable ? 'live' : 'workbench';
  let context: ContextBlock | undefined;

  try {
    const ctx: HandlerCtx = {
      store,
      sandbox: deps.sandbox,
      deployer: deps.deployer,
      runtime: deps.runtime,
      db: deps.db,
      secrets: deps.secrets,
      jobs: deps.jobs,
      meter: deps.meter,
      userId: principal.user_id,
      baseUrl: deps.baseUrl,
      previewBaseUrl: deps.previewBaseUrl,
      powerUpDefault: () => deps.powerUpDefault(principal.user_id),
      ...(deps.pendingHandoff ? { pendingHandoff: () => deps.pendingHandoff!(principal.user_id) } : {}),
      project: null,
      state: null,
      approvals: null,
    };

    // Orientation tools take a project when they have one and answer without
    // it when they do not, so a model that has just connected can ask where it
    // is without that being an error.
    const wantsProject = def.needsProject || (def.optionalProject === true && Boolean(args.project_id));
    if (wantsProject) {
      const id = String(args.project_id ?? '');
      ctx.project = await store.getProject(id);
      if (!ctx.project) {
        return { kind: 'error', result: toErrorResult(`no project with id "${id}". Call list_projects or create_project.`) };
      }
      ctx.state = await store.getRun(id);
      ctx.approvals = await store.getApprovals(id);
      deps.onProjectCall?.(principal.user_id, id);
      context = buildContext({ projectId: id, state: ctx.state, env, lastErrors: await store.getGateErrors(id) });

      // Which human decision does this live-affecting tool need?
      //
      // publish and rollback spend the publish confirmation. A migration
      // carries its own, and promote_migration's handler decides whether an
      // additive change needs one at all. unpublish has its own too, because
      // it means the opposite of publishing and a confirmation to publish must
      // never be spendable on taking the app offline. It used to be handed a
      // literal true, so the one tool that takes someone's live app down was
      // the only live-capable tool needing nobody's consent.
      const humanConfirmed =
        name === 'promote_migration'
          ? true
          : name === 'unpublish_app'
            ? Boolean(ctx.approvals.unpublish_confirmed_at)
            : Boolean(ctx.approvals.publish_confirmed_at);

      const verdict = guard({ toolName: name, state: ctx.state, context, targetEnv: env, humanConfirmed });
      if (!verdict.allowed) return { kind: 'refused', result: toResult(verdict.refusal) };
    }

    // ---- 4. Run, inside a job when the tool can outlive a client's patience.
    const work = async (): Promise<Outcome> => {
      const result = await def.handler(args, ctx);
      const project = result.project ?? ctx.project;

      if (!project) {
        const payload = { ok: true, data: result.data ?? {}, billed: spec.metered, ...(result.guidance ? { guidance: result.guidance } : {}) };
        return { kind: 'ok', result: toResult(payload as never) };
      }

      // Reload rather than reuse ctx.state: a handler may have replaced the run
      // (start_run does), and on a stateless node the store is the only truth.
      let state: RunState = await store.getRun(project.id);
      if (result.events?.length) {
        for (const event of result.events) state = apply(state, event);
        await store.putRun(project.id, state);
      }
      const fresh = buildContext({ projectId: project.id, state, env, lastErrors: await store.getGateErrors(project.id) });

      if (result.refusal) {
        const { reason, message, gate, failures } = result.refusal;
        const options = { ...(gate ? { gate } : {}), ...(failures ? { failures } : {}), ...(result.guidance ? { guidance: result.guidance } : {}) };
        // If applying the events exhausted a retry edge, the honest answer is
        // not "fix this" but "stop". Say so, or the model will try a fourth time.
        const response: PowerResponse<unknown> =
          state.phase === 'blocked'
            ? refuse('run_blocked', `${message} The run has now stopped: ${state.blocked_reason}. Do not retry — tell the user, and ask how they want to proceed.`, fresh, options)
            : refuse(reason, message, fresh, options);
        return { kind: 'refused', result: toResult(response) };
      }

      return { kind: 'ok', result: toResult(ok(result.data ?? {}, fresh, { billed: spec.metered, ...(result.guidance ? { guidance: result.guidance } : {}) })) };
    };

    if (!spec.async) return await work();

    const job = await deps.jobs.run(name, work, JOB_WAIT_MS, {
      userId: principal.user_id,
      projectId: ctx.project?.id ?? (typeof args.project_id === 'string' ? args.project_id : null),
    });
    if (job.settled) {
      if (job.job.status === 'failed') throw new ToolError(job.job.error ?? 'job failed');
      return job.job.result as Outcome;
    }
    // Still running. The handle is a successful, unbilled response; the real
    // outcome — and its bill — is recorded when the model polls get_job.
    return { kind: 'refused', result: toResult(ok({ ...job.handle, note: `Still running after ${JOB_WAIT_MS / 1000}s. Poll get_job({ job_id }) — it is free.` }, context!)) };
  } catch (error) {
    if (error instanceof ToolError || error instanceof SandboxError || error instanceof DbError || error instanceof NotFound || error instanceof StateError) {
      return { kind: 'error', result: toErrorResult(error.message, context) };
    }
    console.error(`[power] ${name} failed`, error);
    return { kind: 'error', result: toErrorResult(`${name} failed unexpectedly: ${(error as Error).message}`, context) };
  }
}
