/**
 * The OAuth tables.
 *
 * Every row here belongs to the server, not to a tenant, which is why they are
 * deliberately kept out of the tenant policies in `pgstore.ts`. If they joined
 * the tenant family their predicate would be `user_id = current_setting(
 * 'power.user_id')`, and a tenant-scoped transaction would then be able to read
 * its own access tokens — a privilege-escalation path out of any SQL mistake in
 * a handler. They get their own scope instead, and the two are mutually
 * exclusive: see `oauthRlsSql`.
 *
 * No bearer value is ever stored. Access tokens, refresh tokens, authorization
 * codes, magic-link tokens and session ids are all held as `sha256` hex, so a
 * copy of this database does not let anyone act as a user.
 */

/** Tables scoped by `power.scope = 'oauth'` rather than by tenant. */
export const OAUTH_TABLES = [
  'oauth_clients',
  'oauth_pending_authorizations',
  'oauth_authorization_codes',
  'oauth_access_tokens',
  'oauth_refresh_tokens',
  'browser_sessions',
  'login_challenges',
  'oauth_login_flows',
] as const;

export const OAUTH_SCHEMA_SQL = `
-- Email is the login identifier. Unique case-insensitively, because people
-- type their own address inconsistently and two rows for one person breaks
-- every later assumption about ownership.
alter table users add column if not exists email text;
create unique index if not exists users_email_key on users (lower(email)) where email is not null;

-- Google is the identity provider; the subject id is what survives an address
-- change. Name and avatar are display data, never identity.
alter table users add column if not exists google_sub text;
create unique index if not exists users_google_sub_key on users (google_sub) where google_sub is not null;
alter table users add column if not exists name text;
alter table users add column if not exists email_verified_at timestamptz;
alter table users add column if not exists terms_accepted_at timestamptz;
-- Set once the first-run screen has been seen, so it never appears twice.
alter table users add column if not exists onboarded_at timestamptz;

create table if not exists oauth_clients (
  client_id text primary key,
  client_secret text,
  client_id_issued_at bigint not null,
  client_secret_expires_at bigint,
  client_name text,
  client_uri text,
  logo_uri text,
  redirect_uris jsonb not null,
  grant_types jsonb not null default '["authorization_code","refresh_token"]'::jsonb,
  response_types jsonb not null default '["code"]'::jsonb,
  token_endpoint_auth_method text not null default 'none',
  scope text,
  software_id text,
  raw_metadata jsonb not null,
  created_at timestamptz not null default now()
);

-- An authorization request parked while the person logs in and consents. The
-- id travels in the ?next= of the login redirect and in the consent URL.
create table if not exists oauth_pending_authorizations (
  id text primary key,
  client_id text not null references oauth_clients(client_id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  state text,
  scopes text[] not null default '{}',
  resource text,
  csrf_nonce text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create table if not exists oauth_authorization_codes (
  code_hash text primary key,
  client_id text not null references oauth_clients(client_id) on delete cascade,
  user_id text not null references users(id),
  redirect_uri text not null,
  code_challenge text not null,
  scopes text[] not null default '{}',
  resource text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create table if not exists oauth_access_tokens (
  token_hash text primary key,
  client_id text not null references oauth_clients(client_id) on delete cascade,
  user_id text not null references users(id),
  scopes text[] not null default '{}',
  resource text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists oauth_access_user on oauth_access_tokens (user_id);

-- family_id survives rotation. Presenting a token that has already been
-- rotated means it leaked, so the whole family is revoked rather than just
-- that one token.
create table if not exists oauth_refresh_tokens (
  token_hash text primary key,
  family_id text not null,
  client_id text not null references oauth_clients(client_id) on delete cascade,
  user_id text not null references users(id),
  scopes text[] not null default '{}',
  resource text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  rotated_to text,
  revoked_at timestamptz
);
create index if not exists oauth_refresh_family on oauth_refresh_tokens (family_id);

create table if not exists browser_sessions (
  id_hash text primary key,
  user_id text not null references users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  user_agent text,
  ip text
);

create table if not exists login_challenges (
  token_hash text primary key,
  email text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  ip text
);
create index if not exists login_challenges_email on login_challenges (email);

-- One row per trip to Google. The state is hashed like every other bearer
-- value; the verifier and nonce live only here, server-side, and the row is
-- spent exactly once so a replayed callback cannot sign anyone in.
create table if not exists oauth_login_flows (
  state_hash text primary key,
  nonce text not null,
  code_verifier text not null,
  next text not null default '/',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
`;
