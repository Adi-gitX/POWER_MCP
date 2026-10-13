/**
 * OAuth discovery documents, written by hand rather than taken from the SDK's
 * router.
 *
 * Two reasons. The SDK serves protected-resource metadata only at the
 * path-suffixed URL (`/.well-known/oauth-protected-resource/mcp`), while the
 * `WWW-Authenticate` challenge we send points at the unsuffixed one, so using
 * it as-is would advertise a 404. And `resource` has to equal the MCP URL the
 * person types, byte for byte, including the path — a mismatch there is the
 * single most common reason a connector fails with nothing in the logs but a
 * client that never arrives.
 */

export interface OAuthConfig {
  /** Origin of the authorization server, e.g. https://mcp.example.com */
  issuer: string;
  /** The MCP endpoint, exactly as a user types it into Claude. */
  resource: string;
  accessTokenTtlSec: number;
  refreshTokenTtlSec: number;
  codeTtlSec: number;
  sessionTtlSec: number;
  loginChallengeTtlSec: number;
}

/** The one scope Power issues. Narrow on purpose: it is all or nothing today. */
export const POWER_SCOPE = 'power.build';

export function authorizationServerMetadata(c: OAuthConfig): Record<string, unknown> {
  return {
    issuer: c.issuer,
    authorization_endpoint: `${c.issuer}/oauth/authorize`,
    token_endpoint: `${c.issuer}/oauth/token`,
    registration_endpoint: `${c.issuer}/oauth/register`,
    revocation_endpoint: `${c.issuer}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    // Required by the MCP authorization spec so a client can check for S256
    // support before it starts a flow it cannot finish.
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    scopes_supported: [POWER_SCOPE],
    service_documentation: `${c.issuer}/docs`,
  };
}

export function protectedResourceMetadata(c: OAuthConfig): Record<string, unknown> {
  return {
    resource: c.resource,
    // Only the first entry is read by Claude, and there is no fallback to
    // later ones, so there is no point listing more than the real issuer.
    authorization_servers: [c.issuer],
    scopes_supported: [POWER_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Power',
    resource_documentation: `${c.issuer}/docs`,
  };
}

/** Where the 401 challenge points. Absolute, and it has to return 200. */
export function resourceMetadataUrl(c: OAuthConfig): string {
  return `${c.issuer}/.well-known/oauth-protected-resource`;
}

export class OAuthConfigError extends Error {}

/**
 * Read and check the configuration at boot. Every failure here is one that
 * would otherwise show up as "Claude can't reach the MCP server" with nothing
 * useful on either side, so they are all fatal rather than warnings.
 */
export function configFromEnv(env: NodeJS.ProcessEnv): OAuthConfig {
  const issuer = stripTrailingSlash(env.POWER_ISSUER_URL ?? env.POWER_BASE_URL ?? '');
  const resource = env.POWER_MCP_URL ?? (issuer ? `${issuer}/mcp` : '');

  if (!issuer) throw new OAuthConfigError('POWER_ISSUER_URL (or POWER_BASE_URL) must be set');

  const issuerUrl = parse(issuer, 'POWER_ISSUER_URL');
  const resourceUrl = parse(resource, 'POWER_MCP_URL');

  if (resourceUrl.hash) throw new OAuthConfigError('POWER_MCP_URL must not contain a fragment');
  if (resource.endsWith('/')) throw new OAuthConfigError('POWER_MCP_URL must not end in a slash');
  if (resourceUrl.origin !== issuerUrl.origin) {
    throw new OAuthConfigError(
      `POWER_MCP_URL (${resourceUrl.origin}) and POWER_ISSUER_URL (${issuerUrl.origin}) must share an origin`,
    );
  }
  if (issuerUrl.protocol !== 'https:' && !isLoopback(issuerUrl.hostname)) {
    throw new OAuthConfigError(`POWER_ISSUER_URL must be https unless it is loopback (got ${issuer})`);
  }

  return {
    issuer,
    resource,
    accessTokenTtlSec: int(env.POWER_ACCESS_TOKEN_TTL, 60 * 60),
    refreshTokenTtlSec: int(env.POWER_REFRESH_TOKEN_TTL, 60 * 60 * 24 * 30),
    codeTtlSec: int(env.POWER_CODE_TTL, 60),
    sessionTtlSec: int(env.POWER_SESSION_TTL, 60 * 60 * 24 * 30),
    loginChallengeTtlSec: int(env.POWER_LOGIN_TTL, 60 * 15),
  };
}

export function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function parse(value: string, name: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new OAuthConfigError(`${name} is not a valid absolute URL: ${value || '(empty)'}`);
  }
}

function int(value: string | undefined, fallback: number): number {
  const n = value ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
