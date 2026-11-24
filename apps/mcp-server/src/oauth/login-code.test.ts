/**
 * The emailed-code sign-in, through the real Express app and a real PGlite
 * control plane. Only the mail provider is replaced: the mailer here keeps
 * what would have been sent so the test can read the code out of it.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openPgliteControlPlane, type ControlPlane } from '../pgstore.js';
import { configFromEnv } from './metadata.js';
import { MailError, type Mailer } from './pages.js';
import { createOAuthApp, MAX_ATTEMPTS } from './routes.js';
import { PgOAuthStore } from './store.js';

let dir: string;
let cp: ControlPlane;
let server: Server;
let base: string;
const inbox: { to: string; subject: string; text: string; html?: string }[] = [];
let failNext = false;

const mailer: Mailer = {
  async send(to, subject, text, html) {
    if (failNext) {
      failNext = false;
      throw new MailError('could not send mail: 503');
    }
    inbox.push({ to, subject, text, ...(html ? { html } : {}) });
    return { id: `msg_${inbox.length}` };
  },
};

const lastCode = (to: string): string => {
  const mail = [...inbox].reverse().find((m) => m.to === to)!;
  return /code is (\d{3}) (\d{3})/.exec(mail.text)!.slice(1).join('');
};
const lastLink = (to: string): string => /link instead: (\S+)/.exec([...inbox].reverse().find((m) => m.to === to)!.text)![1]!;

/** A tiny cookie jar: what a browser would send back. */
class Browser {
  jar = new Map<string, string>();
  async go(path: string, init: RequestInit = {}): Promise<Response> {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(new URL(path, base), { redirect: 'manual', ...init, headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } });
    for (const raw of res.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(';');
      const [name, value] = pair!.split('=') as [string, string];
      if (attrs.some((a) => a.trim().toLowerCase() === 'max-age=0') || value === '') this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return res;
  }
  post(path: string, form: Record<string, string>) {
    return this.go(path, { method: 'POST', body: new URLSearchParams(form), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  }
}

const expireCode = (email: string) =>
  cp.sql.transaction(async (tx) => {
    await tx.query(`select set_config('power.scope', 'oauth', true)`);
    await tx.query(`update login_codes set expires_at = now() - interval '1 second' where email = $1`, [email]);
  });
const skipCooldown = (email: string) =>
  cp.sql.transaction(async (tx) => {
    await tx.query(`select set_config('power.scope', 'oauth', true)`);
    await tx.query(`update login_codes set last_sent_at = now() - interval '1 minute' where email = $1`, [email]);
  });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'power-login-'));
  cp = await openPgliteControlPlane(join(dir, 'cp'));
  server = createServer((req, res) => app(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  app = createOAuthApp({ store: new PgOAuthStore(cp.sql), controlPlane: cp, config: configFromEnv({ POWER_BASE_URL: base }), mailer });
});
let app: ReturnType<typeof createOAuthApp>;

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await cp.close();
  await rm(dir, { recursive: true, force: true });
});

