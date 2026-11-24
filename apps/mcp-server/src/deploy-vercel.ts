/**
 * The Vercel implementation of `Deployer`.
 *
 * Deliberately a thin, explicit HTTP client rather than the vendor SDK: the
 * surface used here is four endpoints, and owning the request shapes keeps the
 * error classification — which is the part that matters to a model — in one
 * readable place.
 *
 * The credential belongs to the person, not to Power. It never appears in a
 * thrown message, a log line or a returned object; `fetchJson` builds the
 * header and nothing else ever sees it.
 */
import {
  DeployError,
  sha1,
  type DeployCredential,
  type DeployRequest,
  type Deployer,
  type Deployment,
  type DeployTarget,
  type ReadyState,
} from './deploy.js';

/**
 * The API origin. Overridable so a local run can point at a stand-in and the
 * setup flow can be exercised end to end without a real account.
 */
const API = process.env.POWER_VERCEL_API_URL?.trim() || 'https://api.vercel.com';
const UPLOAD_CONCURRENCY = 8;
const REQUEST_TIMEOUT_MS = 30_000;

interface VercelDeployment {
  uid?: string;
  id?: string;
  url: string;
  readyState?: string;
  readySubstate?: string;
  target?: string | null;
  alias?: string[];
  createdAt?: number;
  inspectorUrl?: string;
}

export class VercelDeployer implements Deployer {
  readonly provider = 'vercel';
  readonly requiresCredential = true;

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async whoami(cred: DeployCredential): Promise<{ account: string }> {
    const body = await this.json<{ user?: { username?: string; email?: string } }>('GET', '/v2/user', cred);
    return { account: body.user?.username ?? body.user?.email ?? 'unknown' };
  }

  /** The team a credential is scoped to, which also proves the token can act in it. */
  async team(cred: DeployCredential & { teamId: string }): Promise<{ id: string; name: string; slug: string }> {
    // Accepts an id or a slug; the canonical id comes back and is what deploys use.
    const body = await this.json<{ id?: string; name?: string; slug?: string }>('GET', `/v2/teams/${encodeURIComponent(cred.teamId)}`, {
      token: cred.token,
      teamId: null,
    });
    return { id: body.id ?? cred.teamId, name: body.name ?? body.slug ?? cred.teamId, slug: body.slug ?? cred.teamId };
  }

  async create(req: DeployRequest, cred: DeployCredential): Promise<Deployment> {
    const uploads = req.files.map((f) => ({ path: f.path, bytes: f.bytes, sha: sha1(f.bytes) }));
    await this.uploadAll(uploads, cred);

    const payload: Record<string, unknown> = {
      name: req.projectName,
      files: uploads.map((f) => ({ file: f.path, sha: f.sha, size: f.bytes.length })),
      // A generated project is not a framework Vercel knows, and the default
      // detection returns a 400 asking for confirmation that nothing can give.
      projectSettings: { framework: null },
      ...(req.meta ? { meta: req.meta } : {}),
      ...(req.env ? { env: req.env, build: { env: req.env } } : {}),
    };
    // Omitted entirely for a preview: sending target:'preview' is not the same
    // as leaving it out.
    if (req.target === 'production') payload.target = 'production';

    const created = await this.json<VercelDeployment>(
      'POST',
      `/v13/deployments?skipAutoDetectionConfirmation=1`,
      cred,
      payload,
    );
    return toDeployment(created, req.target);
  }

  async get(id: string, cred: DeployCredential): Promise<Deployment> {
    const body = await this.json<VercelDeployment>('GET', `/v13/deployments/${encodeURIComponent(id)}`, cred);
    return toDeployment(body);
  }

  async waitForReady(id: string, cred: DeployCredential, budgetMs: number): Promise<Deployment> {
    const deadline = Date.now() + budgetMs;
    let last = await this.get(id, cred);
    while (!isTerminal(last.ready_state) && Date.now() < deadline) {
      // Tight at first, because most builds finish quickly and a person is
      // waiting; slower after, because by then it is a long build.
      await sleep(Date.now() < deadline - budgetMs + 30_000 ? 2000 : 5000);
      last = await this.get(id, cred);
    }
    return last;
  }

  async list(projectName: string, cred: DeployCredential, target: DeployTarget, limit = 10): Promise<Deployment[]> {
    const params = new URLSearchParams({ app: projectName, limit: String(limit), target });
    const body = await this.json<{ deployments: VercelDeployment[] }>('GET', `/v6/deployments?${params}`, cred);
    return (body.deployments ?? []).map((d) => toDeployment(d, target));
  }

  /** Promotion, not a rebuild: the previous build is already there. */
  async projectExists(projectName: string, cred: DeployCredential): Promise<boolean> {
    const response = await this.send('GET', `/v9/projects/${encodeURIComponent(projectName)}`, cred, {});
    if (response.status === 404) return false;
    if (!response.ok) throw await this.toError(response, 'GET /v9/projects');
    return true;
  }

