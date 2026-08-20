/**
 * The per-project workbench, behind an interface.
 *
 * `LocalSandbox` runs each project in a directory under `.power-local/` on this
 * machine, which is enough to exercise the whole pipeline end to end today. The
 * Fly Machines driver implements the same interface by making each of these an
 * RPC to the in-VM agent daemon; nothing in the tool handlers changes.
 *
 * Git is the substrate from the first commit, even locally. Checkpoints are
 * real commits, restore is a real reset, and export is a real bundle — so the
 * anti-lock-in promise is exercised by the local driver rather than deferred to
 * the hosted one.
 */
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

export interface CommandResult {
  ok: boolean;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  duration_ms: number;
}

export interface Checkpoint {
  id: string;
  message: string;
  at: string;
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

export interface Sandbox {
  create(projectId: string, slug: string): Promise<void>;
  listFiles(projectId: string, dir?: string): Promise<string[]>;
  readFile(projectId: string, path: string): Promise<string>;
  writeFile(projectId: string, path: string, content: string): Promise<void>;
  editFile(projectId: string, path: string, oldText: string, newText: string): Promise<void>;
  deleteFile(projectId: string, path: string): Promise<void>;
  renameFile(projectId: string, from: string, to: string): Promise<void>;
  copyFile(projectId: string, from: string, to: string): Promise<void>;
  search(projectId: string, pattern: string): Promise<SearchHit[]>;
  /** `env` is how secrets reach a process: injected here, never written to disk. */
  run(projectId: string, argv: string[], env?: Record<string, string>): Promise<CommandResult>;

  checkpoint(projectId: string, message: string, trailers: Record<string, string>): Promise<Checkpoint>;
  listCheckpoints(projectId: string): Promise<Checkpoint[]>;
  restore(projectId: string, checkpointId: string): Promise<void>;
  diff(projectId: string, from: string, to?: string): Promise<string>;

  /** Tag the current workbench as a release and materialise it as the live copy. */
  publish(projectId: string): Promise<{ version: string; live_path: string }>;
  publishStatus(projectId: string): Promise<{ version: string | null; live_path: string | null }>;
  /** Return live to the previous release tag. */
  rollback(projectId: string): Promise<{ version: string; live_path: string }>;
  unpublish(projectId: string): Promise<void>;
  exportBundle(projectId: string): Promise<{ path: string; bytes: number }>;
}

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxError';
  }
}

/**
 * Commands the workbench will run. Kept to the toolchain: the sandbox exists to
 * build and check the project, not to be a shell.
 */
const COMMAND_ALLOWLIST = new Set(['pnpm', 'npm', 'npx', 'node', 'tsc', 'vitest', 'git']);
const COMMAND_TIMEOUT_MS = 120_000;
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);

export class LocalSandbox implements Sandbox {
  constructor(private readonly root: string) {}

  private dir(projectId: string): string {
    return join(this.root, 'projects', projectId);
  }

  private liveDir(projectId: string): string {
    return join(this.root, 'live', projectId);
  }

  /** Resolve a project-relative path and refuse anything that escapes the workbench. */
  private safe(projectId: string, path: string): string {
    const base = resolve(this.dir(projectId));
    const target = resolve(base, path);
    if (target !== base && !target.startsWith(base + sep)) {
      throw new SandboxError(`path escapes the workbench: ${path}`);
    }
    return target;
  }

  async create(projectId: string, slug: string): Promise<void> {
    const dir = this.dir(projectId);
    await mkdir(dir, { recursive: true });
    for (const [path, content] of Object.entries(template(slug))) {
      const full = join(dir, path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, content, 'utf8');
    }
    await this.git(projectId, ['init', '-q', '-b', 'work']);
    // Dependencies first, so the initial checkpoint is a project that typechecks.
    const install = await this.run(projectId, ['pnpm', 'install', '--silent']);
    if (!install.ok) {
      const fallback = await this.run(projectId, ['npm', 'install', '--silent', '--no-audit']);
      if (!fallback.ok) throw new SandboxError(`dependency install failed: ${fallback.stderr}`);
    }
    await this.checkpoint(projectId, 'Initial project', { 'Power-Phase': 'intake' });
  }

