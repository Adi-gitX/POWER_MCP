/**
 * Running a project while it is being built.
 *
 * Until now Power had no runtime at all. A project was a directory and a git
 * repo, so nobody could see the app until it was published, and the agent
 * could not look at its own work. That absence is why `screenshot_preview`,
 * `navigate_preview` and `run_in_browser` do not exist: there was nothing for
 * them to point at.
 *
 * `LocalRuntime` starts the project's own dev server as a child process and
 * Power proxies to it, so a preview URL lives on Power's origin rather than on
 * a port only reachable from the machine the server happens to be on. That
 * matters the moment Power is hosted: `http://localhost:4567` is useless to
 * anyone else, and a URL under Power's own origin is not.
 *
 * The `Runtime` interface is the seam. A hosted implementation backed by a
 * sandbox provider replaces this one without any handler changing, the same
 * way `Deployer` is swappable.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

export type PreviewState = 'starting' | 'ready' | 'crashed' | 'stopped';

export interface Preview {
  project_id: string;
  state: PreviewState;
  /** The path Power serves this preview under. Absolute URL is built by the caller. */
  path: string;
  port: number | null;
  started_at: string;
  /** Present when the process died, so a model can read why instead of guessing. */
  error?: string;
}

export interface Runtime {
  /** Start the project if it is not already up, and wait until it answers. */
  start(projectId: string, env?: Record<string, string>): Promise<Preview>;
  stop(projectId: string): Promise<void>;
  status(projectId: string): Preview | null;
  /** The tail of the project's own output, which is where its errors are. */
  logs(projectId: string, lines?: number): string[];
  stopAll(): Promise<void>;
}

const START_TIMEOUT_MS = 60_000;
const IDLE_SHUTDOWN_MS = 30 * 60 * 1000;
const LOG_LINES = 400;

interface Running {
  child: ChildProcess;
  port: number;
  state: PreviewState;
  startedAt: number;
  lastSeen: number;
  log: string[];
  error?: string;
}

export class LocalRuntime implements Runtime {
  private readonly running = new Map<string, Running>();
  private readonly idleTimer: NodeJS.Timeout;

  constructor(
    private readonly projectDir: (projectId: string) => string,
    /** Injected so tests can run something cheaper than a real dev server. */
    private readonly command: string[] = ['pnpm', 'start'],
  ) {
    // A preview nobody has looked at for half an hour is a process nobody
    // needs. Without this, every project ever previewed stays resident.
    this.idleTimer = setInterval(() => void this.reapIdle(), 60_000);
    this.idleTimer.unref();
  }

  async start(projectId: string, env: Record<string, string> = {}): Promise<Preview> {
    const existing = this.running.get(projectId);
    if (existing && existing.state === 'ready') {
      existing.lastSeen = Date.now();
      return this.toPreview(projectId, existing);
    }
    if (existing) await this.stop(projectId);

    const port = await freePort();
    const [command, ...args] = this.command;
    const child = spawn(command!, args, {
      cwd: this.projectDir(projectId),
      env: { ...process.env, ...env, PORT: String(port), CI: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const entry: Running = {
      child,
      port,
      state: 'starting',
      startedAt: Date.now(),
      lastSeen: Date.now(),
      log: [],
    };
    this.running.set(projectId, entry);

    const record = (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (!line.trim()) continue;
        entry.log.push(line);
        if (entry.log.length > LOG_LINES) entry.log.shift();
      }
    };
    child.stdout?.on('data', record);
    child.stderr?.on('data', record);

    child.on('exit', (code) => {
      // Only a crash if it was meant to be up. A deliberate stop sets
      // 'stopped' first, so this does not overwrite it with an error.
      if (entry.state !== 'stopped') {
        entry.state = 'crashed';
        entry.error = `the dev server exited with code ${code ?? 'unknown'}`;
      }
    });
    child.on('error', (error) => {
      entry.state = 'crashed';
      entry.error = error.message;
    });

    const up = await waitForPort(port, START_TIMEOUT_MS, () => entry.state === 'crashed');
    if (!up) {
      if (entry.state !== 'crashed') {
        entry.state = 'crashed';
        entry.error = `the dev server did not answer on its port within ${START_TIMEOUT_MS / 1000}s`;
      }
      return this.toPreview(projectId, entry);
    }

    entry.state = 'ready';
    entry.lastSeen = Date.now();
    return this.toPreview(projectId, entry);
  }

  async stop(projectId: string): Promise<void> {
    const entry = this.running.get(projectId);
    if (!entry) return;
    entry.state = 'stopped';
    entry.child.kill('SIGTERM');
    // SIGTERM first, then insist. A dev server that ignores it would otherwise
    // hold its port and block the next start.
    const died = await Promise.race([once(entry.child, 'exit'), delay(5000).then(() => false)]);
    if (!died) entry.child.kill('SIGKILL');
    this.running.delete(projectId);
  }

  status(projectId: string): Preview | null {
    const entry = this.running.get(projectId);
    return entry ? this.toPreview(projectId, entry) : null;
  }

  logs(projectId: string, lines = 50): string[] {
    return (this.running.get(projectId)?.log ?? []).slice(-lines);
  }

  async stopAll(): Promise<void> {
    clearInterval(this.idleTimer);
    await Promise.all([...this.running.keys()].map((id) => this.stop(id)));
  }

  /** Where a proxied request should go, and a note that someone is watching. */
  portFor(projectId: string): number | null {
    const entry = this.running.get(projectId);
    if (!entry || entry.state !== 'ready') return null;
    entry.lastSeen = Date.now();
    return entry.port;
  }

  private async reapIdle(): Promise<void> {
    const cutoff = Date.now() - IDLE_SHUTDOWN_MS;
    for (const [id, entry] of this.running) {
      if (entry.lastSeen < cutoff) await this.stop(id);
    }
  }

  private toPreview(projectId: string, entry: Running): Preview {
    return {
      project_id: projectId,
      state: entry.state,
      path: `/preview/${projectId}/`,
      port: entry.port,
      started_at: new Date(entry.startedAt).toISOString(),
      ...(entry.error ? { error: entry.error } : {}),
    };
  }
}

function once(child: ChildProcess, event: 'exit'): Promise<boolean> {
  return new Promise((resolve) => child.once(event, () => resolve(true)));
}

/** Ask the OS for a port rather than guessing, so two projects cannot collide. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe: Server = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address && typeof address === 'object') {
        const { port } = address;
        probe.close(() => resolve(port));
      } else {
        probe.close(() => reject(new Error('could not get a port')));
      }
    });
    probe.on('error', reject);
  });
}

/** Poll until the child answers, or it dies, or we run out of patience. */
async function waitForPort(port: number, timeoutMs: number, dead: () => boolean): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (dead()) return false;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
      // Any answer means it is listening. A 404 still proves the server is up.
      if (response.status >= 100) return true;
    } catch {
      // Not listening yet.
    }
    await delay(250);
  }
  return false;
}
