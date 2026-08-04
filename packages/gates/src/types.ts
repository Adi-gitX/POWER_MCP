/**
 * Pipeline stages that have a gate. Review and test are gated by their own
 * agents' reports rather than by a schema, so they are deliberately absent —
 * a stage listed here but not implemented would pass silently, which is the
 * failure mode this whole layer exists to prevent.
 */
export const STAGES = ['research', 'spec', 'verification'] as const;
export type Stage = (typeof STAGES)[number];

/**
 * One gate failure. Every field is required because a vague gate error costs a
 * whole fix cycle — the producing agent must be able to act without asking.
 *
 * In the hosted server this shape crosses the wire as the `failures[]` of an
 * MCP refusal envelope, so it is read by a model we do not control. That is why
 * `detail` must say what would satisfy the rule, not merely what is wrong.
 */
export interface GateError {
  /** The artifact that failed, e.g. `SPEC.md`. */
  artifact: string;
  /** Where in the artifact, e.g. `R3` or `frontmatter.requirement_ids`. */
  field: string;
  /** Stable machine-readable rule id, e.g. `ears.missing`. */
  rule: string;
  /** What is wrong and what would satisfy the rule. */
  detail: string;
}

export interface GateResult {
  stage: Stage;
  pass: boolean;
  errors: GateError[];
  durationMs?: number;
  evaluatedAt?: string;
}

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value);
}
