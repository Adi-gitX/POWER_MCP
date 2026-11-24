/**
 * The tool registry.
 *
 * One table describing every tool's name, how it is billed, which phases it is
 * legal in, and how a client should treat it. Keeping this declarative rather
 * than scattering checks through handlers means the metering ledger, the phase
 * guard, and the published tool list can never drift apart — and the pricing
 * page is generated from the same source as the enforcement.
 *
 * Three rules encoded here that are worth stating out loud:
 *
 *   • Reads are free. A model that is afraid to look before it edits produces
 *     worse work, and some builders charge for `list_files`. Making reads free
 *     is both better engineering and a better pricing story.
 *   • `export_project` is free, forever. It is the anti-lock-in promise, and
 *     charging for the exit would make the promise a lie.
 *   • The behavioural hints are *declared*, not derived. They used to be
 *     computed from `metered`, which is a billing property rather than a
 *     mutation one — so `export_project` announced itself as read-only while
 *     writing a bundle to disk, and `write_file` announced that it destroyed
 *     nothing. A client uses these to decide what to confirm with a person, so
 *     getting them from the wrong field is a safety bug, not a cosmetic one.
 *
 * Every tool in this table has a handler. A registry entry without one is a
 * tool a model will try and fail to call, so `assertRegistryCoverage` checks
 * the correspondence in both directions.
 */
import type { Phase } from '@power/runstate';

/** Phases in which a tool may be called. `'*'` means any non-terminal phase. */
export type PhaseScope = readonly Phase[] | '*';

export interface ToolSpec {
  name: string;
  /** Shown to a person in a client's tool list, so it reads as English. */
  title: string;
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
  /** Observes without changing anything. */
  read_only: boolean;
  /** May overwrite or delete something that already exists. */
  destructive: boolean;
  /** Calling it twice has the same effect as calling it once. */
  idempotent: boolean;
  /** Reaches something outside this project, such as the package registry. */
  open_world: boolean;
  summary: string;
}

const ANY: PhaseScope = '*';

