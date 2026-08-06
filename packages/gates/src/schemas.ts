/**
 * The gate schemas, inlined rather than read from a `schemas/` directory.
 *
 * The local product loaded these with `readFileSync` relative to `import.meta.url`.
 * That breaks the moment the server is bundled or shipped in a slim container, and
 * a gate that cannot load its own schema fails open — the exact failure this layer
 * exists to prevent. Inlining makes the schema a compile-time artifact.
 */

export const researchSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'power/research.schema.json',
  title: 'research.json',
  description:
    'Sourced findings from the research stage. Every claim carries a source_url that also appears in sources[].',
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'unknowns_resolved', 'prior_art', 'users', 'feasibility', 'sources'],
  properties: {
    summary: { type: 'string', minLength: 40 },
    unknowns_resolved: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'answer', 'resolved'],
        properties: {
          question: { type: 'string', minLength: 8 },
          answer: { type: 'string', minLength: 8 },
          resolved: { type: 'boolean' },
          source_url: { type: 'string', format: 'uri' },
        },
      },
    },
    prior_art: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'url', 'gaps'],
        properties: {
          name: { type: 'string', minLength: 1 },
          url: { type: 'string', format: 'uri' },
          strengths: { type: 'array', items: { type: 'string' } },
          gaps: { type: 'array', minItems: 1, items: { type: 'string' } },
        },
      },
    },
    users: {
      type: 'object',
      additionalProperties: false,
      required: ['pain_points'],
      properties: {
        pain_points: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['point', 'severity', 'source_url'],
            properties: {
              point: { type: 'string', minLength: 8 },
              severity: { enum: ['high', 'medium', 'low'] },
              evidence: { type: 'string' },
              source_url: { type: 'string', format: 'uri' },
            },
          },
        },
      },
    },
    feasibility: {
      type: 'object',
      additionalProperties: false,
      required: ['constraints'],
      properties: {
        constraints: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['constraint', 'impact', 'source_url'],
            properties: {
              constraint: { type: 'string', minLength: 8 },
              impact: { type: 'string', minLength: 8 },
              source_url: { type: 'string', format: 'uri' },
            },
          },
        },
      },
    },
    open_questions: { type: 'array', items: { type: 'string' } },
    sources: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['url', 'tier'],
        properties: {
          url: { type: 'string', format: 'uri' },
          title: { type: 'string' },
          tier: { enum: ['primary', 'secondary', 'vendor'] },
          accessed: { type: 'string' },
        },
      },
    },
  },
} as const;

export const specFrontmatterSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'power/spec-frontmatter.schema.json',
  title: 'SPEC.md frontmatter',
  description:
    'Validates only the YAML frontmatter. The body is linted separately, because the interesting rules are traceability rules a schema cannot express.',
  type: 'object',
  additionalProperties: false,
  required: ['product', 'primary_persona', 'requirement_ids', 'approved'],
  properties: {
    product: { type: 'string', minLength: 4 },
    primary_persona: { type: 'string', minLength: 2 },
    requirement_ids: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', pattern: '^R[0-9]+$' },
    },
    approved: {
      type: 'boolean',
      description: 'The server flips this to true at the human approval gate.',
    },
  },
} as const;

export const verificationSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'power/verification.schema.json',
  title: 'verification.json',
  description:
    'The fresh-context acceptance verdict. `pass` is cross-checked against per-criterion results and the visual score by the gate.',
  type: 'object',
  additionalProperties: false,
  required: ['pass', 'visual_score', 'criteria', 'issues', 'summary'],
  properties: {
    pass: { type: 'boolean' },
    visual_score: { type: 'number', minimum: 1, maximum: 5 },
    criteria: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'result', 'observation', 'priority'],
        properties: {
          id: { type: 'string', pattern: '^R[0-9]+$' },
          result: { enum: ['pass', 'fail'] },
          priority: { enum: ['P0', 'P1', 'P2'] },
          observation: {
            type: 'string',
            minLength: 20,
            description: 'What was done and what happened. Not a restatement of the requirement.',
          },
          verified_by_interaction: { type: 'boolean' },
        },
      },
    },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'where', 'problem', 'expected'],
        properties: {
          severity: { enum: ['blocker', 'major', 'minor'] },
          where: { type: 'string', minLength: 1 },
          problem: { type: 'string', minLength: 10 },
          expected: { type: 'string', minLength: 10 },
          fix_hint: { type: 'string' },
        },
      },
    },
    summary: { type: 'string', minLength: 20 },
  },
} as const;
