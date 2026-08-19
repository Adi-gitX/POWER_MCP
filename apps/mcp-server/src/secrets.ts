/**
 * Secrets: collected in the browser, injected at process start, never in chat.
 *
 * `request_secret` gives the model a URL and nothing else. The user opens it,
 * types the value into a form served by us, and the value goes into the store.
 * From then on the model knows the variable *name* and a fingerprint; the
 * value reaches the project only as an environment variable in the sandbox,
 * and only for the environment it was scoped to.
 *
 * Two things make this stronger than the pattern it copies:
 *
 *   • Per-environment. A Stripe test key in the workbench and a live key in
 *     production are different secrets with different scopes.
 *   • The scrubber. Every tool response and every log line passes through
 *     `scrub()` before it leaves the server, so an accidental
 *     `console.log(process.env)` in the user's app cannot leak a value back
 *     into the model's context.
 */
import { createHash, randomBytes } from 'node:crypto';

export type SecretEnv = 'workbench' | 'live' | 'both';

export interface SecretRecord {
  name: string;
  env: SecretEnv;
  /** Where it will be used, e.g. "stripe". Opens that host in the egress allowlist later. */
  provider: string | null;
  fingerprint: string;
  set_at: string;
}

export interface PendingRequest {
  token: string;
  project_id: string;
  name: string;
  env: SecretEnv;
  provider: string | null;
  why: string;
  expires_at: string;
}

const REQUEST_TTL_MS = 30 * 60 * 1000;
const ENV_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;

export interface SecretStore {
  request(req: Omit<PendingRequest, 'token' | 'expires_at'>): Promise<PendingRequest>;
  pending(token: string): Promise<PendingRequest | null>;
  /** Fulfil a request. Consumes the token. */
  set(token: string, value: string): Promise<SecretRecord>;
  list(projectId: string): Promise<SecretRecord[]>;
  /** Values for injection into a process. The only way values leave the store. */
  valuesFor(projectId: string, env: 'workbench' | 'live'): Promise<Record<string, string>>;
  /** Every value in the project, for the scrubber. */
  allValues(projectId: string): Promise<string[]>;
}

export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

export function validEnvName(name: string): boolean {
  return ENV_NAME.test(name);
}

export class MemorySecrets implements SecretStore {
  private pendingByToken = new Map<string, PendingRequest>();
  private records = new Map<string, Map<string, { record: SecretRecord; value: string }>>();

  async request(req: Omit<PendingRequest, 'token' | 'expires_at'>): Promise<PendingRequest> {
    const pending: PendingRequest = {
      ...req,
      token: randomBytes(24).toString('base64url'),
      expires_at: new Date(Date.now() + REQUEST_TTL_MS).toISOString(),
    };
    this.pendingByToken.set(pending.token, pending);
    setTimeout(() => this.pendingByToken.delete(pending.token), REQUEST_TTL_MS).unref();
    return pending;
  }

  async pending(token: string): Promise<PendingRequest | null> {
    const p = this.pendingByToken.get(token);
    if (!p || new Date(p.expires_at).getTime() < Date.now()) return null;
    return p;
  }

  async set(token: string, value: string): Promise<SecretRecord> {
    const p = await this.pending(token);
    if (!p) throw new Error('this secret request has expired or was already used');
    this.pendingByToken.delete(token);
    const record: SecretRecord = {
      name: p.name,
      env: p.env,
      provider: p.provider,
      fingerprint: fingerprint(value),
      set_at: new Date().toISOString(),
    };
    const byName = this.records.get(p.project_id) ?? new Map();
    byName.set(`${p.name}:${p.env}`, { record, value });
    this.records.set(p.project_id, byName);
    return record;
  }

  async list(projectId: string): Promise<SecretRecord[]> {
    return [...(this.records.get(projectId)?.values() ?? [])].map((r) => r.record);
  }

  async valuesFor(projectId: string, env: 'workbench' | 'live'): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const { record, value } of this.records.get(projectId)?.values() ?? []) {
      if (record.env === env || record.env === 'both') out[record.name] = value;
    }
    return out;
  }

  async allValues(projectId: string): Promise<string[]> {
    return [...(this.records.get(projectId)?.values() ?? [])].map((r) => r.value);
  }
}

/**
 * Replace every known secret value in `text`. Values shorter than 8 characters
 * are not scrubbed — a 4-character "secret" would redact ordinary words, and
 * nothing that short is a credential worth the name.
 */
export function scrub(text: string, values: readonly string[]): string {
  let out = text;
  for (const value of values) {
    if (value.length < 8) continue;
    out = out.split(value).join(`[redacted:${fingerprint(value)}]`);
  }
  return out;
}

/** Deep-scrub any JSON-serialisable payload. */
export function scrubDeep<T>(payload: T, values: readonly string[]): T {
  if (values.every((v) => v.length < 8)) return payload;
  return JSON.parse(scrub(JSON.stringify(payload), values)) as T;
}