describe('signing in with an emailed code', () => {
  it('sends a code, takes it, and signs the person in', async () => {
    const b = new Browser();
    const start = await b.post('/login', { email: 'Ada@Example.com', next: '/start' });
    expect(start.status).toBe(303);
    expect(start.headers.get('location')).toBe('/login/verify');
    expect(b.jar.has('power_login')).toBe(true);

    const mail = inbox.at(-1)!;
    expect(mail.to).toBe('ada@example.com');
    expect(mail.subject).toMatch(/^Your Power sign-in code: \d{3} \d{3}$/);
    expect(mail.html).toContain(mail.subject.split(': ')[1]);

    const page = await (await b.go('/login/verify')).text();
    expect(page).toContain('ada@example.com');
    expect(page).toContain('autocomplete="one-time-code"');

    const done = await b.post('/login/verify', { code: lastCode('ada@example.com') });
    expect(done.status).toBe(303);
    expect(done.headers.get('location')).toBe('/start');
    expect(b.jar.has('power_session')).toBe(true);
    // The challenge cookie is spent with the code.
    expect(b.jar.has('power_login')).toBe(false);

    // Already signed in: the login link goes straight through.
    expect((await b.go('/login?next=/start')).headers.get('location')).toBe('/start');
  });

  it('accepts the code with spaces, as people paste it', async () => {
    const b = new Browser();
    await b.post('/login', { email: 'spaces@example.com' });
    const code = lastCode('spaces@example.com');
    expect((await b.post('/login/verify', { code: `${code.slice(0, 3)} ${code.slice(3)}` })).status).toBe(303);
  });

  it('works once: neither the code nor the link from the same email signs in again', async () => {
    const b = new Browser();
    await b.post('/login', { email: 'once@example.com' });
    const code = lastCode('once@example.com');
    const link = lastLink('once@example.com');
    await b.post('/login/verify', { code });

    const other = new Browser();
    expect((await other.go(new URL(link).pathname + new URL(link).search)).status).toBe(400);
    // Replaying the code from a browser that never had the challenge gets nowhere.
    expect((await other.post('/login/verify', { code })).status).toBe(410);
  });

  it('counts wrong codes and locks after the limit', async () => {
    const b = new Browser();
    await b.post('/login', { email: 'guess@example.com' });
    const right = lastCode('guess@example.com');
    const wrong = right === '000000' ? '111111' : '000000';

    const first = await b.post('/login/verify', { code: wrong });
    expect(first.status).toBe(400);
    expect(await first.text()).toContain(`${MAX_ATTEMPTS - 1} tries left`);
    for (let i = 1; i < MAX_ATTEMPTS; i++) await b.post('/login/verify', { code: wrong });

    const locked = await b.post('/login/verify', { code: right });
    expect(locked.status).toBe(429);
    expect(await locked.text()).toContain('Too many wrong codes');
    expect(b.jar.has('power_session')).toBe(false);
  });

  it('refuses an expired code and says so', async () => {
    const b = new Browser();
    await b.post('/login', { email: 'late@example.com' });
    const code = lastCode('late@example.com');
    await expireCode('late@example.com');
    const res = await b.post('/login/verify', { code });
    expect(res.status).toBe(410);
    expect(await res.text()).toContain('That code has expired');
  });

  it('resends after the cooldown, and the new code replaces the old one', async () => {
    const b = new Browser();
    await b.post('/login', { email: 'again@example.com' });
    const old = lastCode('again@example.com');

    const early = await b.post('/login/resend', {});
    expect(early.status).toBe(429);
    expect(await early.text()).toContain('You can send a new code in');

    await skipCooldown('again@example.com');
    const resent = await b.post('/login/resend', {});
    expect(resent.headers.get('location')).toBe('/login/verify?resent=1');
    const fresh = lastCode('again@example.com');
    expect(inbox.filter((m) => m.to === 'again@example.com')).toHaveLength(2);

    if (fresh !== old) expect((await b.post('/login/verify', { code: old })).status).toBe(400);
    expect((await b.post('/login/verify', { code: fresh })).status).toBe(303);
  });

  it('says plainly when the email could not be sent, and lets the person retry', async () => {
    const b = new Browser();
    failNext = true;
    const res = await b.post('/login', { email: 'bounce@example.com' });
    expect(res.headers.get('location')).toBe('/login/verify?unsent=1');
    expect(await (await b.go('/login/verify?unsent=1')).text()).toContain('couldn’t send the email');
    await skipCooldown('bounce@example.com');
    expect((await b.post('/login/resend', {})).headers.get('location')).toBe('/login/verify?resent=1');
    expect((await b.post('/login/verify', { code: lastCode('bounce@example.com') })).status).toBe(303);
  });

  it('rejects something that is not an address, keeping what was typed', async () => {
    const res = await new Browser().post('/login', { email: 'not-an-email' });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('does not look like an email address');
    expect(html).toContain('value="not-an-email"');
  });

  it('limits how many codes one address can be sent', async () => {
    for (let i = 0; i < 8; i++) await new Browser().post('/login', { email: 'flood@example.com' });
    const ninth = await new Browser().post('/login', { email: 'flood@example.com' });
    expect(ninth.status).toBe(429);
    expect(inbox.filter((m) => m.to === 'flood@example.com')).toHaveLength(8);
  });

  it('sends a browser without a challenge back to the start', async () => {
    expect((await new Browser().go('/login/verify')).headers.get('location')).toBe('/login');
  });
});
