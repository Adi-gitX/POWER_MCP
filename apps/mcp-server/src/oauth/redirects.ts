/**
 * Which redirect URIs Power will register, and how they are stored.
 *
 * Claude's hosted apps always come back to one fixed URL. Claude Code is a
 * native client and comes back to a loopback address on a port that changes
 * every session, so the port has to be ignored.
 *
 * The SDK's matcher relaxes the port for loopback hosts but requires the
 * hostname to match exactly — its own comment notes that RFC 8252 does not
 * allow `localhost` and `127.0.0.1` to cross-match. Registering one of them is
 * therefore not enough, so `expandRedirectUris` stores both. The port in the
 * stored form is arbitrary and never compared.
 */

export const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const LOOPBACK_PATH = '/callback';

/** Stored loopback forms. The port is a placeholder; only the host and path matter. */
export const LOOPBACK_FORMS = [
  `http://localhost:1${LOOPBACK_PATH}`,
  `http://127.0.0.1:1${LOOPBACK_PATH}`,
] as const;

/** Extra exact URIs an operator can allow, comma separated. */
export function extraRedirectUris(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.POWER_EXTRA_REDIRECT_URIS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Whether a client may register this URI at all. Anything that is not Claude's
 * callback or a plain loopback `/callback` is refused, because a registration
 * endpoint that accepts arbitrary redirect targets is an open redirector that
 * hands out authorization codes.
 */
export function isAllowedRedirectUri(raw: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (raw === CLAUDE_CALLBACK) return true;
  if (extraRedirectUris(env).includes(raw)) return true;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === 'http:' &&
    LOOPBACK_HOSTS.has(url.hostname) &&
    url.pathname === LOOPBACK_PATH &&
    url.search === '' &&
    url.hash === ''
  );
}

/**
 * Canonicalise a registration request for storage.
 *
 * Claude's callback and both loopback forms are always included, whatever the
 * client asked for, so that one registration works from claude.ai, from Claude
 * Code, and from the MCP Inspector on a random port.
 */
export function expandRedirectUris(requested: readonly string[], env: NodeJS.ProcessEnv = process.env): string[] {
  const out = new Set<string>([CLAUDE_CALLBACK, ...LOOPBACK_FORMS, ...extraRedirectUris(env)]);
  for (const uri of requested) {
    if (!isAllowedRedirectUri(uri, env)) continue;
    // A loopback URI is already covered by both stored forms; adding the
    // client's own port would only duplicate it.
    try {
      if (LOOPBACK_HOSTS.has(new URL(uri).hostname)) continue;
    } catch {
      continue;
    }
    out.add(uri);
  }
  return [...out];
}

/** The URIs a client registration is rejected for, so the error can name them. */
export function rejectedRedirectUris(requested: readonly string[], env: NodeJS.ProcessEnv = process.env): string[] {
  return requested.filter((uri) => !isAllowedRedirectUri(uri, env));
}
