/**
 * Persistence for the authorization server.
 *
 * Every method opens a transaction and sets `power.scope = 'oauth'`, mirroring
 * the way `PgStore.scoped` sets `power.user_id`. That is what makes the two
 * policy families in `pgstore.ts` mutually exclusive, so a bug in a tool
 * handler cannot read a token and a bug here cannot read a tenant's projects.
 *
 * No bearer value is stored. Tokens, codes, magic links and session ids are
 * held as `sha256` hex, so a dump of this database does not let anyone act as
 * a user. Client secrets are the one exception, because the SDK's client
 * authentication compares them in plaintext — and the clients that matter
 * (Claude, registered through DCR) are public clients with no secret at all.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Plan } from '@power/protocol';
import type { Sql } from '../pgstore.js';
import type { GoogleProfile } from './google.js';

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** 32 bytes of randomness, url-safe. Long enough that guessing is not a threat. */
export const randomToken = (): string => randomBytes(32).toString('base64url');

export interface PendingAuthorization {
  id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state: string | null;
  scopes: string[];
  resource: string | null;
  csrf_nonce: string;
  expires_at: Date;
}

export interface AuthorizationCode {
  code_hash: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  scopes: string[];
  resource: string | null;
  expires_at: Date;
}

export interface AccessTokenRow {
  token_hash: string;
  client_id: string;
  user_id: string;
  scopes: string[];
  resource: string | null;
  expires_at: Date;
}

export interface RefreshTokenRow extends AccessTokenRow {
  family_id: string;
}

export interface BrowserSession {
  id_hash: string;
  user_id: string;
  expires_at: Date;
  user_agent?: string | null;
  ip?: string | null;
}

export interface LoginChallenge {
  token_hash: string;
  email: string;
  expires_at: Date;
  ip?: string | null;
}

/** One parked trip to Google, keyed by the hash of the state it minted. */
export interface LoginFlow {
  state_hash: string;
  nonce: string;
  code_verifier: string;
  next: string;
  expires_at: Date;
}

export interface AccountProfile {
  email: string | null;
  name: string | null;
  onboarded: boolean;
}

/** What the account page may show about a browser session. Never its token. */
export interface SessionSummary {
  id_hash: string;
  created_at: Date;
  last_seen_at: Date;
  user_agent: string | null;
  ip: string | null;
}

export interface OAuthStore {
  getClient(clientId: string): Promise<OAuthClientInformationFull | undefined>;
  insertClient(client: OAuthClientInformationFull): Promise<void>;

  putPendingAuthorization(p: PendingAuthorization): Promise<void>;
  readPendingAuthorization(id: string): Promise<PendingAuthorization | null>;
  consumePendingAuthorization(id: string): Promise<PendingAuthorization | null>;

  insertCode(code: AuthorizationCode): Promise<void>;
  readCode(codeHash: string): Promise<AuthorizationCode | null>;
  consumeCode(codeHash: string): Promise<AuthorizationCode | null>;

  insertAccessToken(t: AccessTokenRow): Promise<void>;
  readAccessToken(tokenHash: string): Promise<AccessTokenRow | null>;
  revokeAccessToken(tokenHash: string): Promise<void>;

  insertRefreshToken(t: RefreshTokenRow): Promise<void>;
  rotateRefreshToken(oldHash: string, next: RefreshTokenRow): Promise<RefreshTokenRow | null>;
  readRefreshToken(tokenHash: string): Promise<(RefreshTokenRow & { rotated_to: string | null }) | null>;
  revokeFamily(familyId: string): Promise<void>;

  insertLoginChallenge(c: LoginChallenge): Promise<void>;
  consumeLoginChallenge(tokenHash: string): Promise<LoginChallenge | null>;

  insertLoginFlow(flow: LoginFlow): Promise<void>;
  consumeLoginFlow(stateHash: string): Promise<LoginFlow | null>;

  insertSession(s: BrowserSession): Promise<void>;
  readSession(idHash: string): Promise<BrowserSession | null>;
  deleteSession(idHash: string): Promise<void>;
  listSessions(userId: string): Promise<SessionSummary[]>;
  deleteSessionForUser(userId: string, idHash: string): Promise<boolean>;
  deleteAllSessions(userId: string): Promise<void>;

