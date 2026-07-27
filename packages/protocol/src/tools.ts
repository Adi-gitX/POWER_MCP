/**
 * The tool registry.
 *
 * One table describing every tool's name, whether it costs a build action, and
 * which phases it is legal in. Keeping this declarative rather than scattering
 * checks through handlers means the metering ledger, the phase guard, and the
 * published tool list can never drift apart — and the pricing page can be
 * generated from the same source as the enforcement.
 *
 * Two rules encoded here that are worth stating out loud:
 *
 *   • Reads are free. A model that is afraid to look before it edits produces
 *     worse work, and some builders charge for `list_files`. Making reads free is both
 *     better engineering and a better pricing story.
 *   • `export_project` is free, forever. It is the anti-lock-in promise, and
 *     charging for the exit would make the promise a lie.
 */
import type { Phase } from '@power/runstate';

/** Phases in which a tool may be called. `'*'` means any non-terminal phase. */
export type PhaseScope = readonly Phase[] | '*';

export interface ToolSpec {
  name: string;
  /** Does this call consume a build action? Reads and housekeeping do not. */
  metered: boolean;
  phases: PhaseScope;
  /**
   * May this tool ever act on the live environment? Almost nothing may. This is
   * the flag that makes "the AI cannot touch production" a property of the
   * registry rather than a promise in the docs.
   */
  live_capable: boolean;
  /** Can exceed a client's tool timeout, so it must return a job handle. */
  async: boolean;
  summary: string;
}

const ANY: PhaseScope = '*';

