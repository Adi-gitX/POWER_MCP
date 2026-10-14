import { describe, expect, it } from 'vitest';
import { collectRelease, DeployError, deployProjectName, sha1, type DeployCredential } from './deploy.js';
import { VercelDeployer } from './deploy-vercel.js';
import type { Sandbox, SandboxFile } from './sandbox.js';

const CRED: DeployCredential = { token: 'tok_secret_value', teamId: null };

/** Records every request so a test can assert on shape without a network. */
function stubFetch(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const impl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('project names', () => {
  it('are derived from the slug and always valid', () => {
    expect(deployProjectName('My Barber Shop!')).toBe('my-barber-shop');
    expect(deployProjectName('---')).toBe('power-app');
    expect(deployProjectName('a'.repeat(200))).toHaveLength(100);
  });
});

describe('collecting a release', () => {
  const sandbox = (files: SandboxFile[], read: (p: string) => Buffer): Sandbox =>
    ({
      filesAt: async () => files,
      readAt: async (_p: string, _r: string, path: string) => read(path),
    }) as unknown as Sandbox;

  it('reads the committed files at the tag', async () => {
    const s = sandbox(
      [
        { path: 'index.html', size: 5 },
        { path: 'app.js', size: 3 },
      ],
      (p) => Buffer.from(p === 'index.html' ? 'hello' : 'abc'),
    );
    const files = await collectRelease(s, 'p1', 'v1');
    expect(files.map((f) => f.path)).toEqual(['index.html', 'app.js']);
    expect(files[0]!.bytes.toString()).toBe('hello');
  });

  it('refuses an empty release rather than deploying nothing', async () => {
    await expect(collectRelease(sandbox([], () => Buffer.alloc(0)), 'p1', 'v1')).rejects.toThrow(/no files/);
  });

  it('names the files that are too large, so the model can act', async () => {
    const s = sandbox([{ path: 'huge.bin', size: 50 }], () => Buffer.alloc(0));
    await expect(collectRelease(s, 'p1', 'v1', { maxFiles: 10, maxFileBytes: 10, maxTotalBytes: 100 })).rejects.toThrow(
      /huge\.bin/,
    );
  });

  it('refuses a release that is too big overall', async () => {
    const s = sandbox(
      [
        { path: 'a', size: 60 },
        { path: 'b', size: 60 },
      ],
      () => Buffer.alloc(0),
    );
    await expect(collectRelease(s, 'p1', 'v1', { maxFiles: 10, maxFileBytes: 100, maxTotalBytes: 100 })).rejects.toThrow(
      /more than the 100/,
    );
  });
});

describe('deploying', () => {
  const files = [
    { path: 'index.html', bytes: Buffer.from('<h1>hi</h1>') },
    { path: 'app.js', bytes: Buffer.from('console.log(1)') },
  ];

  it('uploads by content hash, then references the hashes', async () => {
    const uploaded: string[] = [];
    const { impl, calls } = stubFetch((url, init) => {
      if (url.pathname === '/v2/files') {
        uploaded.push(String((init.headers as Record<string, string>)['x-vercel-digest']));
        return new Response('', { status: 200 });
      }
      return json({ uid: 'dpl_1', url: 'app.vercel.app', readyState: 'QUEUED', target: 'production' });
    });

    const deployment = await new VercelDeployer(impl).create(
      { projectName: 'my-app', target: 'production', files },
      CRED,
    );

    expect(uploaded.sort()).toEqual([sha1(files[0]!.bytes), sha1(files[1]!.bytes)].sort());
    expect(deployment.id).toBe('dpl_1');

    const create = calls.find((c) => c.url.pathname === '/v13/deployments')!;
    const body = JSON.parse(String(create.init.body)) as { files: { sha: string }[]; target?: string };
    expect(body.files.map((f) => f.sha).sort()).toEqual(uploaded.sort());
    // Detection would otherwise 400 asking for a confirmation nothing can give.
    expect(create.url.searchParams.get('skipAutoDetectionConfirmation')).toBe('1');
    expect(body.target).toBe('production');
  });

  it('omits target entirely for a preview, which is not the same as sending preview', async () => {
    const { impl, calls } = stubFetch((url) =>
      url.pathname === '/v2/files'
        ? new Response('', { status: 200 })
        : json({ uid: 'dpl_2', url: 'preview.vercel.app', readyState: 'QUEUED' }),
    );
    await new VercelDeployer(impl).create({ projectName: 'my-app', target: 'preview', files }, CRED);

    const body = JSON.parse(String(calls.find((c) => c.url.pathname === '/v13/deployments')!.init.body)) as Record<string, unknown>;
    expect('target' in body).toBe(false);
  });

  it('sends the credential as a header and never in the url', async () => {
    const { impl, calls } = stubFetch((url) =>
      url.pathname === '/v2/user' ? json({ user: { username: 'alice' } }) : json({}),
    );
    await new VercelDeployer(impl).whoami(CRED);

    const call = calls[0]!;
    expect((call.init.headers as Record<string, string>).authorization).toBe('Bearer tok_secret_value');
    // A token in a query string ends up in logs, proxies and history.
    expect(call.url.href).not.toContain('tok_secret_value');
  });

  it('scopes to a team when the credential names one', async () => {
    const { impl, calls } = stubFetch(() => json({ user: { username: 'alice' } }));
    await new VercelDeployer(impl).whoami({ token: 't', teamId: 'team_123' });
    expect(calls[0]!.url.searchParams.get('teamId')).toBe('team_123');
  });
});

describe('failure classification', () => {
  const failWith = (status: number, body: unknown = { error: { message: 'nope' } }) =>
    new VercelDeployer(stubFetch(() => json(body, status)).impl);

  it('treats a rejected credential as something to re-ask for, not to retry', async () => {
    const error = await failWith(403).whoami(CRED).catch((e: DeployError) => e);
    expect(error).toBeInstanceOf(DeployError);
    expect((error as DeployError).kind).toBe('auth');
    expect((error as DeployError).transient).toBe(false);
    expect((error as DeployError).message).toMatch(/new token/);
  });

  it('treats a limit as transient', async () => {
    const error = await failWith(429).whoami(CRED).catch((e: DeployError) => e);
    expect((error as DeployError).kind).toBe('quota');
    expect((error as DeployError).transient).toBe(true);
  });

  it('treats a server fault as transient', async () => {
    expect(((await failWith(503).whoami(CRED).catch((e: DeployError) => e)) as DeployError).transient).toBe(true);
  });

  /**
   * The one that matters: reporting a 4xx as "try again later" is how a model
   * ends up in a retry loop against a configuration that will never work.
   */
  it('treats any other 4xx as permanent, so nothing retries a broken config', async () => {
    const error = (await failWith(400).whoami(CRED).catch((e: DeployError) => e)) as DeployError;
    expect(error.kind).toBe('config');
    expect(error.transient).toBe(false);
  });

  it('carries the provider message through, rather than a bare status', async () => {
    const error = (await failWith(400, { error: { message: 'missing index.html' } })
      .whoami(CRED)
      .catch((e: DeployError) => e)) as DeployError;
    expect(error.message).toContain('missing index.html');
  });

  it('reports an unreachable provider as transport, not as a build failure', async () => {
    const impl = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const error = (await new VercelDeployer(impl).whoami(CRED).catch((e: DeployError) => e)) as DeployError;
    expect(error.kind).toBe('transport');
  });

  it('never puts the credential in an error message', async () => {
    const error = (await failWith(403).whoami(CRED).catch((e: DeployError) => e)) as DeployError;
    expect(error.message).not.toContain('tok_secret_value');
  });
});

describe('polling and build logs', () => {
  it('stops as soon as the state is terminal', async () => {
    let polls = 0;
    const impl = stubFetch(() => {
      polls += 1;
      return json({ uid: 'dpl_1', url: 'a.vercel.app', readyState: polls >= 2 ? 'READY' : 'BUILDING' });
    }).impl;

    const final = await new VercelDeployer(impl).waitForReady('dpl_1', CRED, 30_000);
    expect(final.ready_state).toBe('READY');
    expect(polls).toBe(2);
  });

  it('gives up at the budget rather than hanging', async () => {
    const impl = stubFetch(() => json({ uid: 'dpl_1', url: 'a.vercel.app', readyState: 'BUILDING' })).impl;
    const final = await new VercelDeployer(impl).waitForReady('dpl_1', CRED, 10);
    expect(final.ready_state).toBe('BUILDING');
  });

  it('returns the tail of the build output', async () => {
    const impl = stubFetch(() => json([{ text: 'line one' }, { payload: { text: 'line two' } }])).impl;
    expect(await new VercelDeployer(impl).buildLogs('dpl_1', CRED)).toEqual(['line one', 'line two']);
  });

  it('treats missing logs as missing, not as a failure', async () => {
    // Failing to read logs must not replace the real error with its own.
    const impl = stubFetch(() => json({ error: { message: 'gone' } }, 404)).impl;
    expect(await new VercelDeployer(impl).buildLogs('dpl_1', CRED)).toEqual([]);
  });
});
