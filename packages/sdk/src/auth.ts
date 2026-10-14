/**
 * Sign-in for the apps Power builds.
 *
 * This is the capability whose absence capped everything else. Power could
 * write the pages and provision the database, but an app with no way for a
 * person to log in is a demo — and a booking page, a waitlist and a client
 * portal, which are what people actually ask for, all need accounts on the
 * first day.
 *
 * Deliberately small and deliberately boring. It owns four tables in the
 * app's own database, so the app keeps working after an export with nothing
 * to re-wire, and it uses only Node built-ins so there is no dependency to
 * audit and nothing to keep up to date.
 *
 * The security properties match the ones Power uses for its own sign-in:
 * scrypt with a per-user salt, constant-time comparison, opaque session
 * tokens stored only as a hash, single-use magic links, and no answer that
 * reveals whether an address has an account.
 */
import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Db, Email } from './index.js';

const scrypt = promisify(scryptCb) as (p: string | Buffer, s: string | Buffer, k: number) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LINK_TTL_MS = 15 * 60 * 1000;
const MIN_PASSWORD = 8;

export interface AuthUser {
  id: string;
  email: string;
  verified: boolean;
  created_at: string;
}

export interface Session {
  /** Returned once. Only its hash is stored, so it cannot be recovered later. */
  token: string;
  expires_at: string;
  user: AuthUser;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: 'weak_password' | 'bad_email' | 'taken' | 'invalid' | 'expired',
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface Auth {
  /** Create the tables. Idempotent, so call it at startup every time. */
  migrate(): Promise<void>;
  signUp(email: string, password: string): Promise<Session>;
  /** Null for a wrong password *and* for an unknown address: the caller must not be able to tell. */
  signIn(email: string, password: string): Promise<Session | null>;
  verify(token: string): Promise<AuthUser | null>;
  signOut(token: string): Promise<void>;
  /** Every session for one person, for a password change or a lost device. */
  signOutEverywhere(userId: string): Promise<void>;
  /** Passwordless. Always resolves, whether or not the address is known. */
  sendMagicLink(email: string, linkBase: string): Promise<void>;
  consumeMagicLink(token: string): Promise<Session | null>;
  changePassword(userId: string, current: string, next: string): Promise<void>;
  getUser(id: string): Promise<AuthUser | null>;
  deleteUser(id: string): Promise<void>;
}

export const AUTH_SCHEMA_SQL = `
create table if not exists auth_users (
  id text primary key,
  email text not null,
  password_hash text,
  password_salt text,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists auth_users_email on auth_users (lower(email));

create table if not exists auth_sessions (
  token_hash text primary key,
  user_id text not null references auth_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now()
);
create index if not exists auth_sessions_user on auth_sessions (user_id);

create table if not exists auth_links (
  token_hash text primary key,
  email text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
`;

export function createAuth(db: Db, email?: Email): Auth {
  return new DbAuth(db, email);
}

class DbAuth implements Auth {
  constructor(
    private readonly db: Db,
    private readonly mailer?: Email,
  ) {}

  async migrate(): Promise<void> {
    // Split because some drivers refuse more than one statement per call.
    for (const statement of AUTH_SCHEMA_SQL.split(';')) {
      if (statement.trim()) await this.db.query(statement);
    }
  }

