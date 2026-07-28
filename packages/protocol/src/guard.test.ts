import { apply, createRunState, type RunEvent, type RunState } from '@power/runstate';
import { describe, expect, it } from 'vitest';
import { buildContext } from './guidance.js';
import { guard } from './guard.js';
import { TOOLS, lookupTool } from './tools.js';

const pass = (stage: 'research' | 'spec' | 'verification'): RunEvent => ({
  type: 'gate_result',
  stage,
  result: { stage, pass: true, errors: [] },
});

function at(phase: 'spec' | 'build' | 'verify' | 'ready' | 'blocked'): RunState {
  let state = apply(createRunState('t1'), { type: 'research_skipped' });
  if (phase === 'spec') return state;
  if (phase === 'blocked') return apply(state, { type: 'block', reason: 'a human is needed' });

  state = apply(apply(state, pass('spec')), { type: 'spec_approved' });
  if (phase === 'build') return state;

  state = apply(apply(state, { type: 'self_verify', green: true }), {
    type: 'start_verification',
  });
  if (phase === 'verify') return state;

  return apply(state, pass('verification'));
}

const check = (
  toolName: string,
  state: RunState,
  opts: { targetEnv?: 'workbench' | 'live'; humanConfirmed?: boolean } = {},
) =>
  guard({
    toolName,
    state,
    context: buildContext({ projectId: 'p1', state }),
    ...opts,
  });

describe('unknown tools', () => {
  it('are refused rather than thrown', () => {
    const verdict = check('rm_minus_rf', at('build'));
    expect(verdict.allowed).toBe(false);
  });
});

describe('phase legality', () => {
  it('refuses writing before there is an approved plan', () => {
    const verdict = check('write_file', at('spec'));
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.refusal.reason).toBe('wrong_phase');
  });

  it('allows writing once the plan is approved', () => {
    expect(check('write_file', at('build')).allowed).toBe(true);
  });

  it('keeps reads legal in every phase', () => {
    for (const phase of ['spec', 'build', 'verify', 'blocked'] as const) {
      expect(check('read_file', at(phase)).allowed).toBe(true);
    }
  });

  it('explains what the run is waiting for instead of only saying no', () => {
    const state = apply(at('spec'), pass('spec'));
    const verdict = check('write_file', state);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.refusal.message).toMatch(/approve/i);
  });
});

describe('live safety', () => {
  it('refuses to let a workbench-only tool touch live', () => {
    const verdict = check('write_file', at('build'), { targetEnv: 'live', humanConfirmed: true });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.refusal.reason).toBe('unsafe_for_live');
  });

  it('requires a human for a live-capable tool, and says the chat cannot confirm it', () => {
    const verdict = check('publish_app', at('ready'), { targetEnv: 'live' });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.refusal.reason).toBe('needs_user_input');
      expect(verdict.refusal.message).toMatch(/browser/i);
    }
  });

  it('admits a confirmed publish once every condition holds', () => {
    expect(
      check('publish_app', at('ready'), { targetEnv: 'live', humanConfirmed: true }).allowed,
    ).toBe(true);
  });

  /**
   * The structural claim behind "the assistant cannot touch your live data".
   * It is a property of the registry, so it holds for tools not yet written.
   */
  it('exposes no tool that can write arbitrary SQL, anywhere', () => {
    expect(lookupTool('execute_sql')).toBeUndefined();
    const liveCapable = TOOLS.filter((t) => t.live_capable).map((t) => t.name);
    expect(liveCapable.sort()).toEqual(
      ['promote_migration', 'publish_app', 'rollback', 'unpublish_app'].sort(),
    );
  });
});

describe('publish conditions', () => {
  /**
   * Regression from the end-to-end run. Unverified AND unconfirmed: the useful
   * answer is "verify", not "go click confirm" — the browser has no confirm
   * button to click until the conditions hold.
   */
  it('asks for verification before it asks for a human', () => {
    const verdict = check('publish_app', at('verify'), { targetEnv: 'live' });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.refusal.reason).toBe('gate_not_satisfied');
  });

  it('refuses while verification has not passed', () => {
    const verdict = check('publish_app', at('verify'), {
      targetEnv: 'live',
      humanConfirmed: true,
    });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.refusal.reason).toBe('gate_not_satisfied');
      expect(verdict.refusal.message).toMatch(/verification/i);
    }
  });
});

describe('a blocked run', () => {
  it('refuses more building, and says not to retry', () => {
    const verdict = check('write_file', at('blocked'));
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.refusal.reason).toBe('run_blocked');
      expect(verdict.refusal.message).toMatch(/do not retry/i);
    }
  });

  it('still lets the user look at their work and take it elsewhere', () => {
    for (const tool of ['read_file', 'get_logs', 'export_project', 'restore_checkpoint']) {
      expect(check(tool, at('blocked')).allowed).toBe(true);
    }
  });
});

describe('a finished run', () => {
  it('admits start_run from done and blocked, and nowhere else', () => {
    let done = at('ready');
    done = apply(done, { type: 'published' });
    expect(check('start_run', done).allowed).toBe(true);
    expect(check('start_run', at('blocked')).allowed).toBe(true);
    expect(check('start_run', at('build')).allowed).toBe(false);
  });

  it('refuses new building on a done run until a new run starts', () => {
    const done = apply(at('ready'), { type: 'published' });
    const verdict = check('write_file', done);
    expect(verdict.allowed).toBe(false);
  });
});

describe('the refusal envelope', () => {
  it('is never billed, and always carries re-grounding context', () => {
    const verdict = check('write_file', at('spec'));
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.refusal.billed).toBe(false);
      expect(verdict.refusal.ok).toBe(false);
      expect(verdict.refusal.context.phase).toBe('spec');
      // The whole point: a refused model is told where to go next.
      expect(verdict.refusal.context.next_action?.tool).toBe('submit_spec');
    }
  });

  it('never bills a read', () => {
    expect(TOOLS.filter((t) => t.name.startsWith('read_')).every((t) => !t.metered)).toBe(true);
    expect(lookupTool('export_project')?.metered).toBe(false);
  });
});