  async promote(projectName: string, deploymentId: string, cred: DeployCredential): Promise<Deployment> {
    await this.json('POST', `/v10/projects/${encodeURIComponent(projectName)}/promote/${encodeURIComponent(deploymentId)}`, cred, {});
    return this.get(deploymentId, cred);
  }

  async remove(id: string, cred: DeployCredential): Promise<void> {
    await this.json('DELETE', `/v13/deployments/${encodeURIComponent(id)}`, cred);
  }

  /**
   * The tail of the build output. A build failure the model cannot read is one
   * it will retry blindly, so this is attached to the error rather than logged.
   */
  async buildLogs(id: string, cred: DeployCredential, limit = 40): Promise<string[]> {
    try {
      const events = await this.json<{ text?: string; payload?: { text?: string } }[]>(
        'GET',
        `/v2/deployments/${encodeURIComponent(id)}/events?builds=1&direction=backward&limit=100`,
        cred,
      );
      const lines = (Array.isArray(events) ? events : [])
        .map((e) => e.text ?? e.payload?.text ?? '')
        .filter(Boolean)
        .map((l) => l.replace(/\s+$/, ''));
      return lines.slice(-limit);
    } catch {
      // Logs are a nicety; failing to read them must not replace the real error.
      return [];
    }
  }

  // ---- transport

  private async uploadAll(files: { path: string; bytes: Buffer; sha: string }[], cred: DeployCredential): Promise<void> {
    const queue = [...files];
    const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, async () => {
      for (let next = queue.pop(); next; next = queue.pop()) {
        await this.uploadOne(next, cred);
      }
    });
    await Promise.all(workers);
  }

  /** Idempotent by SHA, so an unchanged republish uploads almost nothing. */
  private async uploadOne(file: { bytes: Buffer; sha: string }, cred: DeployCredential, attempt = 1): Promise<void> {
    const response = await this.send('POST', `/v2/files`, cred, {
      body: new Uint8Array(file.bytes),
      headers: { 'x-vercel-digest': file.sha, 'content-length': String(file.bytes.length) },
    });
    if (response.ok) return;
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
      return this.uploadOne(file, cred, attempt + 1);
    }
    throw await this.toError(response, 'uploading a file');
  }

  private async json<T>(method: string, path: string, cred: DeployCredential, body?: unknown): Promise<T> {
    const response = await this.send(method, path, cred, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
    });
    if (!response.ok) throw await this.toError(response, `${method} ${path.split('?')[0]}`);
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  private async send(
    method: string,
    path: string,
    cred: DeployCredential,
    init: { body?: Uint8Array | string; headers?: Record<string, string> },
  ): Promise<Response> {
    const url = new URL(path, API);
    if (cred.teamId) url.searchParams.set('teamId', cred.teamId);
    try {
      return await this.fetchImpl(url.href, {
        method,
        // The only place the credential is ever written.
        headers: { authorization: `Bearer ${cred.token}`, ...init.headers },
        body: init.body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new DeployError(`could not reach the hosting provider while ${method} ${path}: ${(error as Error).name}`, 'transport');
    }
  }

  private async toError(response: Response, what: string): Promise<DeployError> {
    const detail = await response.text().catch(() => '');
    const message = extractMessage(detail) ?? `${response.status} ${response.statusText}`;
    if (response.status === 401 || response.status === 403) {
      return new DeployError(
        `the hosting credential was rejected while ${what}: ${message}. Ask the user for a new token.`,
        'auth',
      );
    }
    if (response.status === 402 || response.status === 429) {
      return new DeployError(`the hosting account is over its limit while ${what}: ${message}`, 'quota');
    }
    if (response.status >= 500) {
      return new DeployError(`the hosting provider failed while ${what}: ${message}`, 'transport');
    }
    // Everything else in the 4xx range is a configuration problem and will not
    // get better on its own.
    return new DeployError(`${what} was rejected: ${message}`, 'config');
  }
}

function extractMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string };
    return parsed.error?.message ?? parsed.message ?? null;
  } catch {
    return body.slice(0, 200) || null;
  }
}

const TERMINAL: ReadyState[] = ['READY', 'ERROR', 'CANCELED'];
export const isTerminal = (state: ReadyState): boolean => TERMINAL.includes(state);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toDeployment(d: VercelDeployment, target?: DeployTarget): Deployment {
  const state = (d.readyState ?? d.readySubstate ?? 'QUEUED').toUpperCase();
  return {
    id: d.uid ?? d.id ?? '',
    url: d.url,
    aliases: d.alias ?? [],
    ready_state: (TERMINAL.includes(state as ReadyState) || ['QUEUED', 'INITIALIZING', 'BUILDING'].includes(state)
      ? state
      : 'QUEUED') as ReadyState,
    target: (d.target === 'production' ? 'production' : (target ?? 'preview')) as DeployTarget,
    created_at: new Date(d.createdAt ?? Date.now()).toISOString(),
    ...(d.inspectorUrl ? { inspector_url: d.inspectorUrl } : {}),
  };
}