export const TOOLS: readonly ToolSpec[] = [
  // ---- Orientation. Free, always legal. These are how a lost model recovers,
  // so gating or charging for them would be actively harmful.
  f('get_context', ANY, 'Current phase, open gate failures, and the next action.'),
  f('get_next_action', ANY, 'The single next tool call this run expects.'),
  f('list_projects', ANY, 'Projects this account can open.'),
  f('get_project', ANY, 'One project: status, URLs, environments.'),
  f('get_guides', ANY, 'Retrieve a knowledge pack or integration playbook.'),
  f('get_job', ANY, 'Poll an async job started by a slow tool.'),

  // ---- Reading. Free by design.
  f('list_files', ANY, 'List files in the workbench.'),
  f('read_file', ANY, 'Read one file.'),
  f('read_files', ANY, 'Read several files in one call.'),
  f('search_code', ANY, 'Search the workbench by pattern.'),
  f('get_logs', ANY, 'Runtime logs from workbench or live.'),
  f('get_preview_url', ANY, 'The workbench preview URL.'),
  f('get_publish_status', ANY, 'What is live, and at which version.'),
  f('list_checkpoints', ANY, 'Restore points, newest first.'),
  f('diff', ANY, 'Diff between two checkpoints, or against the live version.'),

  // ---- The exit. Free, deliberately and permanently.
  f('export_project', ANY, 'Download the full repo with history, ready to run elsewhere.'),

  // ---- Project lifecycle.
  m('create_project', ANY, 'Create a project and its workbench.'),
  m('start_run', ['done', 'blocked'], 'Begin a new run on an existing project: a new plan, against the code and data already there.'),
  m('import_repo', ['intake'], 'Import an existing repo that matches a supported shape.'),
  m('update_project_metadata', ANY, 'Title, description, icon.'),

  // ---- The pipeline. These are the spine: each submits an artifact to a gate.
  m('submit_research', ['research'], 'Submit research.json to the research gate.'),
  m('submit_spec', ['spec'], 'Submit SPEC.md to the spec gate.'),
  m('request_spec_approval', ['spec_approval'], 'Ask the human to approve the plan.'),
  m('submit_verification', ['verify'], 'Submit verification.json to the verification gate.'),

  // ---- Writing. Legal only once there is an approved plan to build against.
  m('write_file', ['build'], 'Create or replace a file.'),
  m('edit_file', ['build'], 'Edit a file by exact string replacement.'),
  m('apply_patch', ['build'], 'Apply a unified diff.'),
  m('rename_file', ['build'], 'Rename or move a file.'),
  m('copy_file', ['build'], 'Copy a file.'),
  m('delete_file', ['build'], 'Delete a file.'),
  m('add_dependency', ['build'], 'Add a package.', { async: true }),
  m('remove_dependency', ['build'], 'Remove a package.', { async: true }),

  // ---- Verification. Legal in build and verify: the implementer checks its own
  // work before handing off, and the verifier checks it again with fresh eyes.
  m('typecheck', ['build', 'verify'], 'Typecheck the workbench.', { async: true }),
  m('run_tests', ['build', 'verify'], 'Run the test suite.', { async: true }),
  m('run_command', ['build', 'verify'], 'Run an allowlisted command.', { async: true }),
  m('run_in_browser', ['build', 'verify'], 'Evaluate JS against the live preview DOM.'),
  m('screenshot_preview', ['build', 'verify'], 'Screenshot the preview.'),
  m('navigate_preview', ['build', 'verify'], 'Point the preview at a route.'),

  // ---- Data. Note what is absent: there is no `execute_sql`. Arbitrary SQL
  // against the database serving real users is the single most-complained-about
  // behaviour in this category, so the capability simply does not exist.
  m('provision_database', ['build'], 'Create the project database.', { async: true }),
  m('pull_schema', ['build', 'verify'], 'Regenerate typed helpers from the schema.'),
  m('query_database', ['build', 'verify'], 'Read from the workbench database. Row-capped.'),
  m('propose_migration', ['build'], 'Submit a schema change to the migration gate.', {
    async: true,
  }),
  m('promote_migration', ['verify'], 'Apply a gate-passed migration to live.', {
    live: true,
    async: true,
  }),

  // ---- History.
  m('create_checkpoint', ANY, 'Label a restore point.'),
  m('restore_checkpoint', ['build', 'verify', 'blocked'], 'Roll the workbench back.'),

  // ---- Shipping. `publish_app` is where the three publish conditions are
  // enforced; it is the narrowest door in the system.
  m('publish_app', ['verify'], 'Publish the workbench to the live app.', {
    live: true,
    async: true,
  }),
  m('rollback', ANY, 'Return the live app to the previous version.', { live: true, async: true }),
  m('unpublish_app', ANY, 'Take the live app down.', { live: true }),

  // ---- Assets and secrets. `request_secret` never accepts a value over MCP;
  // it returns a URL the human opens. The model only ever learns the env var name.
  m('request_secret', ANY, 'Ask the user for a credential via a browser form.'),
  m('request_user_upload', ANY, 'Ask the user for a file via the browser.'),
  m('upload_asset', ['build'], 'Store an asset the project can serve.'),
  m('generate_image', ['build'], 'Generate an image. Consumes credits.', { async: true }),
];

function f(name: string, phases: PhaseScope, summary: string): ToolSpec {
  return { name, metered: false, phases, live_capable: false, async: false, summary };
}

function m(
  name: string,
  phases: PhaseScope,
  summary: string,
  options: { live?: boolean; async?: boolean } = {},
): ToolSpec {
  return {
    name,
    metered: true,
    phases,
    live_capable: options.live ?? false,
    async: options.async ?? false,
    summary,
  };
}

const BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

export function lookupTool(name: string): ToolSpec | undefined {
  return BY_NAME.get(name);
}

/**
 * Terminal phases accept only orientation and recovery. A run that is done or
 * blocked must not quietly keep building.
 */
const TERMINAL_ALLOWED = new Set([
  'get_context',
  'get_next_action',
  'list_projects',
  'get_project',
  'get_guides',
  'get_job',
  'list_files',
  'read_file',
  'read_files',
  'search_code',
  'get_logs',
  'get_preview_url',
  'get_publish_status',
  'list_checkpoints',
  'diff',
  'export_project',
  'restore_checkpoint',
  'rollback',
  'unpublish_app',
  'create_checkpoint',
  // The way out of a terminal phase: the next piece of work.
  'start_run',
]);

export function isLegalInPhase(tool: ToolSpec, phase: Phase): boolean {
  if (phase === 'done' || phase === 'blocked') return TERMINAL_ALLOWED.has(tool.name);
  if (tool.phases === '*') return true;
  return tool.phases.includes(phase);
}
