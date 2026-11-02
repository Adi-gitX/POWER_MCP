/**
 * Tool handlers.
 *
 * A handler does one thing and returns what happened: data, the state events it
 * implies, and optionally a refusal. It never touches the run state directly,
 * never decides whether it was allowed to run, never meters itself, and never
 * builds the context block. All of that is `wrap()` in server.ts, which is how
 * "every tool runs behind the guard and the meter" stays true as handlers are
 * added.
 */
import { randomBytes } from 'node:crypto';
import { analyseMigration, runGate, type GateError, type MigrationProposal, type MigrationVerdict, type Stage } from '@power/gates';
import type { RefusalReason } from '@power/protocol';
import { nextAction, roleForPhase } from '@power/protocol';
import { apply, createRunState, type RunEvent, type RunState } from '@power/runstate';
import { z } from 'zod';
import type { DbDriver } from './db.js';
import { collectRelease, DeployError, deployProjectName, type DeployCredential, type Deployer } from './deploy.js';
import type { Jobs } from './jobs.js';
import type { Runtime } from './runtime.js';
import type { Meter } from './metering.js';
import { ROLE_BRIEFS, specTemplate, type Role } from './prompts.js';
import type { Sandbox } from './sandbox.js';
import { validEnvName, type SecretStore } from './secrets.js';
import type { Approvals, Project, Store } from './store.js';

export interface HandlerCtx {
  store: Store;
  sandbox: Sandbox;
  deployer: Deployer;
  runtime: Runtime;
  db: DbDriver;
  secrets: SecretStore;
  jobs: Jobs;
  meter: Meter;
  userId: string;
  baseUrl: string;
  /**
   * Where previews are served, which must not be where Power's own pages are.
   *
   * A preview is an application an assistant wrote. Served from Power's origin
   * it is same-origin with the pages that hold the approve and confirm forms,
   * and same-origin script can read a CSRF token straight out of Power's HTML.
   * No token or header check can fix that; only a different origin can.
   */
  previewBaseUrl: string;
  project: Project | null;
  state: RunState | null;
  approvals: Approvals | null;
}

export interface HandlerResult {
  data?: unknown;
  /** State events this call implies. Applied and persisted by wrap(), in order. */
  events?: RunEvent[];
  /** A role brief or template for the next step. */
  guidance?: string;
  /** Turn the result into a refusal. Events are still applied first. */
  refusal?: { reason: RefusalReason; message: string; gate?: Stage; failures?: GateError[] };
  /** Set by create_project so wrap() can build context for a project that did not exist on entry. */
  project?: Project;
}

type Args = Record<string, unknown>;
type Handler = (args: Args, ctx: HandlerCtx) => Promise<HandlerResult>;

export interface ToolDef {
  schema: z.ZodRawShape;
  handler: Handler;
  /** Does the tool act on a project? If so, wrap() loads it and runs the guard. */
  needsProject: boolean;
  /** Load the project when one is given, but do not require it. */
  optionalProject?: boolean;
}

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

const projectId = z.string().describe('The project id returned by create_project.');
const path = z.string().describe('Path relative to the project root.');

/** How many rows query_database will ever return. Small on purpose: the workbench
 * holds a copy of real data, and the model does not need to see all of it. */
const QUERY_ROW_CAP = 100;

function need(ctx: HandlerCtx): { project: Project; state: RunState; approvals: Approvals } {
  if (!ctx.project || !ctx.state || !ctx.approvals) throw new ToolError('this tool needs a project');
  return { project: ctx.project, state: ctx.state, approvals: ctx.approvals };
}

/**
 * The answer when there is no project yet. A successful result, not an error:
 * a model that has just connected has done nothing wrong by asking where it
 * is, and it needs to be told rather than corrected.
 */
async function startHere(ctx: HandlerCtx): Promise<{ data: Record<string, unknown>; guidance?: string }> {
  const projects = await ctx.store.listProjects();
  return {
    data: {
      projects,
      next_action: projects.length
        ? { tool: 'get_context', args: { project_id: projects[0]!.id }, why: 'Open an existing project.' }
        : { tool: 'create_project', args: {}, why: 'No project exists yet. Create one to start a run.' },
      message: projects.length
        ? `No project id was given. This account has ${projects.length} project(s); pass one as project_id.`
        : 'No project id was given, and this account has no projects yet. Call create_project to start one.',
    },
  };
}

/** What is currently live, from the deployment record rather than a directory. */
async function liveSummary(ctx: HandlerCtx, projectId: string): Promise<{ version: string | null; url: string | null }> {
  const live = await ctx.store.latestDeployment(projectId, 'production');
  if (!live || live.ready_state !== 'READY') return { version: null, url: null };
  return { version: live.version, url: `https://${live.url}` };
}

/** The name of the account credential a publish needs. */
const DEPLOY_TOKEN = 'POWER_DEPLOY_TOKEN';
const DEPLOY_BUDGET_MS = 240_000;

async function deployCredential(ctx: HandlerCtx): Promise<DeployCredential | null> {
  if (!ctx.deployer.requiresCredential) return { token: '', teamId: null };
  const token = await ctx.secrets.accountValue(ctx.userId, DEPLOY_TOKEN);
  if (!token) return null;
  return { token, teamId: (await ctx.secrets.accountValue(ctx.userId, 'POWER_DEPLOY_TEAM_ID')) ?? null };
}

