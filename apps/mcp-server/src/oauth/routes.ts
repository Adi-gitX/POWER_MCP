/**
 * Everything the authorization server serves, as one Express app that the
 * hand-rolled `node:http` router delegates to.
 *
 * An Express app is itself a `(req, res)` listener, so the bridge is a single
 * call in `index.ts` and the rest of the server stays as it was.
 *
 * The SDK's `mcpAuthRouter` is deliberately not used. It serves protected
 * resource metadata only at the path-suffixed URL while our challenge points
 * at the unsuffixed one, and it installs rate limits — 50 token requests per
 * 15 minutes, 20 registrations per hour — that would lock out a busy client.
 * Composing the four handlers directly costs a few lines and gives exact
 * control of both.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';
import { authorizationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { clientRegistrationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/register.js';
import { revocationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/revoke.js';
import { tokenHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/token.js';
import type { ControlPlane } from '../pgstore.js';
import {
  authorizationServerMetadata,
  isLoopback,
  protectedResourceMetadata,
  type OAuthConfig,
} from './metadata.js';
import {
  consentPage,
  linkExpiredPage,
  loginPage,
  loginSentPage,
  requestExpiredPage,
  type Mailer,
} from './pages.js';
import { mintAuthorizationCode, PowerOAuthProvider } from './provider.js';
import { randomToken, sha256, type OAuthStore } from './store.js';
import { readCookie, SESSION_COOKIE } from './cookies.js';

export { SESSION_COOKIE, sessionIdFromHeader } from './cookies.js';

export interface OAuthDeps {
  store: OAuthStore;
  controlPlane: ControlPlane;
  config: OAuthConfig;
  mailer: Mailer;
  /** Enables /login/dev, which signs in with no email round trip. Never in production. */
  devLogin?: boolean;
  /**
   * Prints the sign-in link on the "check your email" page instead of only in
   * the server log. Only when mail goes nowhere (the console mailer) and the
   * issuer is loopback, so it cannot become an unauthenticated backdoor on a
   * deployment that forgot to configure a mailer.
   */
  devLink?: boolean;
}

