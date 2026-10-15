/**
 * Who is calling.
 *
 * OAuth 2.1 is the real path: Claude registers itself, a person signs in and
 * consents, and the access token resolves to the same `Principal` every
 * handler already expects. Because that seam did not change, nothing
 * downstream — `storeFor`, row-level security, metering, the ledger — knows
 * the difference.
 *
 * Static bearer tokens remain for scripts and for the e2e harness. The old
 * "everyone is the dev user" default is gone: it meant one missing
 * environment variable left the server open as a shared tenant on the top
 * plan, and it is now opt-in, loopback-only, and refuses to start otherwise.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { Plan } from './metering.js';

export interface Principal {
  user_id: string;
  plan: Plan;
}

export interface Authenticator {
  authenticate(req: IncomingMessage): Promise<Principal | null>;
}

export const DEV_USER: Principal = { user_id: 'dev', plan: 'power' };

function bearer(req: IncomingMessage): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
  return match ? match[1]!.trim() : null;
}

/**
 * Everyone is the dev user.
 *
 * Only reachable when `POWER_DEV_AUTH=1` is set explicitly *and* the server is
 * bound to loopback. Both conditions, because either one alone has been enough
 * to leave a server open by accident.
 *
 * It declines any request that *did* present a credential. Otherwise a
 * rejected OAuth token would quietly fall through and succeed as the dev user,
 * which hides exactly the failures a developer is trying to see — a revoked
 * token would appear to still work.
 */
export class DevAuthenticator implements Authenticator {
  async authenticate(req: IncomingMessage): Promise<Principal | null> {
    if (req.headers.authorization) return null;
    return DEV_USER;
  }
}

/**
 * Static bearer tokens from configuration: `POWER_TOKENS="tok1:alice:pro,tok2:bob:free"`.
 * Constant-time comparison so a token cannot be guessed a byte at a time.
 */
export class TokenAuthenticator implements Authenticator {
  private readonly tokens: { token: Buffer; principal: Principal }[];

  constructor(spec: string) {
    this.tokens = spec
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((entry) => {
        const [token, user_id, plan = 'free'] = entry.split(':');
        if (!token || !user_id) throw new Error(`bad POWER_TOKENS entry: ${entry}`);
        return { token: Buffer.from(token), principal: { user_id, plan: plan as Plan } };
      });
  }

  async authenticate(req: IncomingMessage): Promise<Principal | null> {
    const given = bearer(req);
    if (!given) return null;
    const presented = Buffer.from(given);
    for (const { token, principal } of this.tokens) {
      if (token.length === presented.length && timingSafeEqual(token, presented)) return principal;
    }
    return null;
  }
}

/**
 * OAuth access tokens.
 *
 * Validation hits the database, so it is cached for a few seconds keyed on the
 * hash of the token. The window is deliberately short: a revoked token stays
 * usable for at most that long, which is the price of not making a round trip
 * on every tool call a chatty client makes.
 */
export class OAuthAuthenticator implements Authenticator {
  private readonly cache = new Map<string, { principal: Principal; until: number }>();

  constructor(
    private readonly verifier: OAuthTokenVerifier,
    private readonly planOf: (userId: string) => Promise<Plan>,
    /** The MCP URL this server is. A token minted for another audience is refused. */
    private readonly resource: string,
    private readonly cacheMs = 10_000,
  ) {}

  async authenticate(req: IncomingMessage): Promise<Principal | null> {
    const token = bearer(req);
    if (!token) return null;

    const key = createHash('sha256').update(token).digest('hex');
    const hit = this.cache.get(key);
    if (hit && hit.until > Date.now()) return hit.principal;

    let userId: string;
    try {
      const info = await this.verifier.verifyAccessToken(token);
      if (!info.expiresAt || info.expiresAt * 1000 <= Date.now()) return null;
      // Audience binding: a token issued for a different MCP server must not
      // work here, or one server's token is every server's token.
      if (info.resource && info.resource.href !== this.resource) return null;
      const claimed = info.extra?.user_id;
      if (typeof claimed !== 'string' || !claimed) return null;
      userId = claimed;
    } catch {
      return null;
    }

    // Read the plan per request rather than freezing it into the token, so an
    // upgrade takes effect without the person reconnecting.
    const principal: Principal = { user_id: userId, plan: await this.planOf(userId) };
    this.cache.set(key, { principal, until: Date.now() + this.cacheMs });
    if (this.cache.size > 10_000) this.cache.clear();
    return principal;
  }

  /** Drop a cached decision immediately, for a revocation in the same process. */
  forget(token: string): void {
    this.cache.delete(createHash('sha256').update(token).digest('hex'));
  }
}

/** Tries each in turn and takes the first that recognises the caller. */
export class CompositeAuthenticator implements Authenticator {
  constructor(private readonly authenticators: Authenticator[]) {}

  async authenticate(req: IncomingMessage): Promise<Principal | null> {
    for (const authenticator of this.authenticators) {
      const principal = await authenticator.authenticate(req);
      if (principal) return principal;
    }
    return null;
  }
}

export interface AuthEnvDeps {
  /** Present once OAuth is wired; absent in tests that only need static tokens. */
  oauth?: { verifier: OAuthTokenVerifier; planOf: (userId: string) => Promise<Plan>; resource: string };
  /** Hostname the server is bound to, used to keep dev auth off a public interface. */
  host?: string;
}

export class AuthConfigError extends Error {}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Compose the authenticators this deployment should accept.
 *
 * Refuses to start with no way to authenticate at all, rather than falling
 * back to letting everyone in — which is what the previous default did.
 */
export function authenticatorFromEnv(env: NodeJS.ProcessEnv, deps: AuthEnvDeps = {}): Authenticator {
  const chain: Authenticator[] = [];

  if (deps.oauth) {
    chain.push(new OAuthAuthenticator(deps.oauth.verifier, deps.oauth.planOf, deps.oauth.resource));
  }
  if (env.POWER_TOKENS) {
    chain.push(new TokenAuthenticator(env.POWER_TOKENS));
  }

  if (env.POWER_DEV_AUTH === '1') {
    const host = deps.host ?? 'localhost';
    if (!LOOPBACK.has(host)) {
      throw new AuthConfigError(
        `POWER_DEV_AUTH=1 authenticates every request as the dev user and is only allowed on loopback, ` +
          `but the server is bound to "${host}"`,
      );
    }
    chain.push(new DevAuthenticator());
  }

  if (chain.length === 0) {
    throw new AuthConfigError(
      'no way to authenticate a request: configure OAuth, set POWER_TOKENS, or set POWER_DEV_AUTH=1 on loopback',
    );
  }
  return chain.length === 1 ? chain[0]! : new CompositeAuthenticator(chain);
}
