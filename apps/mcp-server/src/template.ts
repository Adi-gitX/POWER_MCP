/**
 * What a new project starts as.
 *
 * The previous template was a Node library whose entire contents were a
 * function returning "Hello, name". That was the single biggest thing wrong
 * with Power: the pipeline around it was real, but the thing it built was a
 * skeleton, and publishing a library to static hosting produced source code
 * nobody could run.
 *
 * This template is a working web application: a page, an HTTP API, a Postgres
 * table and sign-in. Three properties matter.
 *
 *   One request handler, two entry points. `handle(req, res)` is the whole
 *   server. `dev.ts` calls it locally and `api/index.ts` calls it when
 *   deployed, so what runs in front of a person is the same code that was
 *   tested, and there is no "works locally" class of bug.
 *
 *   No framework. The dependencies are `pg` and the TypeScript toolchain.
 *   That keeps install fast, which matters because the agent waits for it, and
 *   it means an exported project has nothing proprietary to strip out.
 *
 *   It runs before the agent touches it. A fresh project serves a real page
 *   and passes its own tests, so the first thing the model does is modify
 *   something that works rather than invent something from nothing.
 */

export function template(slug: string): Record<string, string> {
  const pkg = {
    name: slug,
    private: true,
    type: 'module',
    scripts: {
      dev: 'tsx watch dev.ts',
      start: 'tsx dev.ts',
      typecheck: 'tsc --noEmit -p .',
      test: 'vitest run',
    },
    dependencies: { pg: '^8.13.0' },
    devDependencies: {
      '@types/node': '^22.10.0',
      '@types/pg': '^8.11.0',
      tsx: '^4.19.0',
      typescript: '^5.7.0',
      vitest: '^2.1.0',
    },
  };

  const tsconfig = {
    compilerOptions: {
      target: 'ES2023',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      types: ['node'],
    },
    include: ['src', 'api', 'dev.ts'],
  };

  return {
    'package.json': `${JSON.stringify(pkg, null, 2)}\n`,
    'tsconfig.json': `${JSON.stringify(tsconfig, null, 2)}\n`,
    'vitest.config.ts': `import { defineConfig } from 'vitest/config';\n\nexport default defineConfig({ css: { postcss: {} } });\n`,
    '.gitignore': 'node_modules/\ndist/\n.env\ndata/\n.vercel/\n',

    'README.md': `# ${slug}

Built with Power. A plain web app: one request handler, a Postgres table, and
no framework.

## Run it

\`\`\`sh
docker compose up -d      # Postgres on 5432, mail catcher on 8025
cp .env.example .env
pnpm install
pnpm dev                  # http://localhost:3000
\`\`\`

## Layout

| Path | What |
|---|---|
| \`src/app.ts\` | The whole server: one \`handle(req, res)\` |
| \`src/db.ts\` | Postgres pool and the schema, applied at startup |
| \`src/auth.ts\` | Sign-up, sign-in and sessions |
| \`public/\` | The page and its assets |
| \`dev.ts\` | Local entry point |
| \`api/index.ts\` | Deployed entry point |

Both entry points call the same \`handle\`, so what runs in production is what
the tests exercise.

## It is yours

Nothing here is proprietary. \`pnpm install && pnpm dev\` works on any machine
with Postgres, and the export carries the full git history.
`,

    '.env.example': `# Works with docker-compose.yml as-is.
DATABASE_URL=postgres://power:power@localhost:5432/app
PORT=3000
`,

    'docker-compose.yml': `services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: power
      POSTGRES_PASSWORD: power
      POSTGRES_DB: app
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
  mail:
    image: axllent/mailpit
    ports: ["8025:8025", "1025:1025"]
volumes:
  pgdata:
`,

    // ---- the server

    'src/db.ts': `import pg from 'pg';

/**
 * One pool for the process. The schema is applied at startup and is
 * idempotent, so there is no migration step to run by hand before the app
 * works.
 */
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://power:power@localhost:5432/app',
  max: 5,
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const { rows } = await pool.query<T>(sql, params);
  return rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  return (await query<T>(sql, params))[0] ?? null;
}

export const SCHEMA = [
  \`create table if not exists users (
     id text primary key,
     email text not null,
     password_hash text not null,
     password_salt text not null,
     created_at timestamptz not null default now()
   )\`,
  \`create unique index if not exists users_email on users (lower(email))\`,
  \`create table if not exists sessions (
     token_hash text primary key,
     user_id text not null references users(id) on delete cascade,
     expires_at timestamptz not null
   )\`,
  \`create table if not exists items (
     id bigserial primary key,
     user_id text references users(id) on delete cascade,
     title text not null,
     done boolean not null default false,
     created_at timestamptz not null default now()
   )\`,
];

export async function migrate(): Promise<void> {
  for (const statement of SCHEMA) await query(statement);
}

export async function close(): Promise<void> {
  await pool.end();
}
`,

    'src/auth.ts': `import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { one, query } from './db.js';

const scrypt = promisify(scryptCb) as (p: string, s: string, k: number) => Promise<Buffer>;
const KEY = 64;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

const hash = (v: string) => createHash('sha256').update(v).digest('hex');

export interface User {
  id: string;
  email: string;
}

export async function signUp(email: string, password: string): Promise<{ user: User; token: string }> {
  const normalised = email.trim().toLowerCase();
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(normalised)) throw new Error('That is not an email address.');
  if (password.length < 8) throw new Error('Use at least 8 characters.');
  if (await one('select id from users where lower(email) = $1', [normalised])) {
    throw new Error('That email already has an account.');
  }

  const salt = randomBytes(16).toString('hex');
  const hashed = (await scrypt(password, salt, KEY)).toString('hex');
  const id = 'usr_' + randomUUID().replace(/-/g, '').slice(0, 20);
  await query('insert into users (id, email, password_hash, password_salt) values ($1,$2,$3,$4)', [
    id,
    normalised,
    hashed,
    salt,
  ]);
  return { user: { id, email: normalised }, token: await startSession(id) };
}

export async function signIn(email: string, password: string): Promise<{ user: User; token: string } | null> {
  const normalised = email.trim().toLowerCase();
  const row = await one<{ id: string; email: string; password_hash: string; password_salt: string }>(
    'select id, email, password_hash, password_salt from users where lower(email) = $1',
    [normalised],
  );

  // Hash even when there is no account, so a wrong password and an unknown
  // address take the same time and give the same answer.
  const salt = row?.password_salt ?? 'absent';
  const expected = row?.password_hash ?? '0'.repeat(KEY * 2);
  const actual = (await scrypt(password, salt, KEY)).toString('hex');
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  if (!row || left.length !== right.length || !timingSafeEqual(left, right)) return null;

  return { user: { id: row.id, email: row.email }, token: await startSession(row.id) };
}

export async function userFor(token: string | null): Promise<User | null> {
  if (!token) return null;
  const row = await one<{ id: string; email: string }>(
    \`select u.id, u.email from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now()\`,
    [hash(token)],
  );
  return row ?? null;
}

export async function signOut(token: string | null): Promise<void> {
  if (token) await query('delete from sessions where token_hash = $1', [hash(token)]);
}

async function startSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await query('insert into sessions (token_hash, user_id, expires_at) values ($1,$2,$3)', [
    hash(token),
    userId,
    new Date(Date.now() + SESSION_MS).toISOString(),
  ]);
  return token;
}

export function sessionCookie(token: string): string {
  return \`session=\${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=\${Math.floor(SESSION_MS / 1000)}\`;
}

export const clearCookie = 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';

export function readCookie(header: string | undefined): string | null {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === 'session') return part.slice(eq + 1).trim();
  }
  return null;
}
`,

    'src/app.ts': `import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { clearCookie, readCookie, sessionCookie, signIn, signOut, signUp, userFor } from './auth.js';
import { one, query } from './db.js';

/**
 * The whole server.
 *
 * \`dev.ts\` calls this locally and \`api/index.ts\` calls it when deployed, so
 * the code in front of a person is the code the tests exercise.
 */
export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const token = readCookie(req.headers.cookie);

  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url, token);
    return await staticFile(url.pathname, res);
  } catch (error) {
    // Never return the raw message: it can carry a query or a path.
    console.error('[app]', error);
    json(res, 500, { error: 'Something went wrong.' });
  }
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL, token: string | null): Promise<void> {
  const me = await userFor(token);

  if (url.pathname === '/api/me') return json(res, 200, { user: me });

  if (url.pathname === '/api/signup' && req.method === 'POST') {
    const { email, password } = await body(req);
    try {
      const result = await signUp(String(email), String(password));
      res.setHeader('set-cookie', sessionCookie(result.token));
      return json(res, 200, { user: result.user });
    } catch (error) {
      return json(res, 400, { error: (error as Error).message });
    }
  }

  if (url.pathname === '/api/signin' && req.method === 'POST') {
    const { email, password } = await body(req);
    const result = await signIn(String(email), String(password));
    // One message for both failures, so the form cannot be used to find out
    // whether an address has an account.
    if (!result) return json(res, 401, { error: 'That email and password do not match.' });
    res.setHeader('set-cookie', sessionCookie(result.token));
    return json(res, 200, { user: result.user });
  }

  if (url.pathname === '/api/signout' && req.method === 'POST') {
    await signOut(token);
    res.setHeader('set-cookie', clearCookie);
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/items') {
    if (!me) return json(res, 401, { error: 'Sign in first.' });

    if (req.method === 'GET') {
      return json(res, 200, {
        items: await query('select id, title, done, created_at from items where user_id = $1 order by id desc', [me.id]),
      });
    }
    if (req.method === 'POST') {
      const { title } = await body(req);
      const clean = String(title ?? '').trim();
      if (!clean) return json(res, 400, { error: 'A title is required.' });
      const row = await one(
        'insert into items (user_id, title) values ($1,$2) returning id, title, done, created_at',
        [me.id, clean.slice(0, 200)],
      );
      return json(res, 200, { item: row });
    }
  }

  const itemPath = /^\\/api\\/items\\/(\\d+)$/.exec(url.pathname);
  if (itemPath) {
    if (!me) return json(res, 401, { error: 'Sign in first.' });
    const id = itemPath[1];

    if (req.method === 'PATCH') {
      const payload = await body(req);
      const fields: string[] = [];
      const values: unknown[] = [];

      if (typeof payload.title === 'string') {
        const clean = payload.title.trim();
        if (!clean) return json(res, 400, { error: 'A title is required.' });
        values.push(clean.slice(0, 200));
        fields.push('title = $' + values.length);
      }
      if (typeof payload.done === 'boolean') {
        values.push(payload.done);
        fields.push('done = $' + values.length);
      }
      if (!fields.length) return json(res, 400, { error: 'Nothing to change.' });

      values.push(id, me.id);
      const row = await one(
        'update items set ' + fields.join(', ') +
          ' where id = $' + (values.length - 1) + ' and user_id = $' + values.length +
          ' returning id, title, done, created_at',
        values,
      );
      if (!row) return json(res, 404, { error: 'No such item.' });
      return json(res, 200, { item: row });
    }

    if (req.method === 'DELETE') {
      const row = await one('delete from items where id = $1 and user_id = $2 returning id', [id, me.id]);
      if (!row) return json(res, 404, { error: 'No such item.' });
      return json(res, 200, { ok: true });
    }
  }

  return json(res, 404, { error: 'No such endpoint.' });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

async function staticFile(pathname: string, res: ServerResponse): Promise<void> {
  const root = resolve('public');
  const target = resolve(join(root, pathname === '/' ? 'index.html' : pathname));
  // Refuse anything that climbs out of public/.
  if (target !== root && !target.startsWith(root + sep)) return json(res, 400, { error: 'Bad path.' });
  try {
    const file = await readFile(target);
    res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
    res.end(file);
  } catch {
    json(res, 404, { error: 'Not found.' });
  }
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function body(req: IncomingMessage, limit = 64 * 1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buf.length;
    if (total > limit) {
      req.destroy();
      throw new Error('Request body too large.');
    }
    chunks.push(buf);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}
`,

    'src/app.test.ts': `import { describe, expect, it } from 'vitest';
import { readCookie, sessionCookie } from './auth.js';

/**
 * These run with no database, so they stay green before \`docker compose up\`.
 * Add tests that need Postgres as you add features; \`pnpm test\` is what the
 * build gate checks before anything can be published.
 */
describe('session cookies', () => {
  it('cannot be read by scripts in the page', () => {
    expect(sessionCookie('abc')).toContain('HttpOnly');
  });

  it('survive arriving back from another site', () => {
    // Lax rather than Strict, or a sign-in that returns via a redirect loses
    // the cookie and the person is bounced back to the form.
    expect(sessionCookie('abc')).toContain('SameSite=Lax');
  });

  it('round-trip through a Cookie header', () => {
    expect(readCookie('session=abc123; theme=dark')).toBe('abc123');
    expect(readCookie('theme=dark')).toBeNull();
    expect(readCookie(undefined)).toBeNull();
  });
});
`,

    // ---- entry points

    'dev.ts': `import { createServer } from 'node:http';
import { handle } from './src/app.js';
import { migrate } from './src/db.js';

const port = Number(process.env.PORT ?? 3000);

// Try to set the schema up, but serve either way. A first run before
// \`docker compose up\` should still show the page and say what is missing,
// rather than exiting with a stack trace.
try {
  await migrate();
} catch (error) {
  console.warn('[db] not reachable, so the API will not work yet:', (error as Error).message);
  console.warn('[db] start it with: docker compose up -d');
}

createServer(handle).listen(port, () => {
  console.log(\`${slug} on http://localhost:\${port}\`);
});
`,

    'api/index.ts': `import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from '../src/app.js';
import { migrate } from '../src/db.js';

/**
 * The deployed entry point. Every request goes through the same \`handle\` the
 * dev server uses.
 */
let ready: Promise<void> | null = null;

export default async function (req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Once per cold start, not once per request.
  ready ??= migrate();
  await ready;
  await handle(req, res);
}
`,

    'vercel.json': `{
  "rewrites": [{ "source": "/api/(.*)", "destination": "/api/index" }]
}
`,

    // ---- the page

    'public/index.html': `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${slug} — a private list for what needs doing.">
<title>${slug}</title>
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="styles.css">
<script>
  try {
    var saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
  } catch (error) {}
</script>
</head>
<body class="is-booting">
<div class="boot" id="boot" aria-hidden="true">
  <span class="mark mark-lg">${slug.charAt(0).toUpperCase()}</span>
  <span class="boot-text">Opening your list</span>
</div>

<div class="app" id="app">
  <aside class="rail">
    <a class="brand" href="./" aria-label="${slug} home">
      <span class="mark" aria-hidden="true">${slug.charAt(0).toUpperCase()}</span>
      <span class="brand-name">${slug}</span>
    </a>

    <nav class="nav" id="workspace-nav" aria-label="Workspace" hidden>
      <p class="nav-label">Workspace</p>
      <a class="nav-item is-current" href="#list" aria-current="page">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
          <path d="M4 6h.01M4 12h.01M4 18h.01M9 6h11M9 12h11M9 18h11"/>
        </svg>
        <span>Your list</span>
      </a>
    </nav>

    <div class="rail-foot">
      <div class="account" id="account" hidden>
        <span class="avatar" id="avatar" aria-hidden="true">·</span>
        <span class="account-copy">
          <span class="account-email" id="who">Not signed in</span>
          <span class="account-note">Private by default</span>
        </span>
      </div>
      <div class="rail-actions">
        <button class="icon-button" id="theme-toggle" type="button" aria-label="Switch to dark theme" aria-pressed="false">
          <svg class="icon icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/>
          </svg>
          <svg class="icon icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4"/>
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>
          </svg>
        </button>
        <button class="text-button" id="signout" type="button" hidden>Sign out</button>
      </div>
    </div>
  </aside>

  <main class="main">
    <section class="auth" id="signed-out" aria-labelledby="auth-heading">
      <div class="auth-intro">
        <p class="eyebrow">A private list</p>
        <h1 id="auth-heading">A shorter list.<br>A clearer day.</h1>
        <p class="lede">${slug} is one quiet place for the work in front of you. Add it, finish it, and keep the rest where you can see it.</p>
        <ul class="points">
          <li><span class="point-mark" aria-hidden="true"></span>Add what needs doing.</li>
          <li><span class="point-mark" aria-hidden="true"></span>Check it off when it is done.</li>
          <li><span class="point-mark" aria-hidden="true"></span>Everything stays with your account.</li>
        </ul>
      </div>

      <div class="auth-card">
        <div class="auth-tabs" role="group" aria-label="Account">
          <button class="auth-tab is-active" type="button" aria-pressed="true" data-mode="signup">Create account</button>
          <button class="auth-tab" type="button" aria-pressed="false" data-mode="signin">Sign in</button>
        </div>
        <form class="auth-form" id="auth-form" novalidate>
          <h2 id="auth-title">Make it yours</h2>
          <p class="auth-sub" id="auth-sub">Your account lives in this app's own database.</p>
          <div class="field">
            <label for="email">Email</label>
            <input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required>
          </div>
          <div class="field">
            <div class="label-row">
              <label for="password">Password</label>
              <button class="text-button subtle" type="button" id="show-password" aria-pressed="false">Show</button>
            </div>
            <input id="password" name="password" type="password" autocomplete="new-password" placeholder="At least 8 characters" required minlength="8">
            <p class="hint" id="password-hint">At least 8 characters.</p>
          </div>
          <p class="error" id="auth-error" role="alert" hidden></p>
          <button class="primary wide" type="submit" id="auth-submit">Create account</button>
          <p class="fine" id="auth-fine">No verification email. Your password is hashed before it is stored.</p>
        </form>
      </div>
    </section>

    <section class="board" id="signed-in" hidden aria-labelledby="board-heading">
      <header class="board-head">
        <div class="board-title">
          <p class="eyebrow" id="today-label">Today</p>
          <h1 id="board-heading">Your list</h1>
          <p class="summary" id="summary">Nothing on it yet.</p>
        </div>
        <div class="progress" aria-hidden="true">
          <div class="progress-row">
            <span class="progress-value" id="progress-value">0%</span>
            <span class="progress-caption">complete</span>
          </div>
          <div class="progress-track"><span class="progress-fill" id="progress-fill"></span></div>
        </div>
      </header>

      <form class="composer" id="item-form" novalidate>
        <span class="composer-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14"/>
          </svg>
        </span>
        <label class="sr-only" for="title">Add an item</label>
        <input id="title" name="title" type="text" maxlength="200" placeholder="What needs doing?" autocomplete="off" enterkeyhint="done">
        <button class="primary" type="submit" id="add-button">Add</button>
      </form>
      <p class="error composer-error" id="item-error" role="alert" hidden></p>

      <div class="toolbar">
        <div class="segmented" role="group" aria-label="Show items">
          <button class="segment is-active" type="button" aria-pressed="true" data-filter="all">All <span class="segment-count" id="count-all">0</span></button>
          <button class="segment" type="button" aria-pressed="false" data-filter="open">Open <span class="segment-count" id="count-open">0</span></button>
          <button class="segment" type="button" aria-pressed="false" data-filter="done">Done <span class="segment-count" id="count-done">0</span></button>
        </div>
        <p class="shortcut"><kbd>N</kbd> new item</p>
      </div>

      <p class="sr-only" id="list-status" aria-live="polite"></p>
      <ul class="list" id="list" aria-labelledby="board-heading"></ul>

      <div class="empty" id="empty" hidden>
        <span class="empty-mark" aria-hidden="true"></span>
        <p class="empty-title" id="empty-title">Nothing here yet</p>
        <p class="empty-copy" id="empty-copy">Add the first thing above, and it will show up here.</p>
      </div>

      <footer class="board-foot">
        <span class="foot-dot" aria-hidden="true"></span>
        <span>Saved to your own Postgres database</span>
        <span class="foot-sep" aria-hidden="true">·</span>
        <span id="foot-user">Not signed in</span>
      </footer>
    </section>

    <section class="offline" id="offline" hidden aria-labelledby="offline-heading">
      <p class="eyebrow">Connection</p>
      <h1 id="offline-heading">The app could not load.</h1>
      <p class="lede">The server did not answer. If you are running this locally, check that the database and dev server are up, then try again.</p>
      <button class="primary" type="button" id="retry">Try again</button>
    </section>
  </main>
</div>

<div class="toast" id="toast" role="status" aria-live="polite" hidden>
  <span class="toast-text" id="toast-text"></span>
  <button class="toast-action" type="button" id="toast-action" hidden>Undo</button>
</div>

<noscript>
  <p class="noscript">This app needs JavaScript to sign you in and load your list.</p>
</noscript>

<script src="app.js" type="module"></script>
</body>
</html>
`,

    'public/styles.css': `:root {
  color-scheme: light;
  --paper: #f4f1ea;
  --paper-deep: #eae4d9;
  --surface: #faf8f2;
  --surface-raised: #fffdf8;
  --ink: #1e1b16;
  --muted: #6c6457;
  --faint: #988f80;
  --line: #e0d8ca;
  --line-strong: #c8bdab;
  --accent: #b04724;
  --accent-hover: #963a1c;
  --accent-ink: #fff9f2;
  --accent-soft: #f2dfd3;
  --ok: #436c4f;
  --ok-soft: #e4ece1;
  --danger: #a13a2a;
  --danger-soft: #f4e2de;
  --shadow: 0 1px 2px rgba(35, 28, 18, 0.04), 0 14px 34px rgba(35, 28, 18, 0.07);
  --serif: ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Helvetica, Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --paper: #141310;
  --paper-deep: #211e19;
  --surface: #1a1815;
  --surface-raised: #201d19;
  --ink: #f1ece2;
  --muted: #a79e90;
  --faint: #7b7264;
  --line: #2d2923;
  --line-strong: #453f35;
  --accent: #de7b53;
  --accent-hover: #e98a63;
  --accent-ink: #1b100b;
  --accent-soft: #38251b;
  --ok: #8ab58f;
  --ok-soft: #233024;
  --danger: #e89481;
  --danger-soft: #38241f;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.2), 0 18px 40px rgba(0, 0, 0, 0.28);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --paper: #141310;
    --paper-deep: #211e19;
    --surface: #1a1815;
    --surface-raised: #201d19;
    --ink: #f1ece2;
    --muted: #a79e90;
    --faint: #7b7264;
    --line: #2d2923;
    --line-strong: #453f35;
    --accent: #de7b53;
    --accent-hover: #e98a63;
    --accent-ink: #1b100b;
    --accent-soft: #38251b;
    --ok: #8ab58f;
    --ok-soft: #233024;
    --danger: #e89481;
    --danger-soft: #38241f;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.2), 0 18px 40px rgba(0, 0, 0, 0.28);
  }
}
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
html { background: var(--paper); }
body {
  margin: 0;
  min-height: 100vh;
  background: var(--paper);
  color: var(--ink);
  font: 15px/1.55 var(--sans);
  letter-spacing: -0.006em;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
h1, h2, p, ul, figure { margin: 0; }
ul { padding: 0; list-style: none; }
a { color: inherit; }
button, input { font: inherit; color: inherit; }
button { cursor: pointer; }
::selection { background: var(--accent); color: var(--accent-ink); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

.app {
  display: grid;
  grid-template-columns: 252px minmax(0, 1fr);
  min-height: 100vh;
  opacity: 1;
  transition: opacity 0.35s ease;
}
body.is-booting .app { opacity: 0; }

.boot {
  position: fixed; inset: 0; z-index: 30;
  display: grid; place-content: center; justify-items: center; gap: 16px;
  background: var(--paper);
  transition: opacity 0.35s ease, visibility 0.35s ease;
}
body:not(.is-booting) .boot { opacity: 0; visibility: hidden; }
.boot-text {
  font: 10px/1 var(--mono); letter-spacing: 0.16em; text-transform: uppercase; color: var(--faint);
}
.boot .mark { animation: breathe 1.6s ease-in-out infinite; }
@keyframes breathe {
  0%, 100% { opacity: 0.55; transform: scale(0.97); }
  50% { opacity: 1; transform: scale(1); }
}

.mark {
  width: 28px; height: 28px; flex: none; border-radius: 7px;
  display: grid; place-items: center;
  background: var(--ink); color: var(--paper);
  font: 600 14px/1 var(--serif);
}
.mark-lg { width: 46px; height: 46px; border-radius: 11px; font-size: 21px; }

.rail {
  position: sticky; top: 0; height: 100vh;
  display: flex; flex-direction: column; gap: 38px;
  padding: 30px 26px 26px;
  border-right: 1px solid var(--line);
  background: var(--paper);
}
.brand {
  display: inline-flex; align-items: center; gap: 11px;
  text-decoration: none; font-weight: 600; letter-spacing: -0.02em;
}
.brand-name { font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav { display: grid; gap: 9px; }
.nav-label {
  padding-left: 10px;
  font: 9.5px/1 var(--mono); letter-spacing: 0.16em; text-transform: uppercase; color: var(--faint);
}
.nav-item {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 10px; border-radius: 8px;
  text-decoration: none; font-size: 13.5px; color: var(--muted);
  transition: color 0.15s ease, background 0.15s ease;
}
.nav-item:hover { color: var(--ink); background: var(--surface); }
.nav-item.is-current { color: var(--ink); background: var(--surface); box-shadow: inset 0 0 0 1px var(--line); }
.nav-item svg { width: 16px; height: 16px; flex: none; }

.rail-foot { margin-top: auto; display: grid; gap: 12px; }
.account {
  display: flex; align-items: center; gap: 10px; min-width: 0;
  padding-top: 17px; border-top: 1px solid var(--line);
}
.avatar {
  width: 32px; height: 32px; flex: none; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--accent-soft); color: var(--accent);
  font: 600 12px/1 var(--mono); text-transform: uppercase;
}
.account-copy { display: grid; gap: 2px; min-width: 0; }
.account-email { font-size: 12px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.account-note { font: 9.5px/1.2 var(--mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint); }
.rail-actions { display: flex; align-items: center; gap: 2px; }
.icon-button {
  width: 34px; height: 34px; flex: none; border-radius: 8px;
  border: 1px solid transparent; background: transparent;
  display: grid; place-items: center; color: var(--muted);
  transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}
.icon-button:hover { color: var(--ink); background: var(--surface); border-color: var(--line); }
.icon { width: 16px; height: 16px; display: block; }
.icon-sun { display: none; }
.icon-moon { display: block; }
:root[data-theme="dark"] .icon-sun { display: block; }
:root[data-theme="dark"] .icon-moon { display: none; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .icon-sun { display: block; }
  :root:not([data-theme="light"]) .icon-moon { display: none; }
}
.text-button {
  border: 0; background: transparent; border-radius: 6px;
  padding: 5px 7px; font-size: 12px; color: var(--muted);
  transition: color 0.15s ease, background 0.15s ease;
}
.text-button:hover { color: var(--ink); background: var(--surface); }
.text-button.subtle { font-size: 11px; padding: 2px 4px; }
.text-button:disabled { opacity: 0.5; cursor: default; }

.main {
  width: 100%; max-width: 1060px;
  padding: clamp(34px, 5vw, 64px) clamp(24px, 5vw, 72px) 76px;
}

.eyebrow {
  display: flex; align-items: center; gap: 9px;
  font: 10px/1 var(--mono); letter-spacing: 0.18em; text-transform: uppercase; color: var(--faint);
}
.eyebrow::before { content: ""; display: inline-block; width: 18px; height: 1px; background: var(--line-strong); }
h1 {
  margin-top: 22px;
  font-family: var(--serif); font-weight: 500;
  font-size: clamp(38px, 5.2vw, 62px); line-height: 0.99; letter-spacing: -0.035em;
  text-wrap: balance;
}
.lede { margin-top: 22px; max-width: 42ch; font-size: 16px; line-height: 1.65; color: var(--muted); }

.auth {
  display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(340px, 420px);
  gap: clamp(36px, 6vw, 92px); align-items: start;
  max-width: 980px; padding-top: clamp(4px, 4vh, 44px);
}
.auth-intro { padding-top: 8px; }
.points {
  display: grid; gap: 13px; max-width: 360px;
  margin-top: 34px; padding-top: 22px; border-top: 1px solid var(--line);
}
.points li { display: flex; align-items: center; gap: 11px; font-size: 13.5px; color: var(--muted); }
.point-mark { width: 5px; height: 5px; flex: none; border-radius: 50%; background: var(--accent); }

.auth-card {
  background: var(--surface-raised);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: var(--shadow);
  padding: 8px;
}
.auth-tabs {
  display: grid; grid-template-columns: 1fr 1fr; gap: 2px;
  padding: 4px; border-radius: 9px; background: var(--paper-deep);
}
.auth-tab {
  padding: 9px 8px; border: 0; border-radius: 6px;
  background: transparent; color: var(--muted);
  font-size: 12.5px; font-weight: 500;
  transition: color 0.15s ease, background 0.15s ease;
}
.auth-tab:hover { color: var(--ink); }
.auth-tab.is-active { background: var(--surface-raised); color: var(--ink); box-shadow: 0 1px 2px rgba(30, 24, 16, 0.08); }
.auth-form { padding: 24px 22px 22px; }
.auth-form h2 {
  font-family: var(--serif); font-size: 27px; line-height: 1.1;
  font-weight: 500; letter-spacing: -0.025em;
}
.auth-sub { margin-top: 8px; font-size: 13px; line-height: 1.55; color: var(--muted); }
.field { margin-top: 18px; }
label { display: block; margin-bottom: 7px; font-size: 12px; font-weight: 600; color: var(--muted); }
.label-row { display: flex; align-items: center; justify-content: space-between; }
.label-row label { margin-bottom: 7px; }
input {
  width: 100%; height: 44px; padding: 0 13px;
  border: 1px solid var(--line-strong); border-radius: 8px;
  background: var(--surface-raised); color: var(--ink);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
input::placeholder { color: var(--faint); }
input:hover { border-color: var(--muted); }
input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.hint { margin-top: 7px; font-size: 11.5px; color: var(--faint); }
.error {
  margin-top: 14px; padding: 9px 11px;
  border-radius: 7px; background: var(--danger-soft);
  color: var(--danger); font-size: 12.5px; line-height: 1.5;
}
.primary {
  height: 42px; padding: 0 18px;
  border: 1px solid var(--accent); border-radius: 8px;
  background: var(--accent); color: var(--accent-ink);
  font-size: 13.5px; font-weight: 600;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}
.primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
.primary:active { transform: translateY(1px); }
.primary:disabled { opacity: 0.55; cursor: default; transform: none; }
.primary.wide { width: 100%; height: 44px; margin-top: 20px; }
.fine { margin-top: 17px; font-size: 11.5px; line-height: 1.6; color: var(--faint); }

.board { max-width: 760px; }
.board-head {
  display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; flex-wrap: wrap;
  padding-bottom: 28px; border-bottom: 1px solid var(--line);
}
.board h1 { margin-top: 16px; font-size: clamp(34px, 4.4vw, 50px); }
.summary { margin-top: 11px; font-size: 13.5px; color: var(--muted); }
.progress { width: 190px; padding-bottom: 5px; }
.progress-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.progress-value { font-family: var(--serif); font-size: 26px; letter-spacing: -0.02em; }
.progress-caption { font: 9.5px/1 var(--mono); letter-spacing: 0.12em; text-transform: uppercase; color: var(--faint); }
.progress-track { margin-top: 9px; height: 4px; border-radius: 99px; background: var(--paper-deep); overflow: hidden; }
.progress-fill {
  display: block; height: 100%; width: 0;
  border-radius: inherit; background: var(--accent);
  transition: width 0.4s cubic-bezier(0.2, 0.7, 0.2, 1);
}

.composer {
  display: flex; align-items: center; gap: 10px;
  margin-top: 28px; padding: 7px 7px 7px 14px;
  border: 1px solid var(--line-strong); border-radius: 12px;
  background: var(--surface-raised);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.composer:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.composer-icon { display: grid; place-items: center; flex: none; color: var(--faint); }
.composer-icon svg { width: 18px; height: 18px; }
.composer input { flex: 1; min-width: 0; height: 40px; padding: 0 2px; border: 0; background: transparent; }
.composer input:hover { border-color: transparent; }
.composer input:focus, .composer input:focus-visible { outline: none; box-shadow: none; }
.composer .primary { height: 38px; }
.composer-error { margin-top: 10px; }

.toolbar {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  margin-top: 26px;
}
.segmented {
  display: inline-flex; gap: 2px; padding: 3px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--surface);
}
.segment {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 11px; border: 0; border-radius: 6px;
  background: transparent; color: var(--muted); font-size: 12px;
  transition: color 0.15s ease, background 0.15s ease;
}
.segment:hover { color: var(--ink); }
.segment.is-active { background: var(--surface-raised); color: var(--ink); box-shadow: 0 1px 2px rgba(30, 24, 16, 0.07); }
.segment-count { min-width: 10px; text-align: center; font: 10px/1 var(--mono); color: var(--faint); }
.segment.is-active .segment-count { color: var(--accent); }
.shortcut { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--faint); }
kbd {
  padding: 3px 5px; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 4px;
  background: var(--surface); color: var(--muted); font: 10px/1 var(--mono);
}

.list { margin-top: 14px; border-top: 1px solid var(--line); }
.item {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 15px 2px; border-bottom: 1px solid var(--line);
}
.item-check {
  width: 22px; height: 22px; flex: none; margin-top: 1px; padding: 0;
  border: 1.5px solid var(--line-strong); border-radius: 50%;
  background: transparent; color: transparent;
  display: grid; place-items: center;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}
.item-check:hover { border-color: var(--accent); color: var(--accent); }
.item-check svg { width: 12px; height: 12px; opacity: 0; transition: opacity 0.15s ease; }
.item-body { flex: 1; min-width: 0; display: grid; gap: 3px; }
.item-title { font-size: 14.5px; line-height: 1.45; overflow-wrap: anywhere; }
.item-meta {
  font: 9.5px/1.4 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--faint);
}
.item-delete {
  width: 30px; height: 30px; flex: none; padding: 0;
  border: 0; border-radius: 6px; background: transparent;
  display: grid; place-items: center; color: var(--faint);
  opacity: 0; transition: opacity 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.item:hover .item-delete, .item:focus-within .item-delete { opacity: 1; }
.item-delete:hover { color: var(--danger); background: var(--danger-soft); }
.item-delete svg { width: 14px; height: 14px; }
.item.is-done .item-check { background: var(--ok); border-color: var(--ok); color: var(--surface-raised); }
.item.is-done .item-check svg { opacity: 1; }
.item.is-done .item-title { color: var(--faint); text-decoration: line-through; text-decoration-thickness: 1px; text-decoration-color: var(--line-strong); }
.item.is-done .item-meta { color: var(--faint); }

.empty {
  margin-top: 16px; padding: 44px 24px;
  border: 1px dashed var(--line-strong); border-radius: 12px;
  background: var(--surface); text-align: center;
}
.empty-mark {
  position: relative; display: block;
  width: 34px; height: 34px; margin: 0 auto 16px;
  border: 1.5px solid var(--line-strong); border-radius: 50%;
}
.empty-mark::after {
  content: ""; position: absolute; inset: 0; margin: auto;
  width: 8px; height: 8px; border-radius: 50%; background: var(--line-strong);
}
.empty-title { font-family: var(--serif); font-size: 19px; letter-spacing: -0.01em; }
.empty-copy { max-width: 38ch; margin: 6px auto 0; font-size: 13px; line-height: 1.55; color: var(--muted); }

.board-foot {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin-top: 32px;
  font: 9.5px/1.4 var(--mono); letter-spacing: 0.07em; text-transform: uppercase; color: var(--faint);
}
.foot-dot { width: 5px; height: 5px; flex: none; border-radius: 50%; background: var(--ok); }
.foot-sep { color: var(--line-strong); }

.offline { max-width: 540px; padding-top: 9vh; }
.offline h1 { font-size: clamp(34px, 4vw, 46px); }
.offline .lede { max-width: 46ch; }
.offline .primary { margin-top: 26px; }

.toast {
  position: fixed; left: 50%; bottom: 26px; z-index: 40;
  display: flex; align-items: center; gap: 14px;
  max-width: calc(100vw - 32px);
  padding: 11px 12px 11px 16px;
  border-radius: 9px; background: var(--ink); color: var(--paper);
  box-shadow: var(--shadow); font-size: 13px;
  opacity: 0; transform: translate(-50%, 8px);
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.toast.is-visible { opacity: 1; transform: translate(-50%, 0); }
.toast-action {
  flex: none; padding: 4px 8px; border: 0; border-radius: 5px;
  background: transparent; color: var(--accent-ink);
  font-size: 13px; font-weight: 600;
  text-decoration: underline; text-underline-offset: 3px;
}
.toast-action:hover { background: rgba(255, 255, 255, 0.1); }
.noscript {
  position: fixed; left: 16px; right: 16px; bottom: 16px; z-index: 50;
  margin: 0; padding: 14px 16px;
  border: 1px solid var(--line); border-radius: 9px;
  background: var(--surface-raised); color: var(--muted); font-size: 13px;
}

@media (max-width: 1024px) {
  .auth { grid-template-columns: 1fr; gap: 38px; max-width: 520px; margin-inline: auto; }
  .auth-intro { padding-top: 0; }
  .points { max-width: none; }
}
@media (max-width: 1024px) {
  .app { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .rail {
    position: static; height: auto; z-index: 10;
    flex-direction: row; align-items: center; gap: 14px;
    padding: 14px 18px; border-right: 0; border-bottom: 1px solid var(--line);
  }
  .nav, .account { display: none; }
  .rail-foot { margin: 0 0 0 auto; display: flex; align-items: center; gap: 2px; }
  .rail-actions { gap: 2px; }
  .main { padding: 30px 18px 56px; }
  .board { margin-inline: auto; }
  .auth { padding-top: 0; }
  .auth-card { padding: 7px; }
  .auth-form { padding: 21px 17px 19px; }
  h1 { font-size: clamp(34px, 10vw, 48px); }
  .board-head { align-items: flex-start; gap: 20px; padding-bottom: 24px; }
  .progress { width: 100%; max-width: 230px; }
  .composer { padding: 6px 6px 6px 12px; }
  .composer .primary { padding: 0 14px; }
  .toolbar { flex-direction: column; align-items: flex-start; gap: 10px; }
  .shortcut { display: none; }
  .item-delete { opacity: 0.55; }
  .toast { bottom: 16px; }
}
@media (hover: none) {
  .item-delete { opacity: 0.55; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
`,

    'public/app.js': `// Paths are relative on purpose: the same page is served at the site root and
// behind a preview path prefix while the app is being built. An absolute path
// would escape the prefix and hit the wrong server.
const $ = (id) => document.getElementById(id);

let items = [];
let filter = 'all';
let mode = 'signup';
let toastTimer = null;
let toastHideTimer = null;

const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>';

async function call(path, options) {
  try {
    const response = await fetch(path, options);
    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      data = {};
    }
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, status: 0, data: { error: 'The server did not answer. Try again.' } };
  }
}

function sendJson(path, method, body) {
  return call(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function setError(id, message) {
  const node = $(id);
  if (!node) return;
  node.hidden = !message;
  node.textContent = message || '';
}

function formatDate() {
  const now = new Date();
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(now);
  } catch (error) {
    return now.toDateString();
  }
}

function relativeTime(value) {
  if (!value) return '';
  const then = new Date(value).getTime();
  if (!isFinite(then)) return '';
  const diff = Date.now() - then;
  const minute = 60000;
  const hour = minute * 60;
  const day = hour * 24;
  if (diff < minute) return 'just now';
  if (diff < hour) return Math.floor(diff / minute) + 'm ago';
  if (diff < day) return Math.floor(diff / hour) + 'h ago';
  if (diff < day * 2) return 'yesterday';
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(then));
  } catch (error) {
    return '';
  }
}

function itemRow(item) {
  const row = document.createElement('li');
  row.className = 'item' + (item.done ? ' is-done' : '');
  row.dataset.id = String(item.id);

  const check = document.createElement('button');
  check.type = 'button';
  check.className = 'item-check';
  check.setAttribute('role', 'checkbox');
  check.setAttribute('aria-checked', item.done ? 'true' : 'false');
  check.setAttribute('aria-label', (item.done ? 'Mark as open: ' : 'Mark as done: ') + item.title);
  check.innerHTML = CHECK_ICON;
  check.addEventListener('click', (event) => toggleItem(item, event.detail === 0));

  const body = document.createElement('div');
  body.className = 'item-body';
  const title = document.createElement('p');
  title.className = 'item-title';
  title.textContent = item.title;
  const meta = document.createElement('p');
  meta.className = 'item-meta';
  meta.textContent = item.done ? 'Done' : 'Added ' + relativeTime(item.created_at);
  body.append(title, meta);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'item-delete';
  remove.setAttribute('aria-label', 'Delete: ' + item.title);
  remove.innerHTML = TRASH_ICON;
  remove.addEventListener('click', () => deleteItem(item));

  row.append(check, body, remove);
  return row;
}

function counts() {
  const done = items.filter((item) => item.done).length;
  return { done: done, open: items.length - done, all: items.length };
}

function visibleItems() {
  const shown = items.filter((item) => {
    if (filter === 'open') return !item.done;
    if (filter === 'done') return item.done;
    return true;
  });
  return shown.sort((a, b) => {
    if (Boolean(a.done) !== Boolean(b.done)) return a.done ? 1 : -1;
    return Number(b.id) - Number(a.id);
  });
}

function renderCounts() {
  const numbers = counts();
  $('count-all').textContent = String(numbers.all);
  $('count-open').textContent = String(numbers.open);
  $('count-done').textContent = String(numbers.done);
  $('summary').textContent = numbers.all === 0
    ? 'Nothing on it yet.'
    : numbers.open + ' open · ' + numbers.done + ' done';

  const percent = numbers.all === 0 ? 0 : Math.round((numbers.done / numbers.all) * 100);
  $('progress-value').textContent = percent + '%';
  $('progress-fill').style.width = percent + '%';
}

function emptyCopy() {
  if (filter === 'open') {
    return { title: 'Everything is done', copy: 'Nothing is waiting on you. Add something new when you are ready.' };
  }
  if (filter === 'done') {
    return { title: 'Nothing finished yet', copy: 'Check something off, and it will rest here.' };
  }
  return { title: 'Nothing here yet', copy: 'Add the first thing above, and it will show up here.' };
}

function renderList() {
  const shown = visibleItems();
  const list = $('list');
  list.textContent = '';
  for (const item of shown) list.append(itemRow(item));

  const empty = $('empty');
  empty.hidden = shown.length > 0;
  if (!shown.length) {
    const copy = emptyCopy();
    $('empty-title').textContent = copy.title;
    $('empty-copy').textContent = copy.copy;
  }

  $('list-status').textContent = shown.length + (shown.length === 1 ? ' item shown.' : ' items shown.');
}

function renderAll() {
  renderCounts();
  renderList();
}

function updateFilterButtons() {
  document.querySelectorAll('[data-filter]').forEach((button) => {
    const active = button.dataset.filter === filter;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function focusAfterChange(id) {
  const next = document.querySelector('[data-id="' + id + '"] .item-check');
  if (next) {
    next.focus();
    return;
  }
  if (!$('signed-in').hidden) $('title').focus();
}

function replaceItem(updated) {
  if (!updated) return;
  items = items.map((item) => (String(item.id) === String(updated.id) ? updated : item));
}

async function toggleItem(item, restoreFocus) {
  const next = !item.done;
  item.done = next;
  renderAll();
  if (restoreFocus) focusAfterChange(item.id);

  const result = await sendJson('api/items/' + encodeURIComponent(item.id), 'PATCH', { done: next });
  if (!result.ok) {
    item.done = !next;
    renderAll();
    if (restoreFocus) focusAfterChange(item.id);
    showToast(result.data.error || 'That change did not save.');
    return;
  }

  replaceItem(result.data.item);
  renderAll();
  if (restoreFocus) focusAfterChange(item.id);
}

async function restoreItem(item) {
  const created = await sendJson('api/items', 'POST', { title: item.title });
  if (!created.ok) {
    showToast(created.data.error || 'That item could not be restored.');
    return;
  }
  if (item.done && created.data.item) {
    await sendJson('api/items/' + encodeURIComponent(created.data.item.id), 'PATCH', { done: true });
  }
  const listed = await call('api/items');
  if (listed.ok && Array.isArray(listed.data.items)) items = listed.data.items;
  renderAll();
  showToast('Item restored.');
}

async function deleteItem(item) {
  const result = await call('api/items/' + encodeURIComponent(item.id), { method: 'DELETE' });
  if (!result.ok) {
    showToast(result.data.error || 'That item could not be deleted.');
    return;
  }
  items = items.filter((entry) => String(entry.id) !== String(item.id));
  renderAll();
  showToast('Removed “' + item.title + '”.', { label: 'Undo', run: () => restoreItem(item) });
}

function showToast(message, action) {
  const toast = $('toast');
  const button = $('toast-action');
  $('toast-text').textContent = message;
  button.hidden = !action;
  button.onclick = action
    ? () => {
        hideToast();
        action.run();
      }
    : null;
  if (action) button.textContent = action.label;

  clearTimeout(toastTimer);
  clearTimeout(toastHideTimer);
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  toastTimer = setTimeout(hideToast, action ? 6000 : 3800);
}

function hideToast() {
  const toast = $('toast');
  clearTimeout(toastTimer);
  toast.classList.remove('is-visible');
  clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(() => {
    toast.hidden = true;
  }, 220);
}

function updateAccount(user) {
  const email = user ? user.email : 'Not signed in';
  $('who').textContent = email;
  $('who').title = email;
  $('foot-user').textContent = email;
  $('avatar').textContent = user ? (user.email.charAt(0) || '?').toUpperCase() : '·';
  $('signout').hidden = !user;
  $('account').hidden = !user;
  $('workspace-nav').hidden = !user;
}

async function enterApp(user) {
  $('signed-out').hidden = true;
  $('offline').hidden = true;
  $('today-label').textContent = formatDate();
  setError('item-error', '');

  const listed = await call('api/items');
  if (!listed.ok) {
    setError('item-error', listed.data.error || 'Could not load your list.');
    items = [];
  } else {
    items = Array.isArray(listed.data.items) ? listed.data.items : [];
  }
  updateAccount(user);
  renderAll();
  $('signed-in').hidden = false;
}

function showAuth() {
  $('signed-in').hidden = true;
  $('offline').hidden = true;
  $('signed-out').hidden = false;
  updateAccount(null);
  items = [];
  filter = 'all';
  updateFilterButtons();
  renderAll();
  setError('auth-error', '');
}

function showOffline() {
  $('signed-out').hidden = true;
  $('signed-in').hidden = true;
  $('offline').hidden = false;
  updateAccount(null);
}

function setMode(next) {
  mode = next;
  document.querySelectorAll('.auth-tab').forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  const signup = mode === 'signup';
  $('auth-title').textContent = signup ? 'Make it yours' : 'Welcome back';
  $('auth-sub').textContent = signup
    ? "Your account lives in this app's own database."
    : 'Sign in to pick up where you left off.';
  $('auth-submit').textContent = signup ? 'Create account' : 'Sign in';
  $('auth-fine').textContent = signup
    ? 'No verification email. Your password is hashed before it is stored.'
    : 'One email and password, and your list is right where you left it.';
  $('password').setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
  $('password-hint').hidden = !signup;
  setError('auth-error', '');
}

function resolvedTheme() {
  const chosen = document.documentElement.getAttribute('data-theme');
  if (chosen === 'light' || chosen === 'dark') return chosen;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function updateThemeButton() {
  const theme = resolvedTheme();
  $('theme-toggle').setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  $('theme-toggle').setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
}

async function boot() {
  const me = await call('api/me');
  if (!me.ok) {
    showOffline();
    return;
  }
  if (me.data.user) {
    await enterApp(me.data.user);
  } else {
    showAuth();
  }
}

document.querySelectorAll('.auth-tab').forEach((tab) => {
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
  tab.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = mode === 'signup' ? 'signin' : 'signup';
    setMode(next);
    document.querySelector('.auth-tab[data-mode="' + next + '"]').focus();
  });
});

$('auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = $('email').value.trim();
  const password = $('password').value;
  const submit = $('auth-submit');
  const buttons = Array.from($('auth-form').querySelectorAll('button'));

  if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) {
    setError('auth-error', 'Enter a valid email address.');
    $('email').focus();
    return;
  }
  if (mode === 'signup' && password.length < 8) {
    setError('auth-error', 'Use a password of at least 8 characters.');
    $('password').focus();
    return;
  }
  if (!password) {
    setError('auth-error', 'Enter your password.');
    $('password').focus();
    return;
  }

  buttons.forEach((button) => {
    button.disabled = true;
  });
  submit.textContent = mode === 'signup' ? 'Creating account…' : 'Signing in…';
  setError('auth-error', '');

  const result = await sendJson('api/' + mode, 'POST', { email: email, password: password });

  buttons.forEach((button) => {
    button.disabled = false;
  });
  submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';

  if (!result.ok) {
    setError('auth-error', result.data.error || 'That did not work.');
    return;
  }

  $('password').value = '';
  $('show-password').textContent = 'Show';
  $('show-password').setAttribute('aria-pressed', 'false');
  $('password').type = 'password';
  await enterApp(result.data.user);
});

$('show-password').addEventListener('click', () => {
  const input = $('password');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  $('show-password').textContent = showing ? 'Show' : 'Hide';
  $('show-password').setAttribute('aria-pressed', showing ? 'false' : 'true');
  input.focus();
});

$('item-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('title');
  const title = input.value.trim();
  const button = $('add-button');

  if (!title) {
    setError('item-error', 'Give it a name first.');
    input.focus();
    return;
  }

  button.disabled = true;
  setError('item-error', '');
  const result = await sendJson('api/items', 'POST', { title: title });
  button.disabled = false;

  if (!result.ok) {
    setError('item-error', result.data.error || 'Could not add that.');
    return;
  }

  input.value = '';
  if (result.data.item) items.unshift(result.data.item);
  if (filter === 'done') {
    filter = 'all';
    updateFilterButtons();
  }
  renderAll();
  input.focus();
});

document.querySelectorAll('[data-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    filter = button.dataset.filter;
    updateFilterButtons();
    renderList();
  });
});

$('signout').addEventListener('click', async () => {
  $('signout').disabled = true;
  await sendJson('api/signout', 'POST', {});
  $('signout').disabled = false;
  hideToast();
  showAuth();
  $('email').focus();
});

$('theme-toggle').addEventListener('click', () => {
  const next = resolvedTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem('theme', next);
  } catch (error) {}
  updateThemeButton();
});

if (window.matchMedia) {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  if (query.addEventListener) query.addEventListener('change', updateThemeButton);
}

$('retry').addEventListener('click', () => {
  document.body.classList.add('is-booting');
  boot()
    .catch(showOffline)
    .finally(() => document.body.classList.remove('is-booting'));
});

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
  if (typing) {
    if (event.key === 'Escape') target.blur();
    return;
  }
  if ($('signed-in').hidden) return;
  if (event.key === 'n' || event.key === 'N') {
    event.preventDefault();
    $('title').focus();
  }
});

setMode('signup');
updateAccount(null);
updateThemeButton();

boot()
  .catch(showOffline)
  .finally(() => document.body.classList.remove('is-booting'));
`,
    'public/favicon.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#1e1b16"/><path d="M9 16.5l4.2 4L23 11" fill="none" stroke="#f4f1ea" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
`,
  };
}
