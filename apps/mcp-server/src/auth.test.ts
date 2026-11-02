/**
 * Who a browser is, and where a sign-in may send it afterwards.
 *
 * Both are small functions with outsized consequences: a session cookie that
 * is ignored makes the dashboard unreachable, and an unchecked `next` turns
 * the sign-in page into an open redirect.
 */
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { CompositeAuthenticator, DevAuthenticator, SessionAuthenticator } from './auth.js';
import { safeNext } from './oauth/routes.js';

const request = (headers: Record<string, string>): IncomingMessage => ({ headers }) as IncomingMessage;
const planOf = async (): Promise<'pro'> => 'pro';

describe('browser sessions', () => {
  const sessions = new SessionAuthenticator(
    async (id) => (id === 'good' ? 'usr_ada' : null),
    planOf,
  );

  it('resolves the account behind the session cookie', async () => {
    expect(await sessions.authenticate(request({ cookie: 'theme=dark; power_session=good' }))).toEqual({
      user_id: 'usr_ada',
      plan: 'pro',
    });
  });

  it('refuses a session it does not know', async () => {
    expect(await sessions.authenticate(request({ cookie: 'power_session=revoked' }))).toBeNull();
  });

  it('refuses a request with no cookie at all', async () => {
    expect(await sessions.authenticate(request({}))).toBeNull();
  });

  it('leaves a bearer request to the API authenticators', async () => {
    // A stale cookie must not answer for a revoked token.
    expect(
      await sessions.authenticate(request({ authorization: 'Bearer abc', cookie: 'power_session=good' })),
    ).toBeNull();
  });

  it('is consulted before dev auth, so a signed-in person is themselves', async () => {
    const chain = new CompositeAuthenticator([sessions, new DevAuthenticator()]);
    expect((await chain.authenticate(request({ cookie: 'power_session=good' })))?.user_id).toBe('usr_ada');
    // A page request with no session still works in local development.
    expect((await chain.authenticate(request({})))?.user_id).toBe('dev');
  });
});

describe('post-login redirects', () => {
  it('returns to the page that asked for a sign-in', () => {
    expect(safeNext('/projects/p1?tab=plan')).toBe('/projects/p1?tab=plan');
  });

  it('keeps a consent request intact', () => {
    expect(safeNext('/oauth/consent?req=abc123')).toBe('/oauth/consent?req=abc123');
  });

  it('refuses a destination on another origin', () => {
    expect(safeNext('https://evil.example/login')).toBe('/');
    expect(safeNext('//evil.example/steal')).toBe('/');
    expect(safeNext('/\\evil.example/steal')).toBe('/');
  });

  it('does not bounce back into the sign-in pages', () => {
    expect(safeNext('/login?next=/')).toBe('/');
    expect(safeNext('/logout')).toBe('/');
  });

  it('falls back home for anything unparseable', () => {
    expect(safeNext('')).toBe('/');
    expect(safeNext(undefined)).toBe('/');
  });
});
