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
        items: await query('select id, title, done from items where user_id = $1 order by id desc', [me.id]),
      });
    }
    if (req.method === 'POST') {
      const { title } = await body(req);
      const clean = String(title ?? '').trim();
      if (!clean) return json(res, 400, { error: 'A title is required.' });
      const row = await one('insert into items (user_id, title) values ($1,$2) returning id, title, done', [
        me.id,
        clean.slice(0, 200),
      ]);
      return json(res, 200, { item: row });
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
<title>${slug}</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<main>
  <h1>${slug}</h1>

  <section id="signed-out">
    <p class="lead">Create an account to get started.</p>
    <form id="auth-form">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" required autocomplete="email">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" required minlength="8" autocomplete="current-password">
      <div class="row">
        <button type="submit" data-action="signin">Sign in</button>
        <button type="submit" data-action="signup" class="secondary">Create account</button>
      </div>
      <p class="error" id="auth-error" hidden></p>
    </form>
  </section>

  <section id="signed-in" hidden>
    <p class="lead">Signed in as <strong id="who"></strong> · <a href="#" id="signout">sign out</a></p>
    <form id="item-form">
      <label for="title">Add an item</label>
      <div class="row">
        <input id="title" name="title" required placeholder="Something to do">
        <button type="submit">Add</button>
      </div>
    </form>
    <ul id="items"></ul>
  </section>
</main>
<script src="app.js" type="module"></script>
</body>
</html>
`,

    'public/styles.css': `:root { color-scheme: light dark; --line: #d8dce5; --ink: #16181d; --muted: #5b6270; --accent: #2563eb }
* { box-sizing: border-box }
body { margin: 0; min-height: 100vh; display: grid; place-items: start center; padding: 3rem 1.5rem;
       font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; color: var(--ink) }
main { width: min(34rem, 100%) }
h1 { margin: 0 0 .5rem; font-size: 1.6rem; letter-spacing: -.02em }
.lead { color: var(--muted); margin: 0 0 1.5rem }
label { display: block; font-size: .85rem; font-weight: 600; margin: 1rem 0 .35rem }
input { width: 100%; padding: .65rem .75rem; font: inherit; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: inherit }
.row { display: flex; gap: .5rem; margin-top: 1rem }
.row input { margin: 0 }
button { font: inherit; font-weight: 600; padding: .65rem 1.1rem; border: 1px solid transparent; border-radius: 8px;
         background: var(--accent); color: #fff; cursor: pointer; white-space: nowrap }
button.secondary { background: transparent; color: inherit; border-color: var(--line) }
ul { list-style: none; padding: 0; margin: 1.5rem 0 0; border-top: 1px solid var(--line) }
li { padding: .75rem 0; border-bottom: 1px solid var(--line) }
.error { color: #c0392b; font-size: .9rem }
a { color: var(--accent) }
`,

    'public/app.js': `// Paths are relative on purpose: the same page is served at the site root and
// behind a preview path prefix while the app is being built, and an absolute
// path would escape the prefix and hit the wrong server.
const $ = (id) => document.getElementById(id);

async function call(path, body) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: response.ok, data: await response.json() };
}

async function render() {
  const { data } = await call('api/me');
  const signedIn = Boolean(data.user);
  $('signed-out').hidden = signedIn;
  $('signed-in').hidden = !signedIn;
  if (!signedIn) return;

  $('who').textContent = data.user.email;
  const items = await call('api/items');
  $('items').innerHTML = '';
  for (const item of items.data.items ?? []) {
    const li = document.createElement('li');
    li.textContent = item.title;
    $('items').append(li);
  }
}

$('auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const action = event.submitter?.dataset.action === 'signup' ? 'signup' : 'signin';
  const { ok, data } = await call('api/' + action, { email: $('email').value, password: $('password').value });
  const error = $('auth-error');
  error.hidden = ok;
  error.textContent = ok ? '' : data.error;
  if (ok) await render();
});

$('item-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  await call('api/items', { title: $('title').value });
  $('title').value = '';
  await render();
});

$('signout').addEventListener('click', async (event) => {
  event.preventDefault();
  await call('api/signout', {});
  await render();
});

render();
`,
  };
}