export const TOOLS: readonly ToolSpec[] = [
  // ---- Orientation. Free, always legal. These are how a lost model recovers,
  // so gating or charging for them would be actively harmful.
  read('get_context', ANY, 'Current state of the run', 'Where the run is: phase, open gate failures, retries left and the next call to make. Safe at any time; call it first if you are unsure.'),
  read('get_next_action', ANY, 'The next call to make', 'The single tool call this run expects next, and why. Call it when a refusal leaves you unsure what to do.'),
  read('list_projects', ANY, 'List projects', 'Every project on this account. The usual first call in a new conversation.'),
  read('get_project', ANY, 'Get one project', 'One project: status, URLs and environments.'),
  read('get_guides', ANY, 'Get a role brief or template', 'A role brief or artifact template: researcher, architect, implementer, builder, verifier, or spec_template.'),
  read('get_job', ANY, 'Poll a background job', 'The state of a job started by a slow tool. Free, so poll it as often as you like.'),

  // ---- Reading. Free by design.
  read('list_files', ANY, 'List files', 'Files in the workbench.'),
  read('read_file', ANY, 'Read a file', 'The contents of one file in the workbench.'),
  read('read_files', ANY, 'Read several files', 'Several workbench files in one call. Prefer this over repeated read_file.'),
  read('search_code', ANY, 'Search the code', 'Search the workbench for a pattern.'),
  read('get_logs', ANY, 'Get logs', 'The workbench preview’s own output, which is where a build error actually appears.'),
  // Not read_only, whatever its name suggests: it starts the project's dev
  // server as a child process and waits for it to answer. Free, because
  // looking at your own work should not cost a build action, and idempotent
  // because an already-running preview is returned as it is.
  m('get_preview_url', ANY, 'Start or get the preview', 'Start the project if it is not running and return the URL where the current workbench build can be viewed.', { metered: false, idempotent: true }),
  read('get_publish_status', ANY, 'Get publish status', 'What is live, and at which version.'),
  read('list_checkpoints', ANY, 'List checkpoints', 'Restore points for this project, newest first.'),
  read('diff', ANY, 'Diff two checkpoints', 'Changes between two checkpoints, or between one and the current workbench.'),

  // ---- The exit. Free, deliberately and permanently. Not read-only: it
  // writes a bundle, which is exactly the kind of thing the old derived hint
  // got wrong.
  m('export_project', ANY, 'Export the project', 'Download the whole repository with its history, ready to run anywhere else. Always free.', { metered: false, idempotent: true }),

  // ---- Project lifecycle.
  m('create_project', ANY, 'Create a project', 'Create a project and its workbench. The first call when building something new.'),
  m('start_run', ['done', 'blocked'], 'Start another run', 'Begin a new run on a project that already shipped: a fresh plan against the code and data already there.'),

  // ---- Gates. Each submits an artifact for checking and is legal in exactly
  // one phase; calling one out of phase is refused with the reason.
  m('submit_research', ['research'], 'Submit research', 'Power Up runs only. Submit research.json to the research gate: sourced findings the plan will build on. Refused with the failing rule if a claim has no source.', { idempotent: true, open_world: true }),
  m('submit_spec', ['spec'], 'Submit the plan', 'Submit SPEC.md to the spec gate. Legal in the spec phase. Refused with the failing rule if the plan is incomplete.', { idempotent: true }),
  m('request_spec_approval', ['spec_approval'], 'Ask for plan approval', 'Ask the person to approve the plan in their browser. Only they can approve it; you cannot.', { idempotent: true }),
  m('submit_verification', ['verify'], 'Submit verification', 'Submit verification.json to the verification gate. Legal in the verify phase, once the tests are green.', { idempotent: true }),

  // ---- Editing. All of these overwrite or remove something.
  m('write_file', ['build'], 'Write a file', 'Create a file, or replace one that exists. Legal in the build phase.', { destructive: true, idempotent: true }),
  m('edit_file', ['build'], 'Edit a file', 'Replace an exact string in a file. Legal in the build phase.', { destructive: true }),
  m('rename_file', ['build'], 'Rename a file', 'Rename or move a file. Legal in the build phase.', { destructive: true }),
  m('copy_file', ['build'], 'Copy a file', 'Copy a file, replacing the destination if it exists. Legal in the build phase.', { destructive: true, idempotent: true }),
  m('delete_file', ['build'], 'Delete a file', 'Delete a file. Legal in the build phase.', { destructive: true, idempotent: true }),

  // ---- Dependencies reach the public package registry.
  m('add_dependency', ['build'], 'Add a dependency', 'Install a package from the public registry. Legal in the build phase.', { async: true, open_world: true }),
  m('remove_dependency', ['build'], 'Remove a dependency', 'Uninstall a package. Legal in the build phase.', { async: true, open_world: true, destructive: true, idempotent: true }),

  // ---- Checking.
  m('typecheck', ['build', 'verify'], 'Typecheck', 'Typecheck the workbench. Changes nothing.', { async: true, read_only: true, idempotent: true }),
  m('run_tests', ['build', 'verify'], 'Run the tests', 'Run the test suite. The build gate will not let you hand off until this is green.', { async: true, idempotent: true }),
  m('run_command', ['build', 'verify'], 'Run a command', 'Run one allowlisted command in the workbench. It can change files, so it is treated as destructive.', { async: true, destructive: true, open_world: true }),

  // ---- Data. There is no tool here that runs SQL against live, by design.
  m('provision_database', ['build'], 'Create the database', 'Create this project’s database: a live branch and a safe copy to work against.', { async: true, idempotent: true }),
  m('pull_schema', ['build', 'verify'], 'Read the schema', 'List the tables and columns on the workbench or live branch, so the plan and the code match the database that exists.', { idempotent: true }),
  m('query_database', ['build', 'verify'], 'Query the safe copy', 'Read from the workbench copy of the database. Row-capped, and it never touches live.', { read_only: true, idempotent: true }),
  m('propose_migration', ['build'], 'Propose a schema change', 'Submit a schema change to the migration gate, which rehearses it on a copy of live and checks that it reverses cleanly.', { async: true }),
  m('promote_migration', ['verify'], 'Apply the migration to live', 'Apply a gate-passed migration to the live database. Changes production data, and a destructive change needs the project name typed in the browser first.', { live: true, async: true, destructive: true }),

  // ---- Checkpoints.
  m('create_checkpoint', ANY, 'Save a checkpoint', 'Label a restore point you can come back to.'),
  m('restore_checkpoint', ['build', 'verify', 'blocked'], 'Restore a checkpoint', 'Roll the workbench back to a checkpoint, discarding work after it.', { destructive: true, idempotent: true }),

  // ---- Release. Everything here changes what real users see.
  m('publish_app', ['build', 'verify'], 'Publish', 'Publish the build to the live app once its conditions hold: green checks (and, with Power Up, an approved plan and passed verification). The person must confirm this in their browser first.', { live: true, async: true, destructive: true }),
  m('rollback', ANY, 'Roll back', 'Return the live app to its previous version.', { live: true, async: true, destructive: true }),
  m('unpublish_app', ANY, 'Take the app down', 'Take the live app offline.', { live: true, destructive: true, idempotent: true }),

  // ---- People. Credentials arrive through the browser, never the chat.
  m('request_secret', ANY, 'Ask for a credential', 'Ask the person for a credential through a single-use browser form. Never ask for a secret in the conversation.'),
];

/** A free, non-mutating tool. The common case, so it gets the short helper. */
function read(name: string, phases: PhaseScope, title: string, summary: string): ToolSpec {
  return {
    name,
    title,
    metered: false,
    phases,
    live_capable: false,
    async: false,
    read_only: true,
    destructive: false,
    idempotent: true,
    open_world: false,
    summary,
  };
}

function m(
  name: string,
  phases: PhaseScope,
  title: string,
  summary: string,
  options: {
    metered?: boolean;
    live?: boolean;
    async?: boolean;
    read_only?: boolean;
    destructive?: boolean;
    idempotent?: boolean;
    open_world?: boolean;
  } = {},
): ToolSpec {
  return {
    name,
    title,
    metered: options.metered ?? true,
    phases,
    live_capable: options.live ?? false,
    async: options.async ?? false,
    read_only: options.read_only ?? false,
    destructive: options.destructive ?? false,
    idempotent: options.idempotent ?? false,
    open_world: options.open_world ?? false,
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