  userIdForEmail(email: string): Promise<string | null>;
  userIdForGoogleSub(sub: string): Promise<string | null>;
  createUser(email: string, plan?: Plan): Promise<{ user_id: string; plan: Plan }>;
  createUserWithGoogle(profile: GoogleProfile): Promise<{ user_id: string; plan: Plan }>;
  linkGoogleAccount(userId: string, profile: GoogleProfile): Promise<void>;
  profileOf(userId: string): Promise<AccountProfile | null>;
  renameUser(userId: string, name: string): Promise<void>;
  markOnboarded(userId: string): Promise<void>;
}

export class PgOAuthStore implements OAuthStore {
  constructor(private readonly sql: Sql) {}

  /** Every statement here runs in the oauth scope and nowhere else. */
  private scoped<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
    return this.sql.transaction(async (tx) => {
      await tx.query(`select set_config('power.scope', 'oauth', true)`);
      return fn(tx);
    });
  }

  // ---- clients

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<ClientRow>(`select * from oauth_clients where client_id = $1`, [clientId]);
      return rows[0] ? toClient(rows[0]) : undefined;
    });
  }

  async insertClient(client: OAuthClientInformationFull): Promise<void> {
    await this.scoped(async (tx) => {
      await tx.query(
        `insert into oauth_clients (
           client_id, client_secret, client_id_issued_at, client_secret_expires_at,
           client_name, client_uri, logo_uri, redirect_uris, grant_types, response_types,
           token_endpoint_auth_method, scope, software_id, raw_metadata
         ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14::jsonb)`,
        [
          client.client_id,
          client.client_secret ?? null,
          client.client_id_issued_at ?? Math.floor(Date.now() / 1000),
          client.client_secret_expires_at ?? null,
          client.client_name ?? null,
          client.client_uri ?? null,
          client.logo_uri ?? null,
          JSON.stringify(client.redirect_uris),
          JSON.stringify(client.grant_types ?? ['authorization_code', 'refresh_token']),
          JSON.stringify(client.response_types ?? ['code']),
          client.token_endpoint_auth_method ?? 'none',
          client.scope ?? null,
          client.software_id ?? null,
          JSON.stringify(client),
        ],
      );
    });
  }

  // ---- pending authorizations

  async putPendingAuthorization(p: PendingAuthorization): Promise<void> {
    await this.scoped(async (tx) => {
      await tx.query(
        `insert into oauth_pending_authorizations
           (id, client_id, redirect_uri, code_challenge, state, scopes, resource, csrf_nonce, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [p.id, p.client_id, p.redirect_uri, p.code_challenge, p.state, p.scopes, p.resource, p.csrf_nonce, p.expires_at],
      );
    });
  }

  async readPendingAuthorization(id: string): Promise<PendingAuthorization | null> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<PendingRow>(
        `select * from oauth_pending_authorizations
          where id = $1 and consumed_at is null and expires_at > now()`,
        [id],
      );
      return rows[0] ? toPending(rows[0]) : null;
    });
  }

  /** Single-use: a second consume of the same request returns null. */
  async consumePendingAuthorization(id: string): Promise<PendingAuthorization | null> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<PendingRow>(
        `update oauth_pending_authorizations set consumed_at = now()
          where id = $1 and consumed_at is null and expires_at > now()
          returning *`,
        [id],
      );
      return rows[0] ? toPending(rows[0]) : null;
    });
  }

  // ---- authorization codes

  async insertCode(c: AuthorizationCode): Promise<void> {
    await this.scoped(async (tx) => {
      await tx.query(
        `insert into oauth_authorization_codes
           (code_hash, client_id, user_id, redirect_uri, code_challenge, scopes, resource, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [c.code_hash, c.client_id, c.user_id, c.redirect_uri, c.code_challenge, c.scopes, c.resource, c.expires_at],
      );
    });
  }

  /** Non-consuming, for `challengeForAuthorizationCode`, which runs before the exchange. */
  async readCode(codeHash: string): Promise<AuthorizationCode | null> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<CodeRow>(
        `select * from oauth_authorization_codes
          where code_hash = $1 and consumed_at is null and expires_at > now()`,
        [codeHash],
      );
      return rows[0] ? toCode(rows[0]) : null;
    });
  }

  /**
   * Atomic. A replayed code updates zero rows and returns null, which the
   * caller turns into `invalid_grant` — a code is good exactly once.
   */
  async consumeCode(codeHash: string): Promise<AuthorizationCode | null> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<CodeRow>(
        `update oauth_authorization_codes set consumed_at = now()
          where code_hash = $1 and consumed_at is null and expires_at > now()
          returning *`,
        [codeHash],
      );
      return rows[0] ? toCode(rows[0]) : null;
    });
  }

  // ---- access tokens

  async insertAccessToken(t: AccessTokenRow): Promise<void> {
    await this.scoped(async (tx) => {
      await tx.query(
        `insert into oauth_access_tokens (token_hash, client_id, user_id, scopes, resource, expires_at)
         values ($1,$2,$3,$4,$5,$6)`,
        [t.token_hash, t.client_id, t.user_id, t.scopes, t.resource, t.expires_at],
      );
    });
  }

  async readAccessToken(tokenHash: string): Promise<AccessTokenRow | null> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<TokenRow>(
        `select * from oauth_access_tokens
          where token_hash = $1 and revoked_at is null and expires_at > now()`,
        [tokenHash],
      );
      return rows[0] ? toToken(rows[0]) : null;
    });
  }

  async revokeAccessToken(tokenHash: string): Promise<void> {
    await this.scoped(async (tx) => {
      await tx.query(`update oauth_access_tokens set revoked_at = now() where token_hash = $1 and revoked_at is null`, [
        tokenHash,
      ]);
    });
  }

  // ---- refresh tokens

  async insertRefreshToken(t: RefreshTokenRow): Promise<void> {
    await this.scoped(async (tx) => {
      await tx.query(
        `insert into oauth_refresh_tokens (token_hash, family_id, client_id, user_id, scopes, resource, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [t.token_hash, t.family_id, t.client_id, t.user_id, t.scopes, t.resource, t.expires_at],
      );
    });
  }

  async readRefreshToken(tokenHash: string): Promise<(RefreshTokenRow & { rotated_to: string | null }) | null> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<RefreshRow>(`select * from oauth_refresh_tokens where token_hash = $1`, [
        tokenHash,
      ]);
      return rows[0] ? { ...toRefresh(rows[0]), rotated_to: rows[0].rotated_to } : null;
    });
  }

  /**
   * Rotation and issue in one transaction.
   *
   * The update only matches a token that has not already been rotated, so a
   * token presented twice updates zero rows. The caller reads it back, sees
   * `rotated_to` set, and treats that as a leak rather than a retry.
   */
  async rotateRefreshToken(oldHash: string, next: RefreshTokenRow): Promise<RefreshTokenRow | null> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<RefreshRow>(
        `update oauth_refresh_tokens set rotated_to = $2
          where token_hash = $1 and rotated_to is null and revoked_at is null and expires_at > now()
          returning *`,
        [oldHash, next.token_hash],
      );
      if (!rows[0]) return null;
      await tx.query(
        `insert into oauth_refresh_tokens (token_hash, family_id, client_id, user_id, scopes, resource, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [next.token_hash, next.family_id, next.client_id, next.user_id, next.scopes, next.resource, next.expires_at],
      );
      return toRefresh(rows[0]);
    });
  }

  /** A reused refresh token means the family leaked, so none of it survives. */
  async revokeFamily(familyId: string): Promise<void> {
    await this.scoped(async (tx) => {
      await tx.query(`update oauth_refresh_tokens set revoked_at = now() where family_id = $1 and revoked_at is null`, [
        familyId,
      ]);
      await tx.query(
        `update oauth_access_tokens set revoked_at = now()
          where revoked_at is null and user_id in (select user_id from oauth_refresh_tokens where family_id = $1)
            and client_id in (select client_id from oauth_refresh_tokens where family_id = $1)`,
        [familyId],
      );
    });
  }

  // ---- login and sessions

  async insertLoginChallenge(c: LoginChallenge): Promise<void> {
    await this.scoped(async (tx) => {
      await tx.query(`insert into login_challenges (token_hash, email, expires_at, ip) values ($1,$2,$3,$4)`, [
        c.token_hash,
        c.email,
        c.expires_at,
        c.ip ?? null,
      ]);
    });
  }

  async consumeLoginChallenge(tokenHash: string): Promise<LoginChallenge | null> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<LoginRow>(
        `update login_challenges set consumed_at = now()
          where token_hash = $1 and consumed_at is null and expires_at > now()
          returning *`,
        [tokenHash],
      );
      return rows[0] ? { token_hash: rows[0].token_hash, email: rows[0].email, expires_at: new Date(rows[0].expires_at), ip: rows[0].ip } : null;
    });
  }

  async insertLoginFlow(flow: LoginFlow): Promise<void> {
    await this.scoped(async (tx) => {
      await tx.query(
        `insert into oauth_login_flows (state_hash, nonce, code_verifier, next, expires_at) values ($1,$2,$3,$4,$5)`,
        [flow.state_hash, flow.nonce, flow.code_verifier, flow.next, flow.expires_at],
      );
    });
  }

  async consumeLoginFlow(stateHash: string): Promise<LoginFlow | null> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<FlowRow>(
        `update oauth_login_flows set consumed_at = now()
          where state_hash = $1 and consumed_at is null and expires_at > now()
          returning state_hash, nonce, code_verifier, next, expires_at`,
        [stateHash],
      );
      const row = rows[0];
      return row
        ? {
            state_hash: row.state_hash,
            nonce: row.nonce,
            code_verifier: row.code_verifier,
            next: row.next,
            expires_at: new Date(row.expires_at),
          }
        : null;
    });
  }

  async insertSession(s: BrowserSession): Promise<void> {
    await this.scoped(async (tx) => {
      await tx.query(
        `insert into browser_sessions (id_hash, user_id, expires_at, user_agent, ip) values ($1,$2,$3,$4,$5)`,
        [s.id_hash, s.user_id, s.expires_at, s.user_agent ?? null, s.ip ?? null],
      );
    });
  }

  async readSession(idHash: string): Promise<BrowserSession | null> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<SessionRow>(
        `update browser_sessions set last_seen_at = now()
          where id_hash = $1 and expires_at > now()
          returning *`,
        [idHash],
      );
      return rows[0]
        ? { id_hash: rows[0].id_hash, user_id: rows[0].user_id, expires_at: new Date(rows[0].expires_at), ip: rows[0].ip }
        : null;
    });
  }

  async deleteSession(idHash: string): Promise<void> {
    await this.scoped(async (tx) => {
      await tx.query(`delete from browser_sessions where id_hash = $1`, [idHash]);
    });
  }

  async listSessions(userId: string): Promise<SessionSummary[]> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<SessionRow>(
        `select id_hash, user_id, created_at, expires_at, last_seen_at, user_agent, ip
           from browser_sessions
          where user_id = $1 and expires_at > now()
          order by last_seen_at desc`,
        [userId],
      );
      return rows.map((row) => ({
        id_hash: row.id_hash,
        created_at: new Date(row.created_at),
        last_seen_at: new Date(row.last_seen_at),
        user_agent: row.user_agent,
        ip: row.ip,
      }));
    });
  }

  /** Scoped by user, so a form cannot revoke somebody else's browser. */
  async deleteSessionForUser(userId: string, idHash: string): Promise<boolean> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<{ id_hash: string }>(
        `delete from browser_sessions where id_hash = $1 and user_id = $2 returning id_hash`,
        [idHash, userId],
      );
      return rows.length > 0;
    });
  }

  async deleteAllSessions(userId: string): Promise<void> {
    await this.scoped(async (tx) => {
      await tx.query(`delete from browser_sessions where user_id = $1`, [userId]);
    });
  }

  // ---- users

  async userIdForEmail(email: string): Promise<string | null> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(`select id from users where lower(email) = lower($1)`, [email]);
      return rows[0]?.id ?? null;
    });
  }

  async userIdForGoogleSub(sub: string): Promise<string | null> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(`select id from users where google_sub = $1`, [sub]);
      return rows[0]?.id ?? null;
    });
  }

  /**
   * Create on first sign-in, or adopt a row that already has this verified
   * address (a magic-link account, or the loser of a simultaneous first login).
   * An existing, different Google subject is never overwritten.
   */
  async createUserWithGoogle(profile: GoogleProfile): Promise<{ user_id: string; plan: Plan }> {
    const userId = `usr_${randomBytes(12).toString('base64url')}`;
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<{ id: string; plan: Plan }>(
        `insert into users (id, plan, email, name, google_sub, email_verified_at, terms_accepted_at)
         values ($1, 'free', $2, $3, $4, now(), now())
         on conflict (lower(email)) where email is not null do update
           set google_sub = coalesce(users.google_sub, excluded.google_sub),
               name = coalesce(users.name, excluded.name),
               email_verified_at = coalesce(users.email_verified_at, excluded.email_verified_at)
         returning id, plan`,
        [userId, profile.email, profile.name, profile.sub],
      );
      return { user_id: rows[0]!.id, plan: rows[0]!.plan };
    });
  }

  async linkGoogleAccount(userId: string, profile: GoogleProfile): Promise<void> {
    await this.scoped(async (tx) => {
      await tx.query(
        `update users
            set google_sub = $2,
                name = coalesce(name, $3),
                email = $4,
                email_verified_at = now()
          where id = $1`,
        [userId, profile.sub, profile.name, profile.email],
      );
    });
  }

  async profileOf(userId: string): Promise<AccountProfile | null> {
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<{ email: string | null; name: string | null; onboarded_at: string | null }>(
        `select email, name, onboarded_at from users where id = $1`,
        [userId],
      );
      const row = rows[0];
      return row ? { email: row.email, name: row.name, onboarded: row.onboarded_at !== null } : null;
    });
  }

  async renameUser(userId: string, name: string): Promise<void> {
    await this.scoped(async (tx) => {
      await tx.query(`update users set name = $2 where id = $1`, [userId, name]);
    });
  }

  async markOnboarded(userId: string): Promise<void> {
    await this.scoped(async (tx) => {
      await tx.query(`update users set onboarded_at = coalesce(onboarded_at, now()) where id = $1`, [userId]);
    });
  }

  async createUser(email: string, plan: Plan = 'free'): Promise<{ user_id: string; plan: Plan }> {
    const userId = `usr_${randomBytes(12).toString('base64url')}`;
    return this.scoped(async (tx) => {
      const { rows } = await tx.query<{ id: string; plan: Plan }>(
        `insert into users (id, plan, email) values ($1,$2,$3)
         on conflict (lower(email)) where email is not null do update set email = excluded.email
         returning id, plan`,
        [userId, plan, email.trim().toLowerCase()],
      );
      return { user_id: rows[0]!.id, plan: rows[0]!.plan };
    });
  }
}

