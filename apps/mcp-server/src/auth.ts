/**
 * Who is calling.
 *
 * Production uses OAuth 2.1 with dynamic client registration through a vendor
 * IdP — that is what Claude and ChatGPT need to connect at all, and it is not
 * something to hand-roll. Until that is wired, requests authenticate with a
 * bearer token that maps to a user and a plan. The seam is `Authenticator`:
 * the OAuth implementation validates the access token and returns the same
 * `Principal`, and nothing downstream changes.
 *
 * Locally, with no tokens configured, every request is the single dev user.
 */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Plan } from './metering.js';

export interface Principal {
  user_id: string;
  plan: Plan;
}

export interface Authenticator {
  authenticate(req: IncomingMessage): Promise<Principal | null>;
}

export const DEV_USER: Principal = { user_id: 'dev', plan: 'power' };

/** Everyone is the dev user. Only for `pnpm dev` with no tokens configured. */
export class DevAuthenticator implements Authenticator {
  async authenticate(): Promise<Principal> {
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
    const header = req.headers.authorization ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) return null;
    const given = Buffer.from(match[1]!.trim());
    for (const { token, principal } of this.tokens) {
      if (token.length === given.length && timingSafeEqual(token, given)) return principal;
    }
    return null;
  }
}

export function authenticatorFromEnv(env: NodeJS.ProcessEnv): Authenticator {
  return env.POWER_TOKENS ? new TokenAuthenticator(env.POWER_TOKENS) : new DevAuthenticator();
}
