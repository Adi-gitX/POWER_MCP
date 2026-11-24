import { describe, expect, it } from 'vitest';
import { MAX_RETRIES, type RunEvent, type RunState, StateError, apply, canPublish, createRunState, modeOf, parseRunState, retriesRemaining, systemClock } from './index.js';

type GatedStage = 'research' | 'spec' | 'verification';

const pass = (stage: GatedStage): RunEvent => ({
  type: 'gate_result',
  stage,
  result: { stage, pass: true, errors: [] },
});

const fail = (stage: GatedStage): RunEvent => ({
  type: 'gate_result',
  stage,
  result: {
    stage,
    pass: false,
    errors: [{ artifact: 'x', field: 'y', rule: 'z', detail: 'nope' }],
  },
});

/** Drive a fresh run to the point where the spec has passed its gate. */
function throughSpec(): RunState {
  let state = createRunState('t1');
  state = apply(state, { type: 'research_skipped' });
  return apply(state, pass('spec'));
}

describe('phase transitions', () => {
  it('refuses a move that is not on the allowed list', () => {
    const state = createRunState('t1');
    // intake -> build would skip research, spec, and the human approval gate.
    expect(() => apply(state, { type: 'build_started' })).toThrow(StateError);
  });

  it('records skipped research honestly rather than as a pass', () => {
    const state = apply(createRunState('t1'), { type: 'research_skipped' });
    expect(state.gates.research).toBe('skipped');
    expect(state.phase).toBe('spec');
  });

  it('keeps a failed gate in the same phase so the artifact can be fixed', () => {
    const state = apply(apply(createRunState('t1'), { type: 'research_skipped' }), fail('spec'));
    expect(state.gates.spec).toBe('fail');
    expect(state.phase).toBe('spec');
  });

  it('rests in verify once verification passes — a run is done when it ships', () => {
    let state = throughSpec();
    state = apply(state, { type: 'spec_approved' });
    state = apply(state, { type: 'self_verify', green: true });
    state = apply(state, { type: 'start_verification' });
    state = apply(state, pass('verification'));
    expect(state.phase).toBe('verify');
    expect(state.gates.verification).toBe('pass');
    expect(canPublish(state).allowed).toBe(true);
  });

  it('refuses events once the run is done', () => {
    let state = throughSpec();
    state = apply(state, { type: 'spec_approved' });
    state = apply(state, { type: 'self_verify', green: true });
    state = apply(state, { type: 'start_verification' });
    state = apply(state, pass('verification'));
    state = apply(state, { type: 'published' });
    expect(state.phase).toBe('done');
    expect(() => apply(state, { type: 'build_started' })).toThrow(/already done/);
  });

  it('cannot be driven to done without every publish condition', () => {
    let state = apply(throughSpec(), { type: 'spec_approved' });
    state = apply(state, { type: 'self_verify', green: true });
    state = apply(state, { type: 'start_verification' });
    // Verification never passed its gate.
    expect(() => apply(state, { type: 'published' })).toThrow(/cannot mark published/);
  });
});

describe('approval is a decision about content, not an override', () => {
  it('refuses to approve a spec that has not passed its gate', () => {
    const state = apply(createRunState('t1'), { type: 'research_skipped' });
    expect(() => apply(state, { type: 'spec_approved' })).toThrow(/structural defect/);
  });

  it('allows approval once the gate has passed', () => {
    const state = apply(throughSpec(), { type: 'spec_approved' });
    expect(state.approved_spec).toBe(true);
    expect(state.phase).toBe('build');
  });
});

describe('bounded retries', () => {
  it('blocks rather than looping once an edge is exhausted', () => {
    let state = apply(throughSpec(), { type: 'spec_approved' });
    for (let i = 0; i < MAX_RETRIES; i++) {
      state = apply(state, { type: 'retry', edge: 'needs_fixes', reason: `attempt ${i}` });
      expect(state.phase).toBe('build');
    }
    state = apply(state, { type: 'retry', edge: 'needs_fixes', reason: 'one too many' });
    expect(state.phase).toBe('blocked');
    expect(state.blocked_reason).toContain('exceeded');
  });

  it('reports remaining retries without going negative', () => {
    let state = apply(throughSpec(), { type: 'spec_approved' });
    expect(retriesRemaining(state, 'needs_fixes')).toBe(MAX_RETRIES);
    state = apply(state, { type: 'retry', edge: 'needs_fixes', reason: 'x' });
    expect(retriesRemaining(state, 'needs_fixes')).toBe(MAX_RETRIES - 1);
  });
});