/**
 * No credential yet: a refusal, not an error.
 *
 * Nothing is broken — the person simply has not connected a hosting account.
 * The confirmation they already gave is deliberately left intact, so the
 * retry after they paste the token does not need a second approval.
 */
async function askForDeployToken(ctx: HandlerCtx, project: Project): Promise<HandlerResult> {
  const pending = await ctx.secrets.request({
    user_id: ctx.userId,
    project_id: null,
    name: DEPLOY_TOKEN,
    env: 'live',
    provider: 'hosting',
    why: 'Power publishes to your own hosting account, so you own the app and the domain.',
  });
  return {
    refusal: {
      reason: 'needs_user_input',
      message:
        `Publishing deploys to the user's own hosting account, and there is no token for it yet. ` +
        `Ask them to open ${ctx.baseUrl}/secrets/${pending.token} and paste a hosting access token there. ` +
        `Do not ask for the token in this conversation, and do not call publish_app again until they say it is saved. ` +
        `It is stored once and reused for every project.`,
    },
  };
}

/** Turn a provider failure into something the model can act on. */
function deployRefusal(error: unknown, logs: string[] = []): HandlerResult {
  if (!(error instanceof DeployError)) throw error;
  const tail = logs.length ? `\n\nBuild output:\n${logs.join('\n')}` : '';
  return {
    refusal: {
      reason: error.kind === 'auth' ? 'needs_user_input' : 'unsafe_for_live',
      message:
        error.transient
          ? `${error.message} This is temporary; wait and try again.${tail}`
          : `${error.message} This will not fix itself; change something before retrying.${tail}`,
    },
  };
}

function approvalUrl(ctx: HandlerCtx, project: Project): string {
  return `${ctx.baseUrl}/projects/${project.id}`;
}

function briefFor(state: RunState): string | undefined {
  const role = roleForPhase(state) as Role | null;
  return role && role in ROLE_BRIEFS ? ROLE_BRIEFS[role] : undefined;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'app'
  );
}

/** Code changed, so a previous green is stale. Only meaningful during build. */
function staleGreen(state: RunState): RunEvent[] {
  return state.self_verify_green ? [{ type: 'self_verify', green: false }] : [];
}

/** Secrets scoped to the workbench, injected into every command the sandbox runs. */
/**
 * The environment a project's own process runs with.
 *
 * The user's secrets for that environment, plus the two variables that join the
 * app to the platform: a connection string for the right branch and which
 * environment this is. Without them a generated app is an ordinary Postgres
 * application with no Postgres to talk to, which is exactly what it was -- the
 * preview served its page and every /api call failed.
 *
 * In the workbench the platform's values win, because the safe copy is the
 * whole point and a stray DATABASE_URL secret pointing at production would
 * defeat it. In live the user's own secret wins, because that is where their
 * real database belongs and Power's loopback URL is only useful to a publish
 * that stays on this machine.
 */
async function envFor(ctx: HandlerCtx, p: Project, env: 'workbench' | 'live'): Promise<Record<string, string>> {
  const secrets = await ctx.secrets.valuesFor(p.id, env);
  const platform = {
    DATABASE_URL: await ctx.db.connectionString(p.id, env),
    POWER_ENV: env,
  };
  return env === 'workbench' ? { ...secrets, ...platform } : { ...platform, ...secrets };
}

const workbenchEnv = (ctx: HandlerCtx, p: Project) => envFor(ctx, p, 'workbench');

const project = (schema: z.ZodRawShape, handler: Handler): ToolDef => ({
  schema: { project_id: projectId, ...schema },
  handler,
  needsProject: true,
});

/**
 * Orientation tools, which have to work before a project exists.
 *
 * The server instructions tell a lost model to call `get_next_action`, but
 * both of these used to require a project_id, so the first call of a fresh
 * conversation came back as a protocol error — the one shape that makes a
 * client model apologise and stop. They now answer without one and say where
 * to start.
 */
const orient = (handler: Handler): ToolDef => ({
  schema: { project_id: projectId.optional() },
  handler,
  needsProject: false,
  optionalProject: true,
});

interface StoredMigration {
  proposal: MigrationProposal;
  verdict: MigrationVerdict;
  proposed_at: string;
  promoted_at?: string;
  snapshot?: string;
}

async function storedMigration(ctx: HandlerCtx, p: Project): Promise<StoredMigration | null> {
  const raw = (await ctx.store.getArtifacts(p.id))['migration.json'];
  return raw ? (JSON.parse(raw) as StoredMigration) : null;
}

