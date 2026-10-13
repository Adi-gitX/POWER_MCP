/**
 * The authorization server, behind the SDK's handlers.
 *
 * The handlers own the parts that are easy to get subtly wrong — PKCE S256
 * verification, the split between errors that may redirect and errors that may
 * not, and the exact OAuth error codes — so this file only has to decide who
 * the person is and what they consented to.
 *
 * `authorize` never issues a code directly, even for someone already signed
 * in. It parks the request and redirects to the consent screen, because a
 * client asking for access to someone's account is something they should see
 * and agree to rather than something that happens behind a redirect.
 */
import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { InvalidGrantError, InvalidRequestError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { POWER_SCOPE, type OAuthConfig } from './metadata.js';
import { expandRedirectUris } from './redirects.js';
import { randomToken, sha256, type OAuthStore } from './store.js';

/** Reads the signed-in user from the browser session cookie. */
export interface SessionReader {
  userIdFor(req: { headers: Record<string, unknown> }): Promise<string | null>;
}

const ACCESS_PREFIX = 'pwr_at_';
const REFRESH_PREFIX = 'pwr_rt_';

export class PowerOAuthProvider implements OAuthServerProvider {
  constructor(
    private readonly store: OAuthStore,
    private readonly config: OAuthConfig,
  ) {}

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: (clientId) => this.store.getClient(clientId),
      registerClient: async (client) => {
        // Whatever was asked for, the stored set always covers Claude's fixed
        // callback and both loopback forms. See redirects.ts for why both.
        const full = {
          ...client,
          redirect_uris: expandRedirectUris(client.redirect_uris ?? []),
        } as OAuthClientInformationFull;
        await this.store.insertClient(full);
        return full;
      },
    };
  }

  /**
   * Park the request and send the person to consent. The id is unguessable and
   * short-lived, and it is the only thing that travels in the URL — the
   * challenge, scopes and redirect stay server-side.
   */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const id = randomToken();
    await this.store.putPendingAuthorization({
      id,
      client_id: client.client_id,
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge,
      state: params.state ?? null,
      scopes: params.scopes?.length ? params.scopes : [POWER_SCOPE],
      resource: params.resource?.href ?? null,
      csrf_nonce: randomToken(),
      expires_at: new Date(Date.now() + 15 * 60 * 1000),
    });
    res.redirect(302, `/oauth/consent?req=${encodeURIComponent(id)}`);
  }

  async challengeForAuthorizationCode(_client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const code = await this.store.readCode(sha256(authorizationCode));
    if (!code) throw new InvalidGrantError('Authorization code is invalid or has expired');
    return code.code_challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    // Consuming is atomic, so a replayed code lands here as null rather than
    // as a second set of tokens.
    const code = await this.store.consumeCode(sha256(authorizationCode));
    if (!code) throw new InvalidGrantError('Authorization code is invalid, expired, or already used');
    if (code.client_id !== client.client_id) throw new InvalidGrantError('Authorization code was issued to another client');
    if (redirectUri !== undefined && redirectUri !== code.redirect_uri) {
      throw new InvalidGrantError('redirect_uri does not match the one used to obtain the code');
    }
    if (resource && code.resource && resource.href !== code.resource) {
      throw new InvalidGrantError('resource does not match the one the code was issued for');
    }
    return this.issue(code.client_id, code.user_id, code.scopes, code.resource, `fam_${randomToken()}`);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const presented = sha256(refreshToken);
    const existing = await this.store.readRefreshToken(presented);

    // A token that was already rotated is one that leaked: the legitimate
    // client would be holding its successor. Kill the whole family rather
    // than just refusing this one request.
    if (existing?.rotated_to) {
      await this.store.revokeFamily(existing.family_id);
      throw new InvalidGrantError('Refresh token has already been used; the session has been revoked');
    }
    if (!existing) throw new InvalidGrantError('Refresh token is invalid or has expired');
    if (existing.client_id !== client.client_id) throw new InvalidGrantError('Refresh token was issued to another client');

    // Narrowing is allowed, widening is not.
    const granted = scopes?.length ? scopes.filter((s) => existing.scopes.includes(s)) : existing.scopes;
    if (scopes?.length && granted.length !== scopes.length) {
      throw new InvalidRequestError('Requested scope exceeds the scope of the original grant');
    }

    const nextRaw = REFRESH_PREFIX + randomToken();
    const rotated = await this.store.rotateRefreshToken(presented, {
      token_hash: sha256(nextRaw),
      family_id: existing.family_id,
      client_id: existing.client_id,
      user_id: existing.user_id,
      scopes: granted,
      resource: resource?.href ?? existing.resource,
      expires_at: new Date(Date.now() + this.config.refreshTokenTtlSec * 1000),
    });
    // Lost a race with a concurrent refresh. Treat it the same as a replay.
    if (!rotated) throw new InvalidGrantError('Refresh token is invalid or has expired');

    const accessRaw = ACCESS_PREFIX + randomToken();
    await this.store.insertAccessToken({
      token_hash: sha256(accessRaw),
      client_id: existing.client_id,
      user_id: existing.user_id,
      scopes: granted,
      resource: resource?.href ?? existing.resource,
      expires_at: new Date(Date.now() + this.config.accessTokenTtlSec * 1000),
    });

    return {
      access_token: accessRaw,
      token_type: 'Bearer',
      expires_in: this.config.accessTokenTtlSec,
      refresh_token: nextRaw,
      scope: granted.join(' '),
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const row = await this.store.readAccessToken(sha256(token));
    if (!row) throw new InvalidGrantError('Access token is invalid, expired, or revoked');
    return {
      token,
      clientId: row.client_id,
      scopes: row.scopes,
      // Always set: a token with no expiry is refused downstream.
      expiresAt: Math.floor(row.expires_at.getTime() / 1000),
      resource: row.resource ? new URL(row.resource) : undefined,
      extra: { user_id: row.user_id },
    };
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const hash = sha256(request.token);
    // The caller does not have to say which kind it is, and revoking the wrong
    // kind is a no-op, so try both.
    await this.store.revokeAccessToken(hash);
    const refresh = await this.store.readRefreshToken(hash);
    if (refresh) await this.store.revokeFamily(refresh.family_id);
  }

  /** Mint a fresh pair. Used by the code exchange and by consent. */
  private async issue(
    clientId: string,
    userId: string,
    scopes: string[],
    resource: string | null,
    familyId: string,
  ): Promise<OAuthTokens> {
    const accessRaw = ACCESS_PREFIX + randomToken();
    const refreshRaw = REFRESH_PREFIX + randomToken();

    await this.store.insertAccessToken({
      token_hash: sha256(accessRaw),
      client_id: clientId,
      user_id: userId,
      scopes,
      resource,
      expires_at: new Date(Date.now() + this.config.accessTokenTtlSec * 1000),
    });
    await this.store.insertRefreshToken({
      token_hash: sha256(refreshRaw),
      family_id: familyId,
      client_id: clientId,
      user_id: userId,
      scopes,
      resource,
      expires_at: new Date(Date.now() + this.config.refreshTokenTtlSec * 1000),
    });

    return {
      access_token: accessRaw,
      token_type: 'Bearer',
      expires_in: this.config.accessTokenTtlSec,
      refresh_token: refreshRaw,
      scope: scopes.join(' '),
    };
  }
}

/** A code, minted once the person has consented. Returned raw; only its hash is stored. */
export async function mintAuthorizationCode(
  store: OAuthStore,
  config: OAuthConfig,
  pending: {
    client_id: string;
    redirect_uri: string;
    code_challenge: string;
    scopes: string[];
    resource: string | null;
  },
  userId: string,
): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  await store.insertCode({
    code_hash: sha256(raw),
    client_id: pending.client_id,
    user_id: userId,
    redirect_uri: pending.redirect_uri,
    code_challenge: pending.code_challenge,
    scopes: pending.scopes,
    resource: pending.resource,
    expires_at: new Date(Date.now() + config.codeTtlSec * 1000),
  });
  return raw;
}
