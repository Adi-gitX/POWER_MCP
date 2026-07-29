/**
 * Deriving `next_action`.
 *
 * Every refusal carries a concrete next call, and this is where it comes from.
 * The rule is that `next_action` is always computed from persisted state, never
 * remembered from the previous request — a stateless node must produce the same
 * answer regardless of which node handled the last call, and a client that has
 * lost its context must be able to recover with a single `get_next_action`.
 *
 * There is a deliberate asymmetry in the guidance: when a gate fails we point at
 * the artifact, not at the gate. A model told "verification failed" tends to
 * re-run verification; a model told "fix R3, then submit verification.json
 * again" fixes R3. The failures themselves travel in `failures[]`, so the action
 * only has to name the destination.
 */
import type { GateError } from '@power/gates';
import {
  FEEDBACK_EDGES,
  canPublish,
  phaseLabel,
  retriesRemaining,
  type FeedbackEdge,
  type RunState,
} from '@power/runstate';
import type { ContextBlock, NextAction } from './envelope.js';

/** The role the client's model should adopt for the current phase. */
export function roleForPhase(state: RunState): string | null {
  switch (state.phase) {
    case 'research':
      return 'researcher';
    case 'spec':
      return 'architect';
    case 'build':
      return 'implementer';
    case 'verify':
      return 'verifier';
    default:
      return null;
  }
}

export function nextAction(state: RunState): NextAction | null {
  switch (state.phase) {
    case 'intake':
      return {
        tool: 'create_project',
        args: {},
        why: 'No project exists yet for this run.',
      };

    case 'research':
      return {
        tool: 'submit_research',
        args: { research: '<research.json contents>' },
        why: 'Research findings must pass the research gate before a plan can be written.',
      };

    case 'research_review':
      return {
        tool: 'submit_spec',
        args: { spec: '<SPEC.md contents>' },
        why: 'Research passed. Write the plan it supports.',
      };

    case 'spec':
      return {
        tool: 'submit_spec',
        args: { spec: '<SPEC.md contents>' },
        why: 'The plan must pass the spec gate before any code is written.',
      };

    case 'spec_approval':
      return {
        tool: 'request_spec_approval',
        args: {},
        why: 'The plan passed its gate and now needs a human decision. Only a person can clear this.',
      };

    case 'build':
      // Self-verification is the implementer's own gate on itself, and it is a
      // publish condition. Until it is green, more editing is not the next step.
      return state.self_verify_green
        ? {
            tool: 'submit_verification',
            args: { verification: '<verification.json contents>' },
            why: 'The build reports green. Verify it against the plan with fresh eyes.',
          }
        : {
            tool: 'run_tests',
            args: {},
            why: 'The build has not been checked yet. Typecheck and test before verifying.',
          };

    case 'verify': {
      const decision = canPublish(state);
      if (state.gates.verification !== 'pass') {
        return {
          tool: 'submit_verification',
          args: { verification: '<verification.json contents>' },
          why: 'Verification has not passed its gate yet.',
        };
      }
      return decision.allowed
        ? { tool: 'publish_app', args: {}, why: 'All three publish conditions are satisfied.' }
        : null;
    }

    case 'done':
      return {
        tool: 'start_run',
        args: { goal: '<what to build or change next>' },
        why: 'This run shipped. Further changes begin a new run, planned and verified like the first.',
      };

    case 'blocked':
      return null;
  }
}

/**
 * Every unresolved gate failure, across stages.
 *
 * Carried on every response because a model that has been bounced twice tends to
 * fix only the failure it saw most recently. Showing the full open set on each
 * call is what stops a run oscillating between two defects until it exhausts its
 * retry budget and blocks.
 */
export function openFailures(
  state: RunState,
  lastErrors: Partial<Record<string, GateError[]>>,
): GateError[] {
  const open: GateError[] = [];
  for (const [stage, status] of Object.entries(state.gates)) {
    if (status === 'fail') open.push(...(lastErrors[stage] ?? []));
  }
  return open;
}

export function loopsRemaining(state: RunState): Record<FeedbackEdge, number> {
  const out = {} as Record<FeedbackEdge, number>;
  for (const edge of FEEDBACK_EDGES) out[edge] = retriesRemaining(state, edge);
  return out;
}

export function buildContext(args: {
  projectId: string;
  state: RunState;
  env?: 'workbench' | 'live';
  lastErrors?: Partial<Record<string, GateError[]>>;
}): ContextBlock {
  const { projectId, state, env = 'workbench', lastErrors = {} } = args;
  return {
    project_id: projectId,
    run_id: state.trace_id,
    phase: state.phase,
    phase_label: phaseLabel(state.phase),
    env,
    open_gate_failures: openFailures(state, lastErrors),
    loops_remaining: loopsRemaining(state),
    next_action: nextAction(state),
    ...(state.blocked_reason ? { blocked_reason: state.blocked_reason } : {}),
  };
}
