/**
 * Cookie reading, in one place.
 *
 * The OAuth app and the page authenticator both have to find the same session
 * cookie, and they did it with two copies of the same parser. A cookie name
 * that drifts between them is a sign-in that silently does nothing.
 */

export const SESSION_COOKIE = 'power_session';

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    return value === '' ? null : decodeURIComponent(value);
  }
  return null;
}

/** The raw session id from a browser request, or null when there is none. */
export function sessionIdFromHeader(cookieHeader: string | undefined): string | null {
  return readCookie(cookieHeader, SESSION_COOKIE);
}
