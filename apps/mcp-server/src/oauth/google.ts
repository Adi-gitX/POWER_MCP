/**
 * Google sign-in, implemented against Google's OpenID Connect endpoints.
 *
 * No SDK: the server already is an OAuth authorization server, and pulling in
 * a second identity stack for one provider would mean two sources of truth for
 * who a person is. The flow is the standard authorization code flow with PKCE,
 * a single-use state and a nonce bound into the ID token, which is exactly what
 * the rest of this directory already reasons about.
 *
 * Only profile claims are kept. Power never asks for offline access and never
 * stores a Google access or refresh token, so a compromise of this database
 * does not hand anyone the person's mail, drive or calendar.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/** Google has used both the scheme-less and scheme-ful issuer over the years. */
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export class GoogleConfigError extends Error {}

/**
 * Everything needed to start one sign-in, created before the redirect and
 * consumed exactly once on the way back.
 */
export interface GoogleFlow {
  state: string;
  codeVerifier: string;
  nonce: string;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

export type GoogleFailure = 'exchange' | 'token' | 'email';

export class GoogleAuthError extends Error {
  constructor(readonly reason: GoogleFailure, message: string) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

const base64url = (buffer: Buffer): string => buffer.toString('base64url');

export function newGoogleFlow(): GoogleFlow {
  return {
    state: base64url(randomBytes(32)),
    // 32 bytes is 43 base64url characters, inside RFC 7636's 43..128 range.
    codeVerifier: base64url(randomBytes(32)),
    nonce: base64url(randomBytes(16)),
  };
}

export function pkceChallenge(codeVerifier: string): string {
  return base64url(createHash('sha256').update(codeVerifier).digest());
}

/**
 * Read the client credentials, or report that Google sign-in is not set up.
 *
 * Neither value present is a supported state: an installation can run with
 * email links only. Exactly one present is always a mistake, and failing at
 * boot is kinder than a button that redirects to Google and comes back with
 * `invalid_client`.
 */
export function googleConfigFromEnv(
  env: NodeJS.ProcessEnv,
  issuer: string,
): GoogleConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId && !clientSecret) return null;
  if (!clientId || !clientSecret) {
    throw new GoogleConfigError('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together');
  }
  const explicit = env.GOOGLE_REDIRECT_URI?.trim();
  return {
    clientId,
    clientSecret,
    redirectUri: explicit || `${issuer.replace(/\/+$/, '')}/auth/google/callback`,
  };
}

export function googleAuthorizationUrl(config: GoogleConfig, flow: GoogleFlow): string {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', flow.state);
  url.searchParams.set('nonce', flow.nonce);
  url.searchParams.set('code_challenge', pkceChallenge(flow.codeVerifier));
  url.searchParams.set('code_challenge_method', 'S256');
  // Always show the chooser: people legitimately have a work and a personal
  // account, and silently reusing the last one is how the wrong account gets
  // connected to a project.
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export interface GoogleOidcOptions {
  /** Injected by tests; production uses global fetch. */
  fetch?: typeof fetch;
  /** Injected by tests; production uses Google's published JWKS. */
  jwks?: JWTVerifyGetKey;
  timeoutMs?: number;
}

export class GoogleOidc {
  private readonly fetchImpl: typeof fetch;
  private readonly jwks: JWTVerifyGetKey;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: GoogleConfig,
    options: GoogleOidcOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.jwks = options.jwks ?? createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  authorizationUrl(flow: GoogleFlow): string {
    return googleAuthorizationUrl(this.config, flow);
  }

  /** Trade the one-time code for an ID token. The token is the only thing kept. */
  async exchange(code: string, codeVerifier: string): Promise<string> {
    const body = new URLSearchParams({
      code,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    });

    let response: Response;
    try {
      response = await this.fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new GoogleAuthError('exchange', 'could not reach Google');
    }

    if (!response.ok) {
      // The body can echo a token or an address; the status is enough to act on.
      throw new GoogleAuthError('exchange', `Google rejected the code (${response.status})`);
    }

    const payload = (await response.json().catch(() => null)) as { id_token?: unknown } | null;
    if (!payload || typeof payload.id_token !== 'string' || payload.id_token.length === 0) {
      throw new GoogleAuthError('exchange', 'Google returned no ID token');
    }
    return payload.id_token;
  }

  /**
   * Verify signature, issuer, audience, expiry and the nonce this flow minted.
   *
   * The signature check is what stops a forged token; the nonce is what stops a
   * genuine token minted for a different sign-in from being replayed here.
   */
  async verify(idToken: string, expectedNonce: string): Promise<GoogleProfile> {
    let payload: Record<string, unknown>;
    try {
      const verified = await jwtVerify(idToken, this.jwks, {
        issuer: GOOGLE_ISSUERS,
        audience: this.config.clientId,
        clockTolerance: 60,
      });
      payload = verified.payload;
    } catch {
      throw new GoogleAuthError('token', 'the ID token could not be verified');
    }

    if (payload.nonce !== expectedNonce) {
      throw new GoogleAuthError('token', 'the ID token belongs to another sign-in');
    }

    const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
    if (!sub) throw new GoogleAuthError('token', 'the ID token has no subject');

    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    if (!email.includes('@') || email.length > 320) {
      throw new GoogleAuthError('email', 'Google did not return an address');
    }

    const verifiedEmail = payload.email_verified === true || payload.email_verified === 'true';
    if (!verifiedEmail) {
      // Linking or creating an account on an unverified address is how an
      // attacker with a Google account for someone else's address takes it over.
      throw new GoogleAuthError('email', 'that Google address is not verified');
    }

    const name = typeof payload.name === 'string' ? payload.name.trim().slice(0, 120) : '';
    return { sub, email, emailVerified: true, name: name || null };
  }
}
