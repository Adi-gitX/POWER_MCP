import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { researchSchema, specFrontmatterSchema, verificationSchema } from './schemas.js';
import { lintSpecBody, parseSpec } from './spec.js';
import { STAGES, isStage, type GateError, type GateResult, type Stage } from './types.js';

export * from './types.js';
export { REQUIRED_SECTIONS, lintSpecBody, parseSpec } from './spec.js';
export type { ParsedSpec } from './spec.js';

const ajv = new Ajv2020({ allErrors: true, strict: true });

// A source has to be something an agent could actually have fetched, so `uri`
// here means an absolute http(s) URL — narrower than RFC 3986 on purpose. This
// rejects `mailto:`, bare domains, and relative paths, all of which are shapes a
// fabricated citation tends to take.
ajv.addFormat('uri', /^https?:\/\/[^\s/$.?#][^\s]*$/);

const validators = {
  research: ajv.compile(researchSchema) as ValidateFunction,
  specFrontmatter: ajv.compile(specFrontmatterSchema) as ValidateFunction,
  verification: ajv.compile(verificationSchema) as ValidateFunction,
};

/**
 * Resolve the value Ajv's `instancePath` points at, so an error can quote what
 * the model actually wrote — the difference between a retry that converges and
 * one that guesses again at the same broken value.
 */
function valueAt(data: unknown, instancePath: string): unknown {
  if (!instancePath) return undefined;
  const parts = instancePath
    .split('/')
    .slice(1)
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur: unknown = data;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Turn Ajv output into gate errors that name the artifact and the offending path. */
function schemaErrors(artifact: string, validate: ValidateFunction, data: unknown): GateError[] {
  if (validate(data)) return [];
  return (validate.errors ?? []).map((error) => {
    const params =
      error.params && Object.keys(error.params).length > 0
        ? ` (${JSON.stringify(error.params)})`
        : '';
    // Quote the actual offending value for scalar leaves — a pattern/enum/type
    // failure is only fixable if the retry can see what it wrote.
    const found = valueAt(data, error.instancePath);
    const shown =
      found !== undefined && (typeof found !== 'object' || found === null)
        ? ` — found ${JSON.stringify(found)}`
        : '';
    return {
      artifact,
      field: error.instancePath === '' ? '(root)' : error.instancePath.replace(/^\//, ''),
      rule: `schema.${error.keyword}`,
      detail: `${error.message ?? 'failed schema validation'}${params}${shown}`,
    };
  });
}

function parseJson(artifact: string, raw: string): { data: unknown } | { error: GateError } {
  try {
    return { data: JSON.parse(raw) };
  } catch (cause) {
    return {
      error: {
        artifact,
        field: '(root)',
        rule: 'json.invalid',
        detail: `Not valid JSON: ${(cause as Error).message}`,
      },
    };
  }
}

function missing(artifact: string): GateError {
  return {
    artifact,
    field: '(file)',
    rule: 'artifact.missing',
    detail: `${artifact} was not produced. The stage cannot pass without it.`,
  };
}

/** Collect every `source_url` anywhere in the research document. */
function collectSourceUrls(value: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectSourceUrls(item, found);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'source_url' && typeof child === 'string') found.add(child);
      else collectSourceUrls(child, found);
    }
  }
  return found;
}

function gateResearch(raw: string | undefined): GateError[] {
  if (raw === undefined) return [missing('research.json')];
  const parsed = parseJson('research.json', raw);
  if ('error' in parsed) return [parsed.error];

  const errors = schemaErrors('research.json', validators.research, parsed.data);
  if (errors.length > 0) return errors;

  const document = parsed.data as {
    sources: { url: string }[];
    unknowns_resolved: { question: string; resolved: boolean; source_url?: string }[];
  };

  // Cross-field: a claim may not cite a source the bibliography does not list.
  // This is what catches an invented URL that happens to be well-formed.
  const listed = new Set(document.sources.map((source) => source.url));
  for (const url of collectSourceUrls(document)) {
    if (!listed.has(url)) {
      errors.push({
        artifact: 'research.json',
        field: 'sources',
        rule: 'sources.unlisted',
        detail: `${url} is cited but does not appear in sources[]. Every cited URL must be listed with its tier.`,
      });
    }
  }

  // A resolved unknown must say where the answer came from.
  for (const [index, unknown] of document.unknowns_resolved.entries()) {
    if (unknown.resolved && !unknown.source_url) {
      errors.push({
        artifact: 'research.json',
        field: `unknowns_resolved/${index}`,
        rule: 'sources.unsourced_claim',
        detail: `"${unknown.question.slice(0, 60)}" is marked resolved but carries no source_url.`,
      });
    }
  }

  return errors;
}

function gateSpec(raw: string | undefined): GateError[] {
  if (raw === undefined) return [missing('SPEC.md')];

  const parsed = parseSpec(raw);
  if ('rule' in parsed) return [parsed];

  const errors = schemaErrors('SPEC.md', validators.specFrontmatter, parsed.frontmatter);
  if (errors.length > 0) return errors;

  const frontmatter = parsed.frontmatter as { requirement_ids: string[] };
  return lintSpecBody(parsed.body, frontmatter.requirement_ids);
}

const VISUAL_SCORE_BAR = 3.5;

function gateVerification(raw: string | undefined): GateError[] {
  if (raw === undefined) return [missing('verification.json')];
  const parsed = parseJson('verification.json', raw);
  if ('error' in parsed) return [parsed.error];

  const errors = schemaErrors('verification.json', validators.verification, parsed.data);
  if (errors.length > 0) return errors;

  const report = parsed.data as {
    pass: boolean;
    visual_score: number;
    criteria: {
      id: string;
      result: string;
      priority: string;
      verified_by_interaction?: boolean;
    }[];
  };

  // A green build is not a pass: `pass: true` is only allowed when every P0
  // criterion was actually verified by interaction and the visual bar is met.
  if (report.pass) {
    const p0 = report.criteria.filter((c) => c.priority === 'P0');

    if (p0.length === 0) {
      errors.push({
        artifact: 'verification.json',
        field: 'criteria',
        rule: 'verification.no_p0',
        detail: 'pass is true but no P0 criteria were checked.',
      });
    }

    for (const criterion of p0) {
      if (criterion.result !== 'pass') {
        errors.push({
          artifact: 'verification.json',
          field: criterion.id,
          rule: 'verification.p0_failed',
          detail: `pass is true but P0 criterion ${criterion.id} is recorded as ${criterion.result}.`,
        });
      }
      if (criterion.verified_by_interaction === false) {
        errors.push({
          artifact: 'verification.json',
          field: criterion.id,
          rule: 'verification.not_interacted',
          detail: `P0 criterion ${criterion.id} was not verified by interaction. A page you only screenshotted is half-checked.`,
        });
      }
    }

    if (report.visual_score < VISUAL_SCORE_BAR) {
      errors.push({
        artifact: 'verification.json',
        field: 'visual_score',
        rule: 'verification.below_visual_bar',
        detail: `pass is true but visual_score is ${report.visual_score}, below the bar of ${VISUAL_SCORE_BAR}.`,
      });
    }
  }

  return errors;
}

/** Raw contents of the artifacts for a run, keyed by filename. */
export type Artifacts = Partial<Record<'research.json' | 'SPEC.md' | 'verification.json', string>>;

export function runGate(stage: Stage, artifacts: Artifacts): GateResult {
  const startedAt = Date.now();
  const errors =
    stage === 'research'
      ? gateResearch(artifacts['research.json'])
      : stage === 'spec'
        ? gateSpec(artifacts['SPEC.md'])
        : gateVerification(artifacts['verification.json']);

  return {
    stage,
    pass: errors.length === 0,
    errors,
    durationMs: Date.now() - startedAt,
    evaluatedAt: new Date().toISOString(),
  };
}

export { STAGES, isStage };

export {
  analyseMigration,
  judgeMigration,
  touchedTables,
  type MigrationProposal,
  type MigrationVerdict,
  type Rehearsal,
} from './migration.js';
