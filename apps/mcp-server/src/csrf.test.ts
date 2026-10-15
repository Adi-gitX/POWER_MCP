import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { mintCsrf, sameOrigin, verifyCsrf } from './csrf.js';

const key = createHash('sha256').update('test-key').digest();
const other = createHash('sha256').update('another-key').digest();

describe('the token on a human decision', () => {
  it('accepts the token it minted for that person and that project', () => {
    const token = mintCsrf(key, 'user_a', 'proj_1');
    expect(verifyCsrf(key, token, 'user_a', 'proj_1')).toEqual({ ok: true });
  });

  it('refuses a token minted for someone else', () => {
    const token = mintCsrf(key, 'user_a', 'proj_1');
    expect(verifyCsrf(key, token, 'user_b', 'proj_1')).toEqual({ ok: false, reason: 'mismatch' });
  });

  /**
   * The confirmation authorises one project. A token that worked across
   * projects would let a page the person was allowed to see authorise a
   * publish on a different app.
   */
  it('refuses a token minted for another project', () => {
    const token = mintCsrf(key, 'user_a', 'proj_1');
    expect(verifyCsrf(key, token, 'user_a', 'proj_2')).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('refuses a token signed with a different key', () => {
    expect(verifyCsrf(key, mintCsrf(other, 'user_a', 'proj_1'), 'user_a', 'proj_1')).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('refuses a tampered signature without throwing', () => {
    const token = mintCsrf(key, 'user_a', 'proj_1');
    const [issued, salt] = token.split('.');
    expect(verifyCsrf(key, `${issued}.${salt}.forged`, 'user_a', 'proj_1').ok).toBe(false);
    // Deliberately a different length: timingSafeEqual throws rather than
    // returning false when lengths differ, so the length check has to come first.
    expect(verifyCsrf(key, `${issued}.${salt}.x`, 'user_a', 'proj_1')).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('names what is wrong, because the page has to say what to do', () => {
    expect(verifyCsrf(key, null, 'user_a', 'proj_1')).toEqual({ ok: false, reason: 'missing' });
    expect(verifyCsrf(key, 'nonsense', 'user_a', 'proj_1')).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyCsrf(key, '--.x.y', 'user_a', 'proj_1')).toEqual({ ok: false, reason: 'malformed' });
    // "zz" is a valid base36 number, so this is a timestamp from 1970 rather
    // than a malformed one, and expiry is the honest answer.
    expect(verifyCsrf(key, 'zz.zz.zz', 'user_a', 'proj_1')).toEqual({ ok: false, reason: 'expired' });
  });

  it('expires, and refuses a token from the future', () => {
    const now = Date.UTC(2026, 9, 8, 12, 0, 0);
    const token = mintCsrf(key, 'user_a', 'proj_1', now);

    expect(verifyCsrf(key, token, 'user_a', 'proj_1', now + 60 * 60 * 1000)).toEqual({ ok: true });
    expect(verifyCsrf(key, token, 'user_a', 'proj_1', now + 3 * 60 * 60 * 1000)).toEqual({
      ok: false,
      reason: 'expired',
    });
    // A token dated ahead of now is as wrong as an expired one; allowing it
    // would let a clock skew widen the window without limit.
    expect(verifyCsrf(key, mintCsrf(key, 'user_a', 'proj_1', now + 600_000), 'user_a', 'proj_1', now)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('mints a different token each time, so one cannot be recognised', () => {
    const a = mintCsrf(key, 'user_a', 'proj_1');
    const b = mintCsrf(key, 'user_a', 'proj_1');
    expect(a).not.toBe(b);
    expect(verifyCsrf(key, a, 'user_a', 'proj_1').ok).toBe(true);
    expect(verifyCsrf(key, b, 'user_a', 'proj_1').ok).toBe(true);
  });
});

describe('where a state-changing request came from', () => {
  const POWER = 'https://mcp.example.com';

  it('accepts a post from Power’s own pages', () => {
    expect(sameOrigin({ origin: POWER, 'sec-fetch-site': 'same-origin' }, POWER)).toEqual({ ok: true });
  });

  it('refuses a form on another site', () => {
    const verdict = sameOrigin({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, POWER);
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.reason).toMatch(/another site/);
  });

  it('refuses an origin that merely looks similar', () => {
    // mcp.example.com.evil.test would pass a naive startsWith or includes.
    expect(sameOrigin({ origin: 'https://mcp.example.com.evil.test' }, POWER).ok).toBe(false);
    expect(sameOrigin({ origin: 'http://mcp.example.com' }, POWER).ok).toBe(false);
  });

  it('falls back to Referer when the browser omits Origin', () => {
    expect(sameOrigin({ referer: `${POWER}/projects/p1` }, POWER)).toEqual({ ok: true });
    expect(sameOrigin({ referer: 'https://evil.example/x' }, POWER).ok).toBe(false);
    expect(sameOrigin({ referer: 'not a url' }, POWER).ok).toBe(false);
  });

  it('refuses a request that says nothing about where it came from', () => {
    // Every browser sends at least one of these on a POST, so a request with
    // none of them is not the browser these endpoints exist for.
    expect(sameOrigin({}, POWER).ok).toBe(false);
  });

  it('refuses a request typed into the address bar', () => {
    // Sec-Fetch-Site: none means no originating page at all.
    expect(sameOrigin({ 'sec-fetch-site': 'none' }, POWER).ok).toBe(false);
  });
});