describe('publish conditions', () => {
  it('requires all three, and names every missing one at once', () => {
    const decision = canPublish(createRunState('t1'));
    expect(decision.allowed).toBe(false);
    expect(decision.missing).toHaveLength(3);
  });

  it('a green build alone is not a pass', () => {
    let state = apply(throughSpec(), { type: 'spec_approved' });
    state = apply(state, { type: 'self_verify', green: true });
    const decision = canPublish(state);
    expect(decision.allowed).toBe(false);
    expect(decision.missing.join(' ')).toContain('verification');
  });

  it('allows publishing only with approval, green checks, and a passed gate', () => {
    let state = apply(throughSpec(), { type: 'spec_approved' });
    state = apply(state, { type: 'self_verify', green: true });
    state = apply(state, { type: 'start_verification' });
    state = apply(state, pass('verification'));
    expect(canPublish(state).allowed).toBe(true);
  });
});

describe('persistence', () => {
  it('round-trips through JSON, since every request reloads the row', () => {
    const state = throughSpec();
    expect(parseRunState(JSON.stringify(state))).toEqual(state);
  });

  it('fails loudly on a corrupt row rather than guessing', () => {
    expect(() => parseRunState('{')).toThrow(/not valid JSON/);
    expect(() => parseRunState('{"version":2}')).toThrow(/unsupported/);
    expect(() => parseRunState('{"version":1,"phase":"nonsense"}')).toThrow(/unknown phase/);
  });
});

describe('run modes', () => {
  const green = (s: RunState) => apply(s, { type: 'self_verify', green: true });

  it('defaults to the full pipeline, so existing callers keep every gate', () => {
    expect(modeOf(createRunState('t1'))).toBe('power_up');
    // A run stored before modes existed has no mode field at all.
    const legacy = { ...createRunState('t0') } as RunState;
    delete legacy.mode;
    expect(modeOf(legacy)).toBe('power_up');
  });

  it('fast-tracks a standard run to the build, recording every stage as skipped', () => {
    const s = apply(createRunState('t2', systemClock, 'standard'), { type: 'fast_track' });
    expect(s.phase).toBe('build');
    expect(s.gates).toEqual({ research: 'skipped', spec: 'skipped', verification: 'skipped' });
    expect(s.approved_spec).toBe(false);
  });

  it('refuses to fast-track a Power Up run', () => {
    expect(() => apply(createRunState('t3'), { type: 'fast_track' })).toThrow(StateError);
  });

  it('still refuses intake -> build for any other event, in either mode', () => {
    expect(() => apply(createRunState('t4', systemClock, 'standard'), { type: 'build_started' })).toThrow(StateError);
  });

  it('lets a standard run publish from the build once its own checks are green', () => {
    const built = apply(createRunState('t5', systemClock, 'standard'), { type: 'fast_track' });
    expect(canPublish(built)).toEqual({ allowed: false, missing: ["the implementer's own checks are not green"] });
    const done = apply(green(built), { type: 'published' });
    expect(done.phase).toBe('done');
  });

  it('keeps all three conditions for a Power Up run, and no publishing from the build', () => {
    let s = apply(createRunState('t6'), { type: 'research_skipped' });
    s = apply(s, { type: 'gate_result', stage: 'spec', result: { stage: 'spec', pass: true, errors: [] } as never });
    s = green(apply(s, { type: 'spec_approved' }));
    expect(s.phase).toBe('build');
    expect(canPublish(s).missing).toEqual(['verification has not passed its gate']);
    expect(() => apply(s, { type: 'published' })).toThrow(StateError);
  });
});
