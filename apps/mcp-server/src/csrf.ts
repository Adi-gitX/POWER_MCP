/**
 * Protecting the two decisions that stay with a person.
 *
 * Approving a plan and confirming a change to the live app are the only things
 * Power will not let an assistant do for itself. Both were plain POST forms
 * with no token and no origin check, which meant any page on the internet
 * could submit them in a logged-in person's browser, and the product's central
 * claim held only as long as nobody tried.
 *
 * Two defences, because they fail in different places.
 *
 * `assertSameOrigin` is the strong one for ordinary cross-site forgery: a
 * browser always sends `Origin` on a POST, so a form on another site is
 * rejected before any work happens. It cannot help against content served
 * from Power's own origin, because that content's origin *is* Power's.
 *
 * The token is what makes a request prove it came from a page Power rendered
 * for this person. It is an HMAC over the user, the project and a timestamp,
 * so there is nothing to store and nothing to expire by hand.
 *
 * Neither defends against a page on the same origin, which can simply read a
 * token out of Power's own HTML. That is why previews must be served from a
 * different host, and why the preview route refuses to share this one.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Long enough for someone to read a plan properly, short enough to matter. */
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

export const CSRF_FIELD = 'csrf';

/**
 * A token bound to one person and one project.
 *
 * Binding the project as well as the user means a token minted on a page the
 * person was allowed to see cannot be replayed against a different project,
 * which matters because the confirmation it authorises is per project.
 */
export function mintCsrf(key: Buffer, userId: string, projectId: string, now = Date.now()): string {
  const issued = now.toString(36);
  const salt = randomBytes(8).toString('base64url');
  return `${issued}.${salt}.${sign(key, userId, projectId, issued, salt)}`;
}

export type CsrfFailure = 'missing' | 'malformed' | 'expired' | 'mismatch';

export function verifyCsrf(
  key: Buffer,
  token: string | null | undefined,
  userId: string,
  projectId: string,
  now = Date.now(),
): { ok: true } | { ok: false; reason: CsrfFailure } {
  if (!token) return { ok: false, reason: 'missing' };

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [issued, salt, mac] = parts as [string, string, string];

  const at = Number.parseInt(issued, 36);
  if (!Number.isFinite(at)) return { ok: false, reason: 'malformed' };
  // A token from the future is as wrong as an expired one, and allowing it
  // would let a clock skew widen the window indefinitely.
  if (at > now + 60_000 || now - at > TOKEN_TTL_MS) return { ok: false, reason: 'expired' };

  const expected = sign(key, userId, projectId, issued, salt);
  // Compared byte by byte in constant time. A length check first, because
  // timingSafeEqual throws on differing lengths rather than returning false.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}

function sign(key: Buffer, userId: string, projectId: string, issued: string, salt: string): string {
  // The separator cannot appear in a user id or a project id, so two different
  // triples cannot produce the same signed string.
  return createHmac('sha256', key).update(`${userId}\u0000${projectId}\u0000${issued}\u0000${salt}`).digest('base64url');
}

/** The hidden field every state-changing form carries. */
export function csrfField(token: string): string {
  return `<input type="hidden" name="${CSRF_FIELD}" value="${token}">`;
}

/**
 * Whether a state-changing request came from Power's own pages.
 *
 * `Origin` is present on every browser POST. `Sec-Fetch-Site` is checked too
 * where the browser sends it, because it answers the question directly and is
 * not something a page can set. A request with neither is refused: every
 * browser Power supports sends at least one, so the only callers without them
 * are not browsers, and these endpoints exist for browsers.
 */
export function sameOrigin(
  headers: { origin?: string | string[]; referer?: string | string[]; 'sec-fetch-site'?: string | string[] },
  expectedOrigin: string,
): { ok: true } | { ok: false; reason: string } {
  const site = first(headers['sec-fetch-site']);
  if (site && site !== 'same-origin') {
    return { ok: false, reason: `this request came from ${site === 'none' ? 'no page' : 'another site'}` };
  }

  const origin = first(headers.origin);
  if (origin) {
    return origin === expectedOrigin
      ? { ok: true }
      : { ok: false, reason: `this request came from ${origin}, not from Power` };
  }

  // Some browsers omit Origin on a same-origin form POST. Referer carries the
  // same information, less reliably, so it is a fallback rather than the rule.
  const referer = first(headers.referer);
  if (referer) {
    try {
      return new URL(referer).origin === expectedOrigin
        ? { ok: true }
        : { ok: false, reason: `this request came from ${new URL(referer).origin}, not from Power` };
    } catch {
      return { ok: false, reason: 'this request had an unreadable Referer' };
    }
  }

  if (site === 'same-origin') return { ok: true };
  return { ok: false, reason: 'this request did not say where it came from' };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