// ---- row mapping. Postgres returns text[] and jsonb natively; PGlite matches.

interface ClientRow {
  client_id: string;
  client_secret: string | null;
  client_id_issued_at: string | number;
  client_secret_expires_at: string | number | null;
  client_name: string | null;
  client_uri: string | null;
  logo_uri: string | null;
  redirect_uris: string[] | string;
  grant_types: string[] | string;
  response_types: string[] | string;
  token_endpoint_auth_method: string;
  scope: string | null;
  software_id: string | null;
}
interface PendingRow {
  id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state: string | null;
  scopes: string[];
  resource: string | null;
  csrf_nonce: string;
  expires_at: string;
}
interface CodeRow {
  code_hash: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  scopes: string[];
  resource: string | null;
  expires_at: string;
}
interface TokenRow {
  token_hash: string;
  client_id: string;
  user_id: string;
  scopes: string[];
  resource: string | null;
  expires_at: string;
}
interface RefreshRow extends TokenRow {
  family_id: string;
  rotated_to: string | null;
}
interface LoginRow {
  token_hash: string;
  email: string;
  expires_at: string;
  ip: string | null;
}
interface SessionRow {
  id_hash: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  user_agent: string | null;
  ip: string | null;
}

interface FlowRow {
  state_hash: string;
  nonce: string;
  code_verifier: string;
  next: string;
  expires_at: string;
}

