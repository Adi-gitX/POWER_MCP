/**
 * The guard: the one place a tool call is admitted or refused.
 *
 * Every handler runs behind this. Centralising it is what lets the invariant
 * "an agent cannot argue with a gate" be a property of the system rather than a
 * discipline each handler has to remember — a check that lives in forty handlers
 * is a check that is missing from one of them.
 *
 * Order matters here, and it is not arbitrary. The checks run cheapest-first and
 * most-final-first, so the refusal a model sees is the one most likely to move
 * the run forward:
 *
 *   1. Unknown tool        — nothing else can be evaluated.
 *   2. Run blocked         — the run has stopped on purpose; nothing but
 *                            recovery should succeed, and retrying is wrong.
 *   3. Live capability     — the narrowest door. Checked before phase, because
 *                            "this tool may never touch production" is a
 *                            stronger and more useful statement than "wrong
 *                            phase".
 *   4. Phase legality      — the tool exists but not here, yet.
 *   5. Publish conditions  — the three independent conditions.
 *   6. Human confirmation  — asked for LAST, only once the work has earned it.
 *                            The browser offers the confirm button only when
 *                            the conditions hold, so asking earlier would send
 *                            the user to a page with nothing to click. Found by
 *                            the end-to-end run, not the unit tests.
 *
 * Quota is deliberately NOT checked here. It is enforced by the metering layer
 * around the guard, because a refusal must never be billed and the reservation
 * has to be released when the guard says no.
 */
import { canPublish, type RunState } from '@power/runstate';
import type { ContextBlock, RefusalResponse } from './envelope.js';
import { refuse } from './envelope.js';
import { isLegalInPhase, lookupTool, type ToolSpec } from './tools.js';

export interface GuardInput {
  toolName: string;
  state: RunState;
  context: ContextBlock;
  /** Which environment this call is asking to act on. Defaults to the workbench. */
  targetEnv?: 'workbench' | 'live';
  /** Set by the web companion when a human has cleared a live-affecting action. */
  humanConfirmed?: boolean;
}

export type GuardVerdict = { allowed: true; tool: ToolSpec } | { allowed: false; refusal: RefusalResponse };

export function guard(input: GuardInput): GuardVerdict {
  const { toolName, state, context, targetEnv = 'workbench', humanConfirmed = false } = input;

  const tool = lookupTool(toolName);
  if (!tool) {
    return {
      allowed: false,
      refusal: refuse('wrong_phase', `There is no tool called ${toolName}.`, context),
    };
  }

  // ---- 2. A blocked run has already spent its retry budget. The whole point of
  // blocking is that continuing is not the answer, so we say so explicitly
  // rather than letting the model discover it one refused call at a time.
  if (state.phase === 'blocked' && !isRecoveryTool(tool)) {
    return {
      allowed: false,
      refusal: refuse(
        'run_blocked',
        `This run stopped and needs a person. ${state.blocked_reason ?? ''} ` +
          `Do not retry — either restore an earlier checkpoint or ask the user how to proceed.`,
        context,
      ),
    };
  }

  // ---- 3. Live capability. The registry, not the handler, decides what may
  // ever reach production.
  if (targetEnv === 'live' && !tool.live_capable) {
    return {
      allowed: false,
      refusal: refuse(
        'unsafe_for_live',
        `${tool.name} can only act on the workbench. Nothing the assistant writes ` +
          `reaches the live app or its data except through publish_app, which requires ` +
          `verification to have passed.`,
        context,
      ),
    };
  }

  // ---- 4. Phase legality.
  if (!isLegalInPhase(tool, state.phase)) {
    return {
      allowed: false,
      refusal: refuse(
        'wrong_phase',
        `${tool.name} is not available while the run is at "${context.phase_label}". ` +
          `${describeExpectation(state)}`,
        context,
      ),
    };
  }

  // ---- 5. The three publish conditions. A green build is not a pass.
  if (tool.name === 'publish_app') {
    const decision = canPublish(state);
    if (!decision.allowed) {
      return {
        allowed: false,
        refusal: refuse(
          state.approved_spec ? 'gate_not_satisfied' : 'awaiting_human_approval',
          `Not ready to publish: ${decision.missing.join('; ')}.`,
          context,
          { gate: 'verification' },
        ),
      };
    }
  }

  // ---- 6. Even a live-capable tool whose conditions hold needs a human behind
  // it — and only now is it worth asking them.
  if (targetEnv === 'live' && !humanConfirmed) {
    return {
      allowed: false,
      refusal: refuse(
        'needs_user_input',
        `${tool.name} changes the live app, so it needs the user's confirmation in the ` +
          `browser. It cannot be confirmed through this conversation.`,
        context,
      ),
    };
  }

  return { allowed: true, tool };
}

/**
 * Tools that remain available to a blocked run.
 *
 * A blocked run is not a dead run: the user can still look at what happened,
 * take their code elsewhere, or roll back. Reading and exporting must never be
 * collateral damage of a stopped pipeline.
 */
function isRecoveryTool(tool: ToolSpec): boolean {
  return (
    !tool.metered ||
    tool.name === 'restore_checkpoint' ||
    tool.name === 'rollback' ||
    // Starting the next run is how a blocked project moves on.
    tool.name === 'start_run'
  );
}

function describeExpectation(state: RunState): string {
  if (state.phase === 'spec_approval') {
    return 'The plan is waiting for the user to approve it; nothing can be built until they do.';
  }
  if (state.phase === 'build' && !state.self_verify_green) {
    return 'Finish the build and get its own checks green first.';
  }
  return 'Call get_next_action to see the step this run expects.';
}
