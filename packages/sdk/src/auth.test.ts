import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuthError, clearSessionCookie, createAuth, readSessionCookie, sessionCookie, type Auth } from './auth.js';
import type { Db, Email, Mail } from './index.js';

let auth: Auth;
const sent: Mail[] = [];

/** The app's own database, which is where everything auth owns lives. */
class PgliteDb implements Db {
  constructor(private readonly pg: PGlite) {}
  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const { rows } = await this.pg.query<T>(sql, params);
    return rows;
  }
  async one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.query<T>(sql, params))[0] ?? null;
  }
  async close(): Promise<void> {
    await this.pg.close();
  }
}

const mailer: Email = {
  async send(mail: Mail) {
    sent.push(mail);
    return { id: `m${sent.length}` };
  },
};

beforeAll(async () => {
  const pg = new PGlite();
  await pg.waitReady;
  auth = createAuth(new PgliteDb(pg), mailer);
  await auth.migrate();
  // Idempotent: a generated app calls this on every boot.
  await auth.migrate();
});

describe('signing up', () => {
  it('creates an account and signs the person straight in', async () => {
    const session = await auth.signUp('Ada@Example.com', 'correct horse battery');
    expect(session.user.email).toBe('ada@example.com');
    expect(session.token).toBeTruthy();
    expect(await auth.verify(session.token)).toMatchObject({ email: 'ada@example.com' });
  });

  it('refuses a weak password and a bad address', async () => {
    await expect(auth.signUp('b@example.com', 'short')).rejects.toThrow(AuthError);
    await expect(auth.signUp('not-an-email', 'correct horse battery')).rejects.toThrow(/email/);
  });

  it('will not create two accounts for one address, whatever the case', async () => {
    await expect(auth.signUp('ADA@example.com', 'another good password')).rejects.toThrow(/already has an account/);
  });

  it('never stores the password', async () => {
    const row = await auth.getUser((await auth.signIn('ada@example.com', 'correct horse battery'))!.user.id);
    expect(JSON.stringify(row)).not.toContain('correct horse battery');
  });
});

describe('signing in', () => {
  it('works with the right password', async () => {
    const session = await auth.signIn('ada@example.com', 'correct horse battery');
    expect(session?.user.email).toBe('ada@example.com');
  });

  /**
   * Both failures must look identical to the caller. If a wrong password and
   * an unknown address give different answers, the form becomes a way to test
   * whether somebody has an account.
   */
  it('answers the same way for a wrong password and an unknown account', async () => {
    expect(await auth.signIn('ada@example.com', 'wrong password here')).toBeNull();
    expect(await auth.signIn('nobody@example.com', 'wrong password here')).toBeNull();
  });
});

describe('sessions', () => {
  it('stops working after signing out', async () => {
    const session = await auth.signUp('bob@example.com', 'a good long password');
    expect(await auth.verify(session.token)).not.toBeNull();
    await auth.signOut(session.token);
    expect(await auth.verify(session.token)).toBeNull();
  });

  it('signs out every device at once', async () => {
    const first = await auth.signUp('carol@example.com', 'a good long password');
    const second = await auth.signIn('carol@example.com', 'a good long password');
    await auth.signOutEverywhere(first.user.id);
    expect(await auth.verify(first.token)).toBeNull();
    expect(await auth.verify(second!.token)).toBeNull();
  });

  it('rejects a token that was never issued', async () => {
    expect(await auth.verify('made-up-token')).toBeNull();
  });
});

describe('magic links', () => {
  it('signs someone in and creates the account on first use', async () => {
    sent.length = 0;
    await auth.sendMagicLink('dave@example.com', 'https://app.example.com/callback');
    const link = sent[0]!.text.match(/token=([\w-]+)/)![1]!;

    const session = await auth.consumeMagicLink(decodeURIComponent(link));
    expect(session?.user.email).toBe('dave@example.com');
    // A link proves the address, so the account comes out verified.
    expect(session?.user.verified).toBe(true);
  });

  it('works exactly once', async () => {
    sent.length = 0;
    await auth.sendMagicLink('erin@example.com', 'https://app.example.com/callback');
    const token = decodeURIComponent(sent[0]!.text.match(/token=([\w-]+)/)![1]!);

    expect(await auth.consumeMagicLink(token)).not.toBeNull();
    expect(await auth.consumeMagicLink(token)).toBeNull();
  });

  it('resolves for an unknown address too, so it cannot be used to probe', async () => {
    sent.length = 0;
    await expect(auth.sendMagicLink('stranger@example.com', 'https://app.example.com/cb')).resolves.toBeUndefined();
    expect(sent).toHaveLength(1);
  });
});

describe('changing a password', () => {
  it('requires the current one and ends every existing session', async () => {
    const session = await auth.signUp('frank@example.com', 'the first password');
    await expect(auth.changePassword(session.user.id, 'wrong', 'the second password')).rejects.toThrow(/not right/);

    await auth.changePassword(session.user.id, 'the first password', 'the second password');
    // Anything signed in with the old password is now dead.
    expect(await auth.verify(session.token)).toBeNull();
    expect(await auth.signIn('frank@example.com', 'the first password')).toBeNull();
    expect(await auth.signIn('frank@example.com', 'the second password')).not.toBeNull();
  });
});

describe('deleting an account', () => {
  it('takes its sessions with it', async () => {
    const session = await auth.signUp('gina@example.com', 'a good long password');
    await auth.deleteUser(session.user.id);
    expect(await auth.verify(session.token)).toBeNull();
    expect(await auth.getUser(session.user.id)).toBeNull();
  });
});

describe('the cookie helpers', () => {
  it('produce a cookie a browser will keep and script cannot read', () => {
    const cookie = sessionCookie('abc');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    // Lax, not Strict: a sign-in that returns via a redirect still arrives.
    expect(cookie).toContain('SameSite=Lax');
  });

  it('round-trip a token and clear it', () => {
    expect(readSessionCookie('session=abc123; other=1')).toBe('abc123');
    expect(readSessionCookie('other=1')).toBeNull();
    expect(readSessionCookie(null)).toBeNull();
    expect(clearSessionCookie()).toContain('Max-Age=0');
  });
});