const json = <T,>(value: T[] | string): T[] => (typeof value === 'string' ? (JSON.parse(value) as T[]) : value);

function toClient(r: ClientRow): OAuthClientInformationFull {
  return {
    client_id: r.client_id,
    client_secret: r.client_secret ?? undefined,
    client_id_issued_at: Number(r.client_id_issued_at),
    client_secret_expires_at: r.client_secret_expires_at == null ? undefined : Number(r.client_secret_expires_at),
    client_name: r.client_name ?? undefined,
    client_uri: r.client_uri ?? undefined,
    logo_uri: r.logo_uri ?? undefined,
    redirect_uris: json<string>(r.redirect_uris),
    grant_types: json<string>(r.grant_types),
    response_types: json<string>(r.response_types),
    token_endpoint_auth_method: r.token_endpoint_auth_method,
    scope: r.scope ?? undefined,
    software_id: r.software_id ?? undefined,
  } as OAuthClientInformationFull;
}

const toPending = (r: PendingRow): PendingAuthorization => ({ ...r, expires_at: new Date(r.expires_at) });
const toCode = (r: CodeRow): AuthorizationCode => ({ ...r, expires_at: new Date(r.expires_at) });
const toToken = (r: TokenRow): AccessTokenRow => ({ ...r, expires_at: new Date(r.expires_at) });
const toRefresh = (r: RefreshRow): RefreshTokenRow => ({ ...toToken(r), family_id: r.family_id });
