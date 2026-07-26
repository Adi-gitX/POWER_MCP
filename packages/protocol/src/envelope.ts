/**
 * The response envelope.
 *
 * This is the load-bearing piece of the whole product, and it is worth being
 * explicit about why it looks the way it does.
 *
 * Power's pipeline is enforced server-side, but the agent walking it is a model
 * we do not control, running in a client we do not control, on a context we
 * cannot see. We get exactly one channel to steer it: the content of a tool
 * result. So every refusal has to do three jobs at once —
 *
 *   1. Say no, in a way the client cannot mistake for a broken tool.
 *   2. Say precisely what is wrong, in the `GateError` shape, so the model can
 *      act without asking the user.
 *   3. Say what to do next, as a concrete tool call.
 *
 * ## Why refusals are `ok: true` at the MCP layer
 *
 * A gate rejection is NOT an MCP protocol error, and this distinction is the
 * single most important implementation detail in the server.
 *
 * MCP has two failure channels: a JSON-RPC error (the call itself failed) and
 * `isError: true` on a tool result (the tool ran and reports failure). Client
 * models handle both badly: they tend to surface them to the user as "the tool
 * is broken", apologise, and stop. That behaviour is fatal here, because a gate
 * refusal is the *normal, expected* path — it happens on most first attempts,
 * by design.
 *
 * So a refusal is a successful tool result whose payload says `ok: false`. To
 * the transport it is a completely ordinary response. To the model it reads as
 * structured, actionable feedback. Protocol errors are reserved for things that
 * genuinely are errors: auth failure, quota exhaustion, a sandbox that died.
 *
 * ## Why every response carries `context`
 *
 * We never assume the client remembers anything. Context gets compacted, users
 * run `/clear`, and someone may start a project in Claude and continue it in
 * Cursor. Re-grounding on every single call is what makes the pipeline survive
 * all three, and it is why the state machine had to be pure functions over a
 * row rather than anything living in a process.
 */
import type { GateError, Stage } from '@power/gates';
import type { FeedbackEdge, Phase } from '@power/runstate';

/** A concrete next step, expressed as a tool call the client can make directly. */
export interface NextAction {
  tool: string;
  args: Record<string, unknown>;
  /** One sentence on why this is the next step. Shown to the model, not the user. */
  why: string;
}

/**
 * The re-grounding block attached to every response, successful or not.
 *
 * Kept deliberately small: it is appended to every tool result, so its size is
 * multiplied across an entire session's context. Anything that is not needed to
 * decide the next call does not belong here.
 */
export interface ContextBlock {
  project_id: string;
  run_id: string;
  phase: Phase;
  phase_label: string;
  /** Which environment the call acted on. Never `live` for anything the AI writes. */
  env: 'workbench' | 'live';
  /** Unresolved gate failures across all stages, so a model cannot lose track of them. */
  open_gate_failures: GateError[];
  /** Retries left on each bounded edge before the run blocks and asks a human. */
  loops_remaining: Record<FeedbackEdge, number>;
  next_action: NextAction | null;
  /** Present only when the run is blocked, so the model stops rather than retrying. */
  blocked_reason?: string;
}

export interface OkResponse<T> {
  ok: true;
  data: T;
  context: ContextBlock;
  /** Set when the call consumed a build action, so usage is never a surprise. */
  billed?: boolean;
  /**
   * A role brief or artifact template the model needs for the next step. This
   * is how the client's own model is handed the architect / implementer /
   * verifier role — as a tool-response payload rather than a system prompt we
   * would have to pay to run.
   */
  guidance?: string;
}

/**
 * Why a call was refused.
 *
 * These are stable identifiers. They appear in tool results read by models, in
 * our own metrics, and in the eval harness that checks how each client reacts to
 * a refusal — so renaming one is a breaking change.
 */
export type RefusalReason =
  /** The artifact was produced but failed its deterministic gate. */
  | 'gate_not_satisfied'
  /** The tool is real but not legal in the current phase. */
  | 'wrong_phase'
  /** A human decision is outstanding. Only a person can clear this. */
  | 'awaiting_human_approval'
  /** A bounded retry edge is exhausted. The run has stopped on purpose. */
  | 'run_blocked'
  /** The action would touch live data or live users and has not earned it. */
  | 'unsafe_for_live'
  /** Quota is exhausted. Distinct from an error: nothing is broken. */
  | 'quota_exhausted'
  /** The call needs something only the user can supply, via the browser. */
  | 'needs_user_input';

export interface RefusalResponse {
  ok: false;
  reason: RefusalReason;
  /** Which gate stage rejected the work, when the reason is a gate. */
  gate?: Stage;
  /**
   * What is wrong, in the shape the producing agent can act on. Every field of
   * `GateError` is required precisely so this is actionable without a round trip.
   */
  failures: GateError[];
  /** Plain-English summary. The one field likely to be shown to a human. */
  message: string;
  context: ContextBlock;
  /** Refusals are never billed. Stated in the payload so the model can say so. */
  billed: false;
  /** The role brief for whoever must fix this. See `OkResponse.guidance`. */
  guidance?: string;
}

export type PowerResponse<T> = OkResponse<T> | RefusalResponse;

export function ok<T>(
  data: T,
  context: ContextBlock,
  options: { billed?: boolean; guidance?: string } = {},
): OkResponse<T> {
  return {
    ok: true,
    data,
    context,
    billed: options.billed ?? false,
    ...(options.guidance ? { guidance: options.guidance } : {}),
  };
}

export function refuse(
  reason: RefusalReason,
  message: string,
  context: ContextBlock,
  options: { gate?: Stage; failures?: GateError[]; guidance?: string } = {},
): RefusalResponse {
  return {
    ok: false,
    reason,
    ...(options.gate ? { gate: options.gate } : {}),
    failures: options.failures ?? [],
    message,
    context,
    billed: false,
    ...(options.guidance ? { guidance: options.guidance } : {}),
  };
}

export function isRefusal<T>(response: PowerResponse<T>): response is RefusalResponse {
  return response.ok === false;
}