  async listFiles(projectId: string, dir = '.'): Promise<string[]> {
    const base = this.safe(projectId, dir);
    const out: string[] = [];
    const walk = async (current: string): Promise<void> => {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        const full = join(current, entry.name);
        if (entry.isDirectory()) await walk(full);
        else out.push(relative(this.dir(projectId), full));
      }
    };
    await walk(base);
    return out.sort();
  }

  async readFile(projectId: string, path: string): Promise<string> {
    try {
      return await readFile(this.safe(projectId, path), 'utf8');
    } catch {
      throw new SandboxError(`no such file: ${path}`);
    }
  }

  async writeFile(projectId: string, path: string, content: string): Promise<void> {
    const full = this.safe(projectId, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  async editFile(projectId: string, path: string, oldText: string, newText: string): Promise<void> {
    const current = await this.readFile(projectId, path);
    const first = current.indexOf(oldText);
    if (first === -1) throw new SandboxError(`old_text not found in ${path}`);
    if (current.indexOf(oldText, first + 1) !== -1) {
      throw new SandboxError(
        `old_text occurs more than once in ${path}; include more surrounding context so it is unique`,
      );
    }
    await this.writeFile(projectId, path, current.replace(oldText, () => newText));
  }

  async deleteFile(projectId: string, path: string): Promise<void> {
    await rm(this.safe(projectId, path), { force: true });
  }

  async renameFile(projectId: string, from: string, to: string): Promise<void> {
    const target = this.safe(projectId, to);
    await mkdir(dirname(target), { recursive: true });
    await rename(this.safe(projectId, from), target);
  }

  async copyFile(projectId: string, from: string, to: string): Promise<void> {
    const target = this.safe(projectId, to);
    await mkdir(dirname(target), { recursive: true });
    await cp(this.safe(projectId, from), target);
  }

  async search(projectId: string, pattern: string): Promise<SearchHit[]> {
    const regex = new RegExp(pattern);
    const hits: SearchHit[] = [];
    for (const path of await this.listFiles(projectId)) {
      const lines = (await this.readFile(projectId, path)).split('\n');
      lines.forEach((text, index) => {
        if (regex.test(text)) hits.push({ path, line: index + 1, text: text.slice(0, 200) });
      });
      if (hits.length >= 200) break;
    }
    return hits;
  }

  async run(projectId: string, argv: string[], env: Record<string, string> = {}): Promise<CommandResult> {
    const [command, ...args] = argv;
    if (!command || !COMMAND_ALLOWLIST.has(command)) {
      throw new SandboxError(
        `command not allowed: ${command ?? '(empty)'}. Allowed: ${[...COMMAND_ALLOWLIST].join(', ')}`,
      );
    }
    const startedAt = Date.now();
    return new Promise((resolvePromise) => {
      const child = spawn(command, args, {
        cwd: this.dir(projectId),
        env: { ...process.env, ...env, CI: '1', FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), COMMAND_TIMEOUT_MS);
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      child.on('error', (error) => {
        clearTimeout(timer);
        resolvePromise({
          ok: false,
          exit_code: null,
          stdout,
          stderr: `${stderr}\n${error.message}`.trim(),
          duration_ms: Date.now() - startedAt,
        });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolvePromise({
          ok: code === 0,
          exit_code: code,
          stdout: tail(stdout),
          stderr: tail(stderr),
          duration_ms: Date.now() - startedAt,
        });
      });
    });
  }

  private async git(projectId: string, args: string[]): Promise<CommandResult> {
    return this.run(projectId, [
      'git',
      '-c',
      'user.name=Power',
      '-c',
      'user.email=agent@power.app',
      ...args,
    ]);
  }

  async checkpoint(
    projectId: string,
    message: string,
    trailers: Record<string, string>,
  ): Promise<Checkpoint> {
    await this.git(projectId, ['add', '-A']);
    const body = Object.entries(trailers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    const commit = await this.git(projectId, [
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      message,
      ...(body ? ['-m', body] : []),
    ]);
    if (!commit.ok) throw new SandboxError(`checkpoint failed: ${commit.stderr}`);
    const head = await this.git(projectId, ['rev-parse', '--short', 'HEAD']);
    return { id: head.stdout.trim(), message, at: new Date().toISOString() };
  }

  async listCheckpoints(projectId: string): Promise<Checkpoint[]> {
    const log = await this.git(projectId, ['log', '--format=%h%x1f%s%x1f%cI', '-n', '50']);
    if (!log.ok) return [];
    return log.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [id = '', message = '', at = ''] = line.split('\x1f');
        return { id, message, at };
      });
  }

  async restore(projectId: string, checkpointId: string): Promise<void> {
    const result = await this.git(projectId, ['reset', '--hard', '-q', checkpointId]);
    if (!result.ok) throw new SandboxError(`no such checkpoint: ${checkpointId}`);
  }

  async diff(projectId: string, from: string, to = 'HEAD'): Promise<string> {
    const result = await this.git(projectId, ['diff', '--stat', '-p', `${from}..${to}`]);
    if (!result.ok) throw new SandboxError(result.stderr);
    return result.stdout;
  }

  async publish(projectId: string): Promise<{ version: string; live_path: string }> {
    const tags = await this.git(projectId, ['tag', '--list', 'v*']);
    const next = tags.stdout.split('\n').filter(Boolean).length + 1;
    const version = `v${next}`;
    await this.git(projectId, ['tag', version]);
    return this.materialise(projectId, version);
  }

  /** Make `version` the live copy: a fresh clone of the tag, sharing nothing with the workbench. */
  private async materialise(projectId: string, version: string): Promise<{ version: string; live_path: string }> {
    const live = this.liveDir(projectId);
    await rm(live, { recursive: true, force: true });
    await mkdir(dirname(live), { recursive: true });
    // The live copy is a fresh clone of the tag: it cannot contain anything the
    // workbench has not committed, and it never shares state with it.
    const clone = await this.run(projectId, [
      'git',
      'clone',
      '-q',
      '--branch',
      version,
      '--depth',
      '1',
      this.dir(projectId),
      live,
    ]);
    if (!clone.ok) throw new SandboxError(`publish failed: ${clone.stderr}`);
    return { version, live_path: live };
  }

  async rollback(projectId: string): Promise<{ version: string; live_path: string }> {
    const tags = (await this.git(projectId, ['tag', '--list', 'v*', '--sort=-v:refname'])).stdout
      .split('\n')
      .filter(Boolean);
    const previous = tags[1];
    if (!previous) throw new SandboxError('nothing to roll back to: only one version has been published');
    // Re-tag so the rollback is itself a release, and history stays append-only.
    const version = `v${tags.length + 1}`;
    await this.git(projectId, ['tag', version, previous]);
    return this.materialise(projectId, version);
  }

  async unpublish(projectId: string): Promise<void> {
    await rm(this.liveDir(projectId), { recursive: true, force: true });
  }

  async publishStatus(projectId: string): Promise<{ version: string | null; live_path: string | null }> {
    const live = this.liveDir(projectId);
    try {
      await stat(live);
    } catch {
      return { version: null, live_path: null };
    }
    const tags = await this.git(projectId, ['tag', '--list', 'v*', '--sort=-v:refname']);
    return { version: tags.stdout.split('\n')[0] ?? null, live_path: live };
  }

  async exportBundle(projectId: string): Promise<{ path: string; bytes: number }> {
    const out = join(this.root, 'exports', `${projectId}.bundle`);
    await mkdir(dirname(out), { recursive: true });
    const result = await this.git(projectId, ['bundle', 'create', out, '--all']);
    if (!result.ok) throw new SandboxError(`export failed: ${result.stderr}`);
    return { path: out, bytes: (await stat(out)).size };
  }
}

function tail(text: string, max = 8000): string {
  return text.length > max ? `…(${text.length - max} chars truncated)\n${text.slice(-max)}` : text;
}

/**
 * The v0 template: the smallest project that typechecks, has a test, and is a
 * git repo. The real template (Vite + React + server.ts + @power/sdk with both
 * adapters) replaces this; the handlers do not care which one is here.
 */
function template(slug: string): Record<string, string> {
  return {
    'package.json': `${JSON.stringify(
      {
        name: slug,
        private: true,
        type: 'module',
        scripts: {
          typecheck: 'tsc --noEmit -p .',
          test: 'vitest run',
        },
        devDependencies: {
          '@types/node': '^22.10.0',
          typescript: '^5.7.0',
          vitest: '^2.1.0',
        },
      },
      null,
      2,
    )}\n`,
    'tsconfig.json': `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2023',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: ['node'],
        },
        include: ['src'],
      },
      null,
      2,
    )}\n`,
    'vitest.config.ts': `import { defineConfig } from 'vitest/config';\n\nexport default defineConfig({ css: { postcss: {} } });\n`,
    '.gitignore': 'node_modules/\ndist/\n.env\ndata/\n',
    'README.md': `# ${slug}

Built with Power. This is a real git repository: every checkpoint is a commit.

## Run it anywhere

\`\`\`sh
cp .env.example .env      # local values already filled in
docker compose up -d      # Postgres, object storage, a mail catcher
pnpm install && pnpm test
\`\`\`

Nothing in this project depends on Power at runtime. Inside Power the same code
reads the connection details Power injects; outside, it reads \`.env\`.
`,
    // The exported shape, present from day one so "runs anywhere" is a property
    // of the template rather than a promise about a future export step.
    '.env.example': `# Local values that work with docker-compose.yml out of the box.
DATABASE_URL=postgres://app:app@localhost:5432/app
STORAGE_DIR=./data/storage

# Optional. Without RESEND_API_KEY, outgoing mail is printed to stdout.
# RESEND_API_KEY=
# MAIL_FROM=app@example.com
`,
    'docker-compose.yml': `services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
  mail:
    image: axllent/mailpit
    ports: ["8025:8025", "1025:1025"]
volumes:
  pgdata:
`,
    'src/app.ts': `export function greet(name: string): string {\n  return \`Hello, \${name}\`;\n}\n`,
    'src/app.test.ts': `import { expect, it } from 'vitest';\nimport { greet } from './app.js';\n\nit('greets', () => {\n  expect(greet('world')).toBe('Hello, world');\n});\n`,
  };
}
