/**
 * Who a browser is, and where a sign-in may send it afterwards.
 *
 * Both are small functions with outsized consequences: a session cookie that
 * is ignored makes the dashboard unreachable, and an unchecked `next` turns
 * the sign-in page into an open redirect.
 */
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { CompositeAuthenticator, ConnectionTokenAuthenticator, DevAuthenticator, SessionAuthenticator } from './auth.js';
import { createHash } from 'node:crypto';
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

describe('dev auth and browser pages', () => {
  const dev = new DevAuthenticator();
  const load = (url: string, accept = 'text/html,application/xhtml+xml'): IncomingMessage =>
    ({ method: 'GET', url, headers: { accept } }) as IncomingMessage;

  it('leaves a signed-out page load to the sign-in flow instead of the dev account', async () => {
    expect(await dev.authenticate(load('/'))).toBeNull();
    expect(await dev.authenticate(load('/connect'))).toBeNull();
    expect(await dev.authenticate(load('/projects/p1?tab=plan'))).toBeNull();
  });

  it('still answers MCP and API calls, and previews, as the dev user', async () => {
    expect((await dev.authenticate(load('/mcp')))?.user_id).toBe('dev');
    expect((await dev.authenticate(load('/preview/p1/')))?.user_id).toBe('dev');
    expect((await dev.authenticate(load('/projects/p1', '*/*')))?.user_id).toBe('dev');
    const post = { method: 'POST', url: '/mcp', headers: { accept: 'application/json, text/event-stream' } };
    expect((await dev.authenticate(post as IncomingMessage))?.user_id).toBe('dev');
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

describe('connection tokens', () => {
  const hash = createHash('sha256').update('pwr_good').digest('hex');
  const tokens = new ConnectionTokenAuthenticator(async (h) => (h === hash ? 'usr_ada' : null), planOf);

  it('resolves a live token to its owner', async () => {
    expect((await tokens.authenticate(request({ authorization: 'Bearer pwr_good' })))?.user_id).toBe('usr_ada');
  });

  it('ignores other bearer values and unknown tokens', async () => {
    expect(await tokens.authenticate(request({ authorization: 'Bearer oauth-token' }))).toBeNull();
    expect(await tokens.authenticate(request({ authorization: 'Bearer pwr_revoked' }))).toBeNull();
  });

  it('beats the loopback dev user, so a connected tool is its owner', async () => {
    const chain = new CompositeAuthenticator([tokens, new DevAuthenticator()]);
    expect((await chain.authenticate(request({ authorization: 'Bearer pwr_good' })))?.user_id).toBe('usr_ada');
  });
});