/** Paths the Express app owns. Checked by index.ts before its own routing. */
const OAUTH_PREFIXES = ['/.well-known/oauth-', '/oauth/', '/login', '/logout'];
export function isOAuthPath(pathname: string): boolean {
  return OAUTH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

export function createOAuthApp(deps: OAuthDeps): Express {
  const { store, controlPlane, config, mailer } = deps;
  const provider = new PowerOAuthProvider(store, config);
  const app = express();

  app.disable('x-powered-by');
  // Bodies here are small and fixed-shape; 64 KiB is far more than any of them
  // needs and keeps an unbounded read off a public endpoint.
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(express.json({ limit: '64kb' }));

  // ---- discovery. Public, cacheable, and CORS-open: a browser-based client
  // has to be able to read these before it has any credential to send.
  const metadata = (body: Record<string, unknown>) => (_req: Request, res: Response) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('cache-control', 'public, max-age=3600');
    res.json(body);
  };
  app.get('/.well-known/oauth-authorization-server', metadata(authorizationServerMetadata(config)));
  // Served at both paths with identical bodies: our challenge advertises the
  // unsuffixed one, and a client that probes falls back to the suffixed one.
  app.get('/.well-known/oauth-protected-resource', metadata(protectedResourceMetadata(config)));
  app.get('/.well-known/oauth-protected-resource/mcp', metadata(protectedResourceMetadata(config)));

  // ---- the four SDK handlers. Rate limiting is off here and belongs at the
  // edge, where it can see the real client address.
  app.use('/oauth/authorize', authorizationHandler({ provider, rateLimit: false }));
  app.use('/oauth/token', tokenHandler({ provider, rateLimit: false }));
  app.use('/oauth/register', clientRegistrationHandler({ clientsStore: provider.clientsStore, rateLimit: false }));
  app.use('/oauth/revoke', revocationHandler({ provider, rateLimit: false }));

  // ---- login

  app.get('/login', async (req, res) => {
    const next = safeNext(req.query.next);
    // Already signed in: the link that sent them here should not ask again.
    // This is also what makes "Start building" on the site land in the app.
    if (await sessionUser(req)) {
      res.redirect(302, next);
      return;
    }
    res.type('html').send(loginPage(next));
  });

  app.post('/login', async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const next = safeNext(req.body?.next);
    if (!email.includes('@') || email.length > 320) {
      res.status(400).type('html').send(loginPage(next, 'That does not look like an email address.'));
      return;
    }

    const raw = randomToken();
    await store.insertLoginChallenge({
      token_hash: sha256(raw),
      email,
      expires_at: new Date(Date.now() + config.loginChallengeTtlSec * 1000),
      ip: clientIp(req),
    });

    const link = `${config.issuer}/login/callback?token=${encodeURIComponent(raw)}&next=${encodeURIComponent(next)}`;
    try {
      await mailer.send(email, 'Your Power sign-in link', `Sign in: ${link}\n\nThis works once and expires in 15 minutes.`);
    } catch (error) {
      console.error('[power] could not send sign-in mail', error);
    }
    // Rendered whether or not the address is known, and whether or not the
    // send succeeded, so the form cannot be used to test for an account.
    res.type('html').send(loginSentPage(email, deps.devLink ? link : undefined));
  });

  app.get('/login/callback', async (req, res) => {
    const token = String(req.query.token ?? '');
    if (!token) {
      res.status(400).type('html').send(linkExpiredPage('invalid'));
      return;
    }
    const challenge = await store.consumeLoginChallenge(sha256(token));
    if (!challenge) {
      // Consumed, expired or never real — all the same from here, and the
      // page offers a new link rather than explaining which.
      res.status(400).type('html').send(linkExpiredPage('expired'));
      return;
    }
    await signIn(res, challenge.email, clientIp(req), req.headers['user-agent']);
    res.redirect(302, safeNext(req.query.next));
  });

  if (deps.devLogin) {
    // CI and local development only: the e2e harness needs a session without
    // a mailbox. Guarded by an explicit flag so it cannot ship by accident.
    app.get('/login/dev', async (req, res) => {
      const email = String(req.query.email ?? 'dev@localhost');
      await signIn(res, email, clientIp(req), req.headers['user-agent']);
      res.redirect(302, safeNext(req.query.next));
    });
  }

  app.get('/logout', async (req, res) => {
    const sid = cookie(req, SESSION_COOKIE);
    if (sid) await store.deleteSession(sha256(sid));
    res.setHeader('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`);
    res.redirect(302, '/login');
  });

  // ---- consent

  app.get('/oauth/consent', async (req, res) => {
    const id = String(req.query.req ?? '');
    const pending = id ? await store.readPendingAuthorization(id) : null;
    if (!pending) {
      res.status(400).type('html').send(requestExpiredPage());
      return;
    }

    const userId = await sessionUser(req);
    if (!userId) {
      res.redirect(302, `/login?next=${encodeURIComponent(`/oauth/consent?req=${id}`)}`);
      return;
    }

    const client = await store.getClient(pending.client_id);
    const email = await emailFor(userId);
    res.type('html').send(
      consentPage({
        clientName: client?.client_name ?? 'An application',
        // The spec requires the redirect host to be visible, because that is
        // the only part a person can use to tell a real client from a lookalike.
        redirectHost: new URL(pending.redirect_uri).host,
        email,
        requestId: id,
        csrf: pending.csrf_nonce,
      }),
    );
  });

  app.post('/oauth/consent', async (req, res) => {
    // Top-level form post from our own origin; anything else is forged.
    const origin = req.headers.origin;
    if (origin && origin !== config.issuer) {
      res.status(403).type('text').send('bad origin');
      return;
    }

    const id = String(req.body?.req ?? '');
    const pending = id ? await store.readPendingAuthorization(id) : null;
    if (!pending) {
      res.status(400).type('html').send(requestExpiredPage());
      return;
    }
    if (!constantTimeEqual(String(req.body?.csrf ?? ''), pending.csrf_nonce)) {
      res.status(403).type('text').send('bad request');
      return;
    }

    const userId = await sessionUser(req);
    if (!userId) {
      res.redirect(302, `/login?next=${encodeURIComponent(`/oauth/consent?req=${id}`)}`);
      return;
    }

    // Single-use: the parked request is spent whichever way they decided.
    const claimed = await store.consumePendingAuthorization(id);
    if (!claimed) {
      res.status(400).type('html').send(requestExpiredPage());
      return;
    }

    const target = new URL(claimed.redirect_uri);
    if (String(req.body?.decision) !== 'allow') {
      target.searchParams.set('error', 'access_denied');
      if (claimed.state) target.searchParams.set('state', claimed.state);
      res.redirect(302, target.href);
      return;
    }

    const code = await mintAuthorizationCode(store, config, claimed, userId);
    target.searchParams.set('code', code);
    if (claimed.state) target.searchParams.set('state', claimed.state);
    res.redirect(302, target.href);
  });

  // ---- helpers bound to this app's dependencies

  async function signIn(res: Response, email: string, ip: string | null, userAgent?: string): Promise<void> {
    let userId = await store.userIdForEmail(email);
    if (!userId) userId = (await store.createUser(email)).user_id;
    // Keeps the tenant-side `users` row in step, which metering reads.
    await controlPlane.ensureUser(userId);

    const raw = randomToken();
    await store.insertSession({
      id_hash: sha256(raw),
      user_id: userId,
      expires_at: new Date(Date.now() + config.sessionTtlSec * 1000),
      user_agent: userAgent ?? null,
      ip,
    });

    // SameSite=Lax, not Strict: consent is reached by a top-level redirect in
    // from claude.ai, and Strict would drop the cookie and loop the person
    // back through login forever.
    const secure = !isLoopback(new URL(config.issuer).hostname);
    res.setHeader(
      'set-cookie',
      [
        `${SESSION_COOKIE}=${raw}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${config.sessionTtlSec}`,
        ...(secure ? ['Secure'] : []),
      ].join('; '),
    );
  }

  async function sessionUser(req: Request): Promise<string | null> {
    const sid = cookie(req, SESSION_COOKIE);
    if (!sid) return null;
    return (await store.readSession(sha256(sid)))?.user_id ?? null;
  }

  async function emailFor(userId: string): Promise<string> {
    const { rows } = await controlPlane.sql.query<{ email: string | null }>(`select email from users where id = $1`, [
      userId,
    ]);
    return rows[0]?.email ?? userId;
  }

  return app;
}

export function newCsrfNonce(): string {
  return randomBytes(16).toString('base64url');
}

// ---- small helpers

function cookie(req: Request, name: string): string | null {
  return readCookie(req.headers.cookie, name);
}

/**
 * Where to go after signing in: somewhere on this origin, never anywhere else.
 *
 * An open `next` on a login route is how a sign-in page becomes a phishing
 * redirector, so the value is resolved as a path and anything that changes the
 * origin is discarded. Sign-in pages are excluded too, or an expired session
 * could bounce between them forever.
 */
export function safeNext(value: unknown): string {
  const next = typeof value === 'string' ? value : '';
  if (!next) return '/';
  try {
    const base = new URL('http://power.invalid');
    const target = new URL(next, base);
    if (target.origin !== base.origin) return '/';
    if (target.pathname === '/login' || target.pathname === '/logout') return '/';
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return '/';
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0]!.trim();
  return req.socket.remoteAddress ?? null;
}

/** Exposed for the boot-time self check in index.ts. */
export const metadataDigest = (config: OAuthConfig): string =>
  createHash('sha256').update(JSON.stringify(protectedResourceMetadata(config))).digest('hex').slice(0, 8);