  async signUp(rawEmail: string, password: string): Promise<Session> {
    const email = normalise(rawEmail);
    if (!looksLikeEmail(email)) throw new AuthError('That does not look like an email address.', 'bad_email');
    if (password.length < MIN_PASSWORD) {
      throw new AuthError(`Use at least ${MIN_PASSWORD} characters.`, 'weak_password');
    }

    const existing = await this.db.one<{ id: string }>(`select id from auth_users where lower(email) = $1`, [email]);
    if (existing) throw new AuthError('That email already has an account.', 'taken');

    const salt = randomBytes(16).toString('hex');
    const hash = (await scrypt(password, salt, KEY_LENGTH)).toString('hex');
    const id = `usr_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

    await this.db.query(
      `insert into auth_users (id, email, password_hash, password_salt) values ($1,$2,$3,$4)`,
      [id, email, hash, salt],
    );
    return this.startSession(id);
  }

  async signIn(rawEmail: string, password: string): Promise<Session | null> {
    const email = normalise(rawEmail);
    const row = await this.db.one<{ id: string; password_hash: string | null; password_salt: string | null }>(
      `select id, password_hash, password_salt from auth_users where lower(email) = $1`,
      [email],
    );

    // Hash anyway when the account is unknown, so a missing account and a
    // wrong password take the same time to answer.
    const salt = row?.password_salt ?? 'absent';
    const expected = row?.password_hash ?? '0'.repeat(KEY_LENGTH * 2);
    const actual = (await scrypt(password, salt, KEY_LENGTH)).toString('hex');
    if (!row || !row.password_hash || !constantTimeEqual(actual, expected)) return null;

    return this.startSession(row.id);
  }

  async verify(token: string): Promise<AuthUser | null> {
    const row = await this.db.one<UserRow & { expires_at: string }>(
      `update auth_sessions set last_seen_at = now()
        where token_hash = $1 and expires_at > now()
        returning user_id, expires_at`,
      [hash(token)],
    );
    if (!row) return null;
    return this.getUser((row as unknown as { user_id: string }).user_id);
  }

  async signOut(token: string): Promise<void> {
    await this.db.query(`delete from auth_sessions where token_hash = $1`, [hash(token)]);
  }

  async signOutEverywhere(userId: string): Promise<void> {
    await this.db.query(`delete from auth_sessions where user_id = $1`, [userId]);
  }

  async sendMagicLink(rawEmail: string, linkBase: string): Promise<void> {
    const email = normalise(rawEmail);
    if (!looksLikeEmail(email)) throw new AuthError('That does not look like an email address.', 'bad_email');

    const token = randomBytes(32).toString('base64url');
    await this.db.query(`insert into auth_links (token_hash, email, expires_at) values ($1,$2,$3)`, [
      hash(token),
      email,
      new Date(Date.now() + LINK_TTL_MS).toISOString(),
    ]);

    const link = `${linkBase}${linkBase.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
    // Resolves either way. The caller must show the same page whether or not
    // the address is known, or the form becomes a way to test for an account.
    if (this.mailer) {
      await this.mailer.send({
        to: email,
        subject: 'Your sign-in link',
        text: `Sign in: ${link}\n\nThis works once and expires in 15 minutes.`,
      });
    }
  }

  async consumeMagicLink(token: string): Promise<Session | null> {
    const row = await this.db.one<{ email: string }>(
      `update auth_links set consumed_at = now()
        where token_hash = $1 and consumed_at is null and expires_at > now()
        returning email`,
      [hash(token)],
    );
    if (!row) return null;

    // A link both proves the address and signs in, so it creates the account
    // on first use and marks it verified.
    const existing = await this.db.one<{ id: string }>(`select id from auth_users where lower(email) = $1`, [row.email]);
    let id = existing?.id;
    if (!id) {
      id = `usr_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      await this.db.query(`insert into auth_users (id, email, verified) values ($1,$2,true)`, [id, row.email]);
    } else {
      await this.db.query(`update auth_users set verified = true where id = $1`, [id]);
    }
    return this.startSession(id);
  }

  async changePassword(userId: string, current: string, next: string): Promise<void> {
    if (next.length < MIN_PASSWORD) throw new AuthError(`Use at least ${MIN_PASSWORD} characters.`, 'weak_password');
    const row = await this.db.one<{ password_hash: string | null; password_salt: string | null }>(
      `select password_hash, password_salt from auth_users where id = $1`,
      [userId],
    );
    if (!row) throw new AuthError('No such account.', 'invalid');

    if (row.password_hash && row.password_salt) {
      const actual = (await scrypt(current, row.password_salt, KEY_LENGTH)).toString('hex');
      if (!constantTimeEqual(actual, row.password_hash)) throw new AuthError('That password is not right.', 'invalid');
    }

    const salt = randomBytes(16).toString('hex');
    const hashed = (await scrypt(next, salt, KEY_LENGTH)).toString('hex');
    await this.db.query(`update auth_users set password_hash = $1, password_salt = $2 where id = $3`, [hashed, salt, userId]);
    // Everything signed in with the old password stops working.
    await this.signOutEverywhere(userId);
  }

  async getUser(id: string): Promise<AuthUser | null> {
    const row = await this.db.one<UserRow>(
      `select id, email, verified, created_at from auth_users where id = $1`,
      [id],
    );
    return row ? { ...row, created_at: new Date(row.created_at).toISOString() } : null;
  }

  async deleteUser(id: string): Promise<void> {
    await this.db.query(`delete from auth_users where id = $1`, [id]);
  }

  private async startSession(userId: string): Promise<Session> {
    const token = randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + SESSION_TTL_MS);
    await this.db.query(`insert into auth_sessions (token_hash, user_id, expires_at) values ($1,$2,$3)`, [
      hash(token),
      userId,
      expires.toISOString(),
    ]);
    const user = await this.getUser(userId);
    if (!user) throw new AuthError('No such account.', 'invalid');
    return { token, expires_at: expires.toISOString(), user };
  }
}

interface UserRow {
  id: string;
  email: string;
  verified: boolean;
  created_at: string;
}

/** The cookie an app should set. Rejects JavaScript, survives a top-level redirect. */
export function sessionCookie(token: string, options: { secure?: boolean; maxAgeSec?: number } = {}): string {
  const parts = [
    `session=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${options.maxAgeSec ?? Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (options.secure !== false) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(): string {
  return 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

/** Pull the session token out of a Cookie header. */
export function readSessionCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === 'session') return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const normalise = (email: string): string => email.trim().toLowerCase();
const looksLikeEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320;

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