export const TOOL_DEFS: Record<string, ToolDef> = {
  // ------------------------------------------------------------ orientation
  list_projects: {
    schema: {},
    needsProject: false,
    handler: async (_args, ctx) => ({
      data: { projects: await ctx.store.listProjects(), quota: await ctx.meter.remaining(ctx.userId) },
    }),
  },

  create_project: {
    schema: {
      name: z.string().min(1).max(80).describe('What the user is building, in a few words.'),
    },
    needsProject: false,
    handler: async (args, ctx) => {
      const name = args.name as string;
      const id = randomBytes(5).toString('hex');
      const created: Project = { id, name, slug: slugify(name), created_at: new Date().toISOString() };
      // v1 starts at the plan. Research is recorded as skipped, not passed.
      const state = apply(createRunState(`run_${id}`), { type: 'research_skipped' });
      await ctx.sandbox.create(id, created.slug);
      await ctx.store.createProject(created, state);
      return {
        project: created,
        data: {
          project_id: id,
          name,
          approval_url: approvalUrl(ctx, created),
          workbench_files: await ctx.sandbox.listFiles(id),
        },
        guidance: `${ROLE_BRIEFS.architect}\n\nA starting template for SPEC.md:\n\n${specTemplate(name)}`,
      };
    },
  },

  /**
   * The second hour. A published project takes its next piece of work as a new
   * run: fresh trace, fresh retry budget, back to the plan — against the code,
   * checkpoints, database and secrets that are already there. The previous
   * SPEC.md stays in the workbench as context for the next architect.
   */
  start_run: project(
    { goal: z.string().min(4).max(400).describe('What to build or change next, in the user\'s words.') },
    async (args, ctx) => {
      const { project: p, state: previous, approvals } = need(ctx);
      const runId = `run_${randomBytes(5).toString('hex')}`;
      const state = apply(createRunState(runId), { type: 'research_skipped' });
      await ctx.store.putRun(p.id, state);
      await ctx.store.putApprovals(p.id, {
        ...approvals,
        spec_approved_at: null,
        spec_approval_requested_at: null,
        publish_confirmed_at: null,
        migration_confirmed_at: null,
      });
      await ctx.store.putGateErrors(p.id, 'spec', []);
      await ctx.store.putGateErrors(p.id, 'verification', []);
      await ctx.sandbox.checkpoint(p.id, `New run: ${(args.goal as string).slice(0, 60)}`, {
        'Power-Run': runId,
        'Power-Phase': 'intake',
        'Power-Previous-Run': previous.trace_id,
      });
      const previousSpec = (await ctx.store.getArtifacts(p.id))['SPEC.md'];
      return {
        data: {
          run_id: runId,
          previous_run: previous.trace_id,
          goal: args.goal,
          // What is live stays live while the next run is planned and built.
          live: await liveSummary(ctx, p.id),
          note: 'The workbench, checkpoints, database and secrets carry over. Write a plan for this change only.',
        },
        guidance:
          `${ROLE_BRIEFS.architect}\n\n` +
          `This is a change to an existing app. The goal: ${args.goal}\n` +
          (previousSpec
            ? `The previous plan is below for context; write a new SPEC.md covering only what changes now, with fresh requirement ids.\n\n---- previous SPEC.md ----\n${previousSpec.slice(0, 6000)}`
            : ''),
      };
    },
  ),

  get_context: orient(async (_args, ctx) => {
    if (!ctx.project) return await startHere(ctx);
    const { project: p, state, approvals } = need(ctx);
    const guidance = briefFor(state);
    return {
      data: {
        project: p,
        gates: state.gates,
        approved_spec: state.approved_spec,
        self_verify_green: state.self_verify_green,
        spec_approval: approvals.spec_approved_at
          ? 'approved'
          : approvals.spec_approval_requested_at
            ? 'waiting for the user'
            : 'not requested',
        publish_confirmed: Boolean(approvals.publish_confirmed_at),
        database: (await ctx.db.exists(p.id)) ? 'provisioned' : 'none',
        secrets: (await ctx.secrets.list(p.id)).map((s) => `${s.name} (${s.env}, ${s.fingerprint})`),
        quota: await ctx.meter.remaining(ctx.userId),
        approval_url: approvalUrl(ctx, p),
        recent_history: state.history.slice(-5),
      },
      ...(guidance ? { guidance } : {}),
    };
  }),

  get_next_action: orient(async (_args, ctx) => {
    if (!ctx.project) return await startHere(ctx);
    const { state } = need(ctx);
    const guidance = briefFor(state);
    return {
      data: { next_action: nextAction(state) },
      ...(guidance ? { guidance } : {}),
    };
  }),

  get_project: project({}, async (_args, ctx) => {
    const { project: p } = need(ctx);
    return {
      data: {
        project: p,
        live: await ctx.sandbox.publishStatus(p.id),
        database: (await ctx.db.exists(p.id)) ? 'provisioned' : 'none',
        approval_url: approvalUrl(ctx, p),
      },
    };
  }),

  get_guides: {
    schema: {
      topic: z
        .string()
        .describe('One of: architect, implementer, verifier, spec_template. Anything else lists the options.'),
    },
    needsProject: false,
    handler: async (args) => {
      const topic = args.topic as string;
      if (topic in ROLE_BRIEFS) return { data: { topic }, guidance: ROLE_BRIEFS[topic as Role] };
      if (topic === 'spec_template') return { data: { topic }, guidance: specTemplate('<product>') };
      return { data: { available: [...Object.keys(ROLE_BRIEFS), 'spec_template'] } };
    },
  },

  get_job: {
    schema: { job_id: z.string() },
    needsProject: false,
    handler: async (args, ctx) => {
      // Scoped to the caller: one registry serves every principal, so without
      // the user id a leaked or guessed job id returned another tenant's tool
      // output. An unknown id and someone else's are the same answer here.
      const job = ctx.jobs.get(args.job_id as string, ctx.userId);
      if (!job) throw new ToolError(`no job ${args.job_id}. Jobs are kept for 30 minutes.`);
      return { data: job };
    },
  },

  // ------------------------------------------------------------ reading (free)
  list_files: project({ dir: z.string().optional() }, async (args, ctx) => {
    const { project: p } = need(ctx);
    return { data: { files: await ctx.sandbox.listFiles(p.id, args.dir as string | undefined) } };
  }),

  read_file: project({ path }, async (args, ctx) => {
    const { project: p } = need(ctx);
    return { data: { path: args.path, content: await ctx.sandbox.readFile(p.id, args.path as string) } };
  }),

  read_files: project({ paths: z.array(z.string()).max(20) }, async (args, ctx) => {
    const { project: p } = need(ctx);
    const files: Record<string, string> = {};
    for (const file of args.paths as string[]) files[file] = await ctx.sandbox.readFile(p.id, file);
    return { data: { files } };
  }),

  search_code: project({ pattern: z.string().describe('A regular expression.') }, async (args, ctx) => {
    const { project: p } = need(ctx);
    return { data: { hits: await ctx.sandbox.search(p.id, args.pattern as string) } };
  }),

  get_logs: project({}, async (_args, ctx) => {
    const { project: p } = need(ctx);
    const preview = ctx.runtime.status(p.id);
    return {
      data: {
        preview_state: preview?.state ?? 'stopped',
        lines: ctx.runtime.logs(p.id, 100),
        ...(preview?.error ? { error: preview.error } : {}),
        note: preview ? undefined : 'Nothing is running. Call get_preview_url to start it.',
      },
    };
  }),


  get_preview_url: project({}, async (_args, ctx) => {
    const { project: p } = need(ctx);

    // Start it if it is not up. This is the call that turns a directory of
    // files into something a person can look at, so it does the work rather
    // than reporting that nothing is running.
    const preview = await ctx.runtime.start(p.id, await workbenchEnv(ctx, p));
    if (preview.state !== 'ready') {
      const log = ctx.runtime.logs(p.id, 30);
      return {
        refusal: {
          reason: 'unsafe_for_live',
          message:
            `The preview did not start: ${preview.error ?? 'unknown reason'}. ` +
            `Fix what the output reports, then call get_preview_url again.` +
            (log.length ? `\n\nDev server output:\n${log.join('\n')}` : ''),
        },
      };
    }

    const published = await ctx.store.latestDeployment(p.id, 'production');
    return {
      data: {
        url: `${ctx.previewBaseUrl}${preview.path}`,
        state: preview.state,
        note: 'This is the work in progress. It reloads as files change.',
        ...(published ? { published_url: `https://${published.url}`, published_version: published.version } : {}),
      },
    };
  }),


  list_checkpoints: project({}, async (_args, ctx) => {
    const { project: p } = need(ctx);
    return { data: { checkpoints: await ctx.sandbox.listCheckpoints(p.id) } };
  }),

  diff: project(
    {
      from: z.string().describe('A checkpoint id.'),
      to: z.string().optional().describe('Defaults to the current workbench.'),
    },
    async (args, ctx) => {
      const { project: p } = need(ctx);
      return { data: { diff: await ctx.sandbox.diff(p.id, args.from as string, args.to as string | undefined) } };
    },
  ),

  get_publish_status: project({}, async (_args, ctx) => {
    const { project: p } = need(ctx);
    const live = await ctx.store.latestDeployment(p.id, 'production');
    if (!live) return { data: { published: false, message: 'Nothing has been published yet.' } };
    return {
      data: {
        published: live.ready_state === 'READY',
        version: live.version,
        url: `https://${live.url}`,
        ready_state: live.ready_state,
        provider: live.provider,
        deployed_at: live.created_at,
      },
    };
  }),

  export_project: project({}, async (_args, ctx) => {
    const { project: p } = need(ctx);
    const bundle = await ctx.sandbox.exportBundle(p.id);
    return {
      data: {
        download_url: `${ctx.baseUrl}/projects/${p.id}/export`,
        bytes: bundle.bytes,
        filename: `${p.slug}.bundle`,
        restore_with: `git clone ${p.slug}.bundle ${p.slug}`,
        note:
          'Full history included. Open download_url in a browser signed in to Power; the file is free and always will be.',
      },
    };
  }),

  // ------------------------------------------------------------ the pipeline
  submit_spec: project({ spec: z.string().describe('The full contents of SPEC.md.') }, async (args, ctx) => {
    const { project: p, state } = need(ctx);
    const spec = args.spec as string;
    const gate = runGate('spec', { 'SPEC.md': spec });
    await ctx.store.putArtifact(p.id, 'SPEC.md', spec);
    await ctx.store.putGateErrors(p.id, 'spec', gate.errors);
    await ctx.sandbox.writeFile(p.id, 'SPEC.md', spec);

    if (!gate.pass) {
      return {
        events: [
          { type: 'gate_result', stage: 'spec', result: gate },
          { type: 'retry', edge: 'spec_revision', reason: `${gate.errors.length} spec gate failure(s)` },
        ],
        refusal: {
          reason: 'gate_not_satisfied',
          gate: 'spec',
          failures: gate.errors,
          message: `SPEC.md failed ${gate.errors.length} rule(s). Fix each failure listed and submit again.`,
        },
        guidance: ROLE_BRIEFS.architect,
      };
    }

    await ctx.sandbox.checkpoint(p.id, 'Plan passed the spec gate', {
      'Power-Run': state.trace_id,
      'Power-Phase': 'spec',
      'Power-Gate-Spec': 'pass',
    });
    return {
      events: [{ type: 'gate_result', stage: 'spec', result: gate }],
      data: { passed: true, approval_url: approvalUrl(ctx, p) },
      guidance:
        `The plan passed. It now needs the user's approval, which only they can give.\n` +
        `Tell them to open ${approvalUrl(ctx, p)} and approve or reject the plan, then call get_context to see the outcome. Do not write any code until the phase is "build".`,
    };
  }),

  request_spec_approval: project({}, async (_args, ctx) => {
    const { project: p, approvals } = need(ctx);
    await ctx.store.putApprovals(p.id, {
      ...approvals,
      spec_approval_requested_at: approvals.spec_approval_requested_at ?? new Date().toISOString(),
    });
    return {
      data: { approval_url: approvalUrl(ctx, p), status: 'waiting for the user' },
      guidance: `Ask the user to open ${approvalUrl(ctx, p)} and approve the plan. When they say they have, call get_context.`,
    };
  }),

  submit_verification: project(
    { verification: z.string().describe('The full contents of verification.json.') },
    async (args, ctx) => {
      const { project: p, state } = need(ctx);
      const raw = args.verification as string;
      const gate = runGate('verification', { 'verification.json': raw });
      await ctx.store.putArtifact(p.id, 'verification.json', raw);

      // A structurally invalid report is the verifier's mistake, not the build's:
      // it does not spend a retry, and the run stays in verify.
      if (!gate.pass) {
        await ctx.store.putGateErrors(p.id, 'verification', gate.errors);
        return {
          events: [{ type: 'gate_result', stage: 'verification', result: gate }],
          refusal: {
            reason: 'gate_not_satisfied',
            gate: 'verification',
            failures: gate.errors,
            message: `verification.json failed ${gate.errors.length} rule(s). Fix the report and submit again.`,
          },
          guidance: ROLE_BRIEFS.verifier,
        };
      }

      const report = JSON.parse(raw) as {
        pass: boolean;
        issues: { severity: string; where: string; problem: string; expected: string; fix_hint?: string }[];
      };

      if (report.pass) {
        await ctx.store.putGateErrors(p.id, 'verification', []);
        await ctx.sandbox.checkpoint(p.id, 'Verified against the plan', {
          'Power-Run': state.trace_id,
          'Power-Phase': 'verify',
          'Power-Gate-Verification': 'pass',
        });
        return {
          events: [{ type: 'gate_result', stage: 'verification', result: gate }],
          data: { passed: true, publish_url: approvalUrl(ctx, p) },
          guidance:
            `Verification passed. Publishing changes the live app, so the user must confirm it in the browser.\n` +
            `Tell them to open ${approvalUrl(ctx, p)} and confirm, then call publish_app.`,
        };
      }

      // An honest failure. The verifier's issues become the implementer's open
      // failures, and the run goes back to build on a counted retry.
      const failures: GateError[] = report.issues.map((issue) => ({
        artifact: 'build',
        field: issue.where,
        rule: `verification.${issue.severity}`,
        detail: `${issue.problem} Expected: ${issue.expected}${issue.fix_hint ? ` Hint: ${issue.fix_hint}` : ''}`,
      }));
      await ctx.store.putGateErrors(p.id, 'verification', failures);
      return {
        events: [
          { type: 'gate_result', stage: 'verification', result: { ...gate, pass: false, errors: failures } },
          { type: 'retry', edge: 'needs_fixes', reason: `verification found ${failures.length} issue(s)` },
          { type: 'self_verify', green: false },
        ],
        data: { accepted: true, verdict: 'fail', issues: failures.length, sent_back_to: 'build' },
        guidance: `${ROLE_BRIEFS.implementer}\n\nFix every issue in context.open_gate_failures, get run_tests green, then verify again.`,
      };
    },
  ),

  // ------------------------------------------------------------ writing
  write_file: project({ path, content: z.string() }, async (args, ctx) => {
    const { project: p, state } = need(ctx);
    await ctx.sandbox.writeFile(p.id, args.path as string, args.content as string);
    return { data: { written: args.path }, events: staleGreen(state) };
  }),

  edit_file: project(
    {
      path,
      old_text: z.string().describe('Exact text to replace. Must occur exactly once.'),
      new_text: z.string(),
    },
    async (args, ctx) => {
      const { project: p, state } = need(ctx);
      await ctx.sandbox.editFile(p.id, args.path as string, args.old_text as string, args.new_text as string);
      return { data: { edited: args.path }, events: staleGreen(state) };
    },
  ),

  delete_file: project({ path }, async (args, ctx) => {
    const { project: p, state } = need(ctx);
    await ctx.sandbox.deleteFile(p.id, args.path as string);
    return { data: { deleted: args.path }, events: staleGreen(state) };
  }),

  rename_file: project({ from: z.string(), to: z.string() }, async (args, ctx) => {
    const { project: p, state } = need(ctx);
    await ctx.sandbox.renameFile(p.id, args.from as string, args.to as string);
    return { data: { renamed: [args.from, args.to] }, events: staleGreen(state) };
  }),

  copy_file: project({ from: z.string(), to: z.string() }, async (args, ctx) => {
    const { project: p, state } = need(ctx);
    await ctx.sandbox.copyFile(p.id, args.from as string, args.to as string);
    return { data: { copied: [args.from, args.to] }, events: staleGreen(state) };
  }),

  add_dependency: project(
    { name: z.string().describe('Package name, optionally with a version range.'), dev: z.boolean().optional() },
    async (args, ctx) => {
      const { project: p, state } = need(ctx);
      const result = await ctx.sandbox.run(p.id, ['pnpm', 'add', ...(args.dev ? ['-D'] : []), args.name as string]);
      if (!result.ok) throw new ToolError(`could not add ${args.name}: ${result.stderr || result.stdout}`);
      return { data: { added: args.name }, events: staleGreen(state) };
    },
  ),

  remove_dependency: project({ name: z.string() }, async (args, ctx) => {
    const { project: p, state } = need(ctx);
    const result = await ctx.sandbox.run(p.id, ['pnpm', 'remove', args.name as string]);
    if (!result.ok) throw new ToolError(`could not remove ${args.name}: ${result.stderr || result.stdout}`);
    return { data: { removed: args.name }, events: staleGreen(state) };
  }),

  // ------------------------------------------------------------ verification
  typecheck: project({}, async (_args, ctx) => {
    const { project: p } = need(ctx);
    return { data: await ctx.sandbox.run(p.id, ['pnpm', 'typecheck'], await workbenchEnv(ctx, p)) };
  }),

  /**
   * The implementer's own gate on itself. Typecheck and tests together; green
   * means both passed. A green result during build moves the run to verify —
   * the implementer does not get to decide when it is done, the checks do.
   */
  run_tests: project({}, async (_args, ctx) => {
    const { project: p, state } = need(ctx);
    const env = await workbenchEnv(ctx, p);
    const typecheck = await ctx.sandbox.run(p.id, ['pnpm', 'typecheck'], env);
    const tests = await ctx.sandbox.run(p.id, ['pnpm', 'test'], env);
    const green = typecheck.ok && tests.ok;
    const events: RunEvent[] = [{ type: 'self_verify', green }];
    if (green && state.phase === 'build') {
      await ctx.sandbox.checkpoint(p.id, 'Build green: typecheck and tests pass', {
        'Power-Run': state.trace_id,
        'Power-Phase': 'build',
      });
      events.push({ type: 'start_verification' });
    }
    return {
      data: { green, typecheck, tests },
      events,
      guidance: green ? ROLE_BRIEFS.verifier : ROLE_BRIEFS.implementer,
    };
  }),

  run_command: project(
    {
      argv: z
        .array(z.string())
        .min(1)
        .describe('Command and arguments. Allowlisted: pnpm, npm, npx, node, tsc, vitest, git.'),
    },
    async (args, ctx) => {
      const { project: p } = need(ctx);
      return { data: await ctx.sandbox.run(p.id, args.argv as string[], await workbenchEnv(ctx, p)) };
    },
  ),

  // ------------------------------------------------------------ data
  provision_database: project({}, async (_args, ctx) => {
    const { project: p } = need(ctx);
    const result = await ctx.db.provision(p.id);
    return {
      data: {
        ...result,
        environments: {
          workbench: 'Safe copy. Build and test against this freely.',
          live: 'Your live app. Changed only by promote_migration, after the migration gate.',
        },
        connection: 'Your app reads DATABASE_URL from its environment; Power injects the right one per environment.',
      },
      guidance:
        'Schema changes go through propose_migration({ up_sql, down_sql, intent }). The gate rehearses them on a copy of live and refuses anything that would fail, cannot be reversed, or would lock a large table. There is no tool that runs SQL against live.',
    };
  }),

  pull_schema: project({ env: z.enum(['workbench', 'live']).optional() }, async (args, ctx) => {
    const { project: p } = need(ctx);
    const branch = (args.env as 'workbench' | 'live' | undefined) ?? 'workbench';
    return { data: { env: branch, tables: await ctx.db.schema(p.id, branch) } };
  }),

  query_database: project(
    { sql: z.string().describe('A read-only query. Runs against the safe copy, never live. Capped at 100 rows.') },
    async (args, ctx) => {
      const { project: p } = need(ctx);
      return { data: await ctx.db.query(p.id, args.sql as string, QUERY_ROW_CAP) };
    },
  ),

  propose_migration: project(
    {
      up_sql: z.string().describe('SQL that makes the change.'),
      down_sql: z.string().describe('SQL that reverses it exactly.'),
      intent: z.string().describe('One plain-English sentence the user will read, e.g. "Add a phone number to each customer."'),
    },
    async (args, ctx) => {
      const { project: p, approvals } = need(ctx);
      const proposal: MigrationProposal = {
        up_sql: args.up_sql as string,
        down_sql: args.down_sql as string,
        intent: args.intent as string,
      };
      // Cheap static checks first, so an obviously broken proposal never touches a database.
      const quick = analyseMigration(proposal);
      const verdict = quick.pass ? await ctx.db.rehearse(p.id, proposal) : quick;

      const stored: StoredMigration = { proposal, verdict, proposed_at: new Date().toISOString() };
      await ctx.store.putArtifact(p.id, 'migration.json', JSON.stringify(stored));
      // A new proposal invalidates any earlier typed confirmation.
      if (approvals.migration_confirmed_at) {
        await ctx.store.putApprovals(p.id, { ...approvals, migration_confirmed_at: null });
      }

      if (!verdict.pass) {
        return {
          refusal: {
            reason: 'gate_not_satisfied',
            failures: verdict.errors,
            message: `The migration failed ${verdict.errors.length} rule(s) when rehearsed against a copy of the live database. Fix and propose again. Nothing was changed.`,
          },
        };
      }

      // Passed: apply to the workbench so the assistant can build against it.
      await ctx.db.applyToWorkbench(p.id, proposal.up_sql);
      return {
        data: {
          passed: true,
          destructive: verdict.destructive,
          summary: verdict.summary,
          applied_to: 'workbench',
          live: verdict.destructive
            ? `This change can lose data. Before it can reach the live app the user must type a confirmation at ${approvalUrl(ctx, p)}. That cannot be done from this conversation.`
            : 'Ready for promote_migration once the run reaches verification.',
        },
      };
    },
  ),

  promote_migration: project({}, async (_args, ctx) => {
    const { project: p, approvals } = need(ctx);
    const stored = await storedMigration(ctx, p);
    if (!stored) throw new ToolError('no migration has been proposed. Call propose_migration first.');
    if (!stored.verdict.pass) {
      return {
        refusal: {
          reason: 'gate_not_satisfied',
          failures: stored.verdict.errors,
          message: 'The last proposed migration did not pass the migration gate. Propose a corrected one.',
        },
      };
    }
    if (stored.promoted_at) throw new ToolError(`this migration was already promoted at ${stored.promoted_at}.`);
    if (stored.verdict.destructive && !approvals.migration_confirmed_at) {
      return {
        refusal: {
          reason: 'needs_user_input',
          message: `This migration can lose data (${stored.verdict.summary.filter((s) => s.startsWith('⚠')).join('; ')}). The user must type a confirmation at ${approvalUrl(ctx, p)} before it can reach the live app.`,
        },
      };
    }
    const { snapshot } = await ctx.db.promote(p.id, stored.proposal);
    await ctx.store.putArtifact(p.id, 'migration.json', JSON.stringify({ ...stored, promoted_at: new Date().toISOString(), snapshot }));
    await ctx.store.putApprovals(p.id, { ...approvals, migration_confirmed_at: null });
    return {
      data: {
        promoted: true,
        snapshot,
        rollback: 'The live database was snapshotted first; restoring it is one click in the browser.',
      },
    };
  }),

  // ------------------------------------------------------------ secrets
  request_secret: project(
    {
      name: z.string().describe('Environment variable name, e.g. STRIPE_SECRET_KEY.'),
      env: z.enum(['workbench', 'live', 'both']).default('workbench'),
      provider: z.string().optional().describe('e.g. "stripe". Used to label the form and scope egress.'),
      why: z.string().describe('One sentence the user will read explaining why the app needs this.'),
    },
    async (args, ctx) => {
      const { project: p } = need(ctx);
      const name = args.name as string;
      if (!validEnvName(name)) throw new ToolError(`${name} is not a valid environment variable name (UPPER_SNAKE_CASE).`);
      const pending = await ctx.secrets.request({
        user_id: ctx.userId,
        project_id: p.id,
        name,
        env: args.env as 'workbench' | 'live' | 'both',
        provider: (args.provider as string | undefined) ?? null,
        why: args.why as string,
      });
      const url = `${ctx.baseUrl}/secrets/${pending.token}`;
      return {
        data: {
          name,
          env: pending.env,
          form_url: url,
          expires_at: pending.expires_at,
          note: 'The value is entered in the browser and never appears in this conversation. Your code reads it from process.env.',
        },
        guidance: `Ask the user to open ${url} and paste the value. Do not ask them to paste it here. Once they have, the variable is available to run_tests and run_command as process.env.${name}.`,
      };
    },
  ),

  // ------------------------------------------------------------ history
  create_checkpoint: project({ message: z.string().min(1) }, async (args, ctx) => {
    const { project: p, state } = need(ctx);
    return {
      data: await ctx.sandbox.checkpoint(p.id, args.message as string, {
        'Power-Run': state.trace_id,
        'Power-Phase': state.phase,
      }),
    };
  }),

  restore_checkpoint: project({ checkpoint_id: z.string() }, async (args, ctx) => {
    const { project: p, state } = need(ctx);
    await ctx.sandbox.restore(p.id, args.checkpoint_id as string);
    return { data: { restored: args.checkpoint_id }, events: staleGreen(state) };
  }),

  // ------------------------------------------------------------ shipping
  publish_app: project({}, async (_args, ctx) => {
    const { project: p, approvals } = need(ctx);
    const cred = await deployCredential(ctx);
    if (!cred) return await askForDeployToken(ctx, p);

    // Tag first: the files come from the tag, so a release can only ever
    // contain committed work.
    const { version } = await ctx.sandbox.tagRelease(p.id);
    const files = await collectRelease(ctx.sandbox, p.id, version);
    const name = deployProjectName(p.slug);

    let deployment;
    try {
      deployment = await ctx.deployer.create(
        {
          projectName: name,
          target: 'production',
          files,
          // Without this a published app has no database and none of its live
          // secrets, so it builds and then fails on its first request.
          env: await envFor(ctx, p, 'live'),
          meta: { power_project: p.id, power_version: version },
        },
        cred,
      );
      deployment = await ctx.deployer.waitForReady(deployment.id, cred, DEPLOY_BUDGET_MS);
    } catch (error) {
      return deployRefusal(error);
    }

    await ctx.store.putDeployment({
      id: deployment.id,
      project_id: p.id,
      provider: ctx.deployer.provider,
      target: 'production',
      version,
      commit: await ctx.sandbox.headCommit(p.id),
      url: deployment.url,
      ready_state: deployment.ready_state,
      deploy_project_name: name,
      created_at: deployment.created_at,
    });

    if (deployment.ready_state !== 'READY') {
      // No `published` event: the run is not done, because nothing is live.
      const logs = await ctx.deployer.buildLogs(deployment.id, cred).catch(() => []);
      return {
        refusal: {
          reason: 'unsafe_for_live',
          message:
            `The build did not become ready (${deployment.ready_state}). Nothing was published. ` +
            `Fix what the build output reports, then publish again.` +
            (logs.length ? `\n\nBuild output:\n${logs.join('\n')}` : ''),
        },
      };
    }

    // The confirmation is one-shot: it authorised this publish and no other.
    await ctx.store.putApprovals(p.id, { ...approvals, publish_confirmed_at: null });
    const url = `https://${deployment.aliases[0] ?? deployment.url}`;
    return {
      events: [{ type: 'published' }],
      data: {
        version,
        url,
        deployment_id: deployment.id,
        ready_state: deployment.ready_state,
        provider: ctx.deployer.provider,
        message:
          ctx.deployer.provider === 'local'
            ? // Say what this actually is. The local deployer writes the release
              // and serves its files; it runs no server, so the app's own API is
              // not up and a model must not report that it is.
              `Published ${version} to ${url}. This is the local deployer: it serves the built ` +
              `files so the page can be opened, but it runs no server, so the app's /api routes ` +
              `are not live there. The preview is where the running app is. Set POWER_DEPLOYER ` +
              `to deploy to real hosting.`
            : `Published ${version} to ${url}. It is in the user's own hosting account, not ours.`,
      },
    };
  }),

  rollback: project({}, async (_args, ctx) => {
    const { project: p, approvals } = need(ctx);
    const cred = await deployCredential(ctx);
    if (!cred) return await askForDeployToken(ctx, p);

    const history = await ctx.store.listDeployments(p.id, 'production', 5);
    const previous = history.filter((d) => d.ready_state === 'READY')[1];
    if (!previous) {
      return {
        refusal: {
          reason: 'needs_user_input',
          message: 'There is no earlier successful release to roll back to.',
        },
      };
    }

    try {
      // A promotion, not a rebuild: that build already exists and is ready.
      const promoted = await ctx.deployer.promote(previous.deploy_project_name, previous.id, cred);
      // Mark the release as promoted instead of writing it back unchanged.
      // Without this `latestDeployment` still pointed at the release that was
      // rolled away from, so get_publish_status reported the wrong live
      // version and the history could not offer the reverse move.
      await ctx.store.putDeployment({
        ...previous,
        url: promoted.aliases[0] ?? promoted.url,
        ready_state: promoted.ready_state,
        promoted_at: new Date().toISOString(),
      });
      await ctx.store.putApprovals(p.id, { ...approvals, publish_confirmed_at: null });
      const url = `https://${promoted.aliases[0] ?? promoted.url}`;
      return {
        data: {
          version: previous.version,
          url,
          deployment_id: previous.id,
          message: `Live is ${previous.version} again, promoted without a rebuild.`,
        },
      };
    } catch (error) {
      return deployRefusal(error);
    }
  }),

  unpublish_app: project({}, async (_args, ctx) => {
    const { project: p, approvals } = need(ctx);
    const cred = await deployCredential(ctx);
    if (!cred) return await askForDeployToken(ctx, p);

    const live = await ctx.store.latestDeployment(p.id, 'production');
    if (!live) return { data: { unpublished: false, message: 'Nothing is published.' } };

    // Taking someone's live app offline is the most destructive thing here, and
    // it used to be the only live-capable tool that needed nobody's consent.
    // Typed rather than a button, for the same reason a destructive migration
    // is: a button is too easy to click on an assistant's say-so.
    if (!approvals.unpublish_confirmed_at) {
      return {
        refusal: {
          reason: 'needs_user_input',
          message:
            `Taking ${p.name} offline needs the user to confirm it in a browser; this cannot be ` +
            `confirmed in chat. Ask them to open ${ctx.baseUrl}/projects/${p.id} and type the ` +
            `project name to confirm, then call unpublish_app again.`,
        },
      };
    }

    try {
      await ctx.deployer.remove(live.id, cred);
    } catch (error) {
      return deployRefusal(error);
    }
    await ctx.store.putDeployment({ ...live, ready_state: 'CANCELED' });
    // One-shot: it authorised this unpublish and no other.
    await ctx.store.putApprovals(p.id, { ...approvals, unpublish_confirmed_at: null });
    return {
      data: {
        unpublished: true,
        // Say plainly what was not removed: the hosting project and any
        // domains are the user's, and deleting those is not ours to do.
        message: `The deployment is gone. The hosting project and any domains stay in the user's own account.`,
      },
    };
  }),
};
