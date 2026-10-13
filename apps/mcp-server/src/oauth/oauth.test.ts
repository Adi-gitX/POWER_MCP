import { redirectUriMatches } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { describe, expect, it } from 'vitest';
import {
  authorizationServerMetadata,
  configFromEnv,
  OAuthConfigError,
  protectedResourceMetadata,
  resourceMetadataUrl,
  type OAuthConfig,
} from './metadata.js';
import { CLAUDE_CALLBACK, expandRedirectUris, isAllowedRedirectUri, rejectedRedirectUris } from './redirects.js';

const env = (over: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  POWER_ISSUER_URL: 'https://mcp.example.com',
  POWER_MCP_URL: 'https://mcp.example.com/mcp',
  ...over,
});

describe('oauth discovery metadata', () => {
  const config: OAuthConfig = configFromEnv(env());

  it('advertises S256, which a spec-compliant client checks before starting', () => {
    expect(authorizationServerMetadata(config).code_challenge_methods_supported).toEqual(['S256']);
  });

  it('names every endpoint under the issuer', () => {
    const m = authorizationServerMetadata(config);
    expect(m.issuer).toBe('https://mcp.example.com');
    expect(m.authorization_endpoint).toBe('https://mcp.example.com/oauth/authorize');
    expect(m.token_endpoint).toBe('https://mcp.example.com/oauth/token');
    expect(m.registration_endpoint).toBe('https://mcp.example.com/oauth/register');
    expect(m.revocation_endpoint).toBe('https://mcp.example.com/oauth/revoke');
  });

  it('resource equals the MCP URL byte for byte, path included', () => {
    // The most common silent failure: a resource that differs from the URL the
    // person typed, by a trailing slash or a missing path.
    expect(protectedResourceMetadata(config).resource).toBe('https://mcp.example.com/mcp');
  });

  it('lists exactly one authorization server, because only the first is read', () => {
    expect(protectedResourceMetadata(config).authorization_servers).toEqual(['https://mcp.example.com']);
  });

  it('points the challenge at an absolute unsuffixed document', () => {
    expect(resourceMetadataUrl(config)).toBe('https://mcp.example.com/.well-known/oauth-protected-resource');
  });

  it('defaults the resource to the issuer plus /mcp', () => {
    const c = configFromEnv({ POWER_ISSUER_URL: 'https://mcp.example.com' });
    expect(c.resource).toBe('https://mcp.example.com/mcp');
  });

  it('tolerates a trailing slash on the issuer', () => {
    expect(configFromEnv({ POWER_ISSUER_URL: 'https://mcp.example.com/' }).issuer).toBe('https://mcp.example.com');
  });

  it('refuses configuration that would fail silently at runtime', () => {
    expect(() => configFromEnv({})).toThrow(OAuthConfigError);
    expect(() => configFromEnv(env({ POWER_MCP_URL: 'https://mcp.example.com/mcp/' }))).toThrow(/slash/);
    expect(() => configFromEnv(env({ POWER_MCP_URL: 'https://elsewhere.example.com/mcp' }))).toThrow(/origin/);
    expect(() => configFromEnv(env({ POWER_ISSUER_URL: 'http://mcp.example.com', POWER_MCP_URL: 'http://mcp.example.com/mcp' }))).toThrow(/https/);
  });

  it('allows plain http on loopback, so local development works', () => {
    const c = configFromEnv({ POWER_ISSUER_URL: 'http://localhost:4321' });
    expect(c.resource).toBe('http://localhost:4321/mcp');
  });

  it('gives access tokens a real lifetime', () => {
    // A long-lived access token makes rotation and revocation decorative.
    expect(config.accessTokenTtlSec).toBeLessThanOrEqual(60 * 60);
    expect(config.accessTokenTtlSec).toBeGreaterThan(0);
  });
});

describe('redirect uris', () => {
  it('accepts Claude’s callback and plain loopback only', () => {
    expect(isAllowedRedirectUri(CLAUDE_CALLBACK, {})).toBe(true);
    expect(isAllowedRedirectUri('http://localhost:8080/callback', {})).toBe(true);
    expect(isAllowedRedirectUri('http://127.0.0.1:65535/callback', {})).toBe(true);

    expect(isAllowedRedirectUri('https://evil.example.com/callback', {})).toBe(false);
    expect(isAllowedRedirectUri('http://localhost:8080/callback?next=x', {})).toBe(false);
    expect(isAllowedRedirectUri('http://localhost:8080/other', {})).toBe(false);
    expect(isAllowedRedirectUri('https://localhost:8080/callback', {})).toBe(false);
    expect(isAllowedRedirectUri('not a url', {})).toBe(false);
  });

  it('names what it rejected, so the error can say which', () => {
    expect(rejectedRedirectUris([CLAUDE_CALLBACK, 'https://evil.example.com/cb'], {})).toEqual([
      'https://evil.example.com/cb',
    ]);
  });

  /**
   * This is the whole requirement, asserted against the SDK's own matcher
   * rather than against our reading of it. The matcher relaxes the port for
   * loopback hosts but compares hostnames exactly, so storing only one of
   * localhost / 127.0.0.1 silently breaks whichever client uses the other.
   */
  it('a single registration matches every client Claude will use', () => {
    const stored = expandRedirectUris([], {});
    const matches = (requested: string) => stored.some((reg) => redirectUriMatches(requested, reg));

    expect(matches(CLAUDE_CALLBACK)).toBe(true);
    expect(matches('http://localhost:54321/callback')).toBe(true);
    expect(matches('http://127.0.0.1:9999/callback')).toBe(true);
    expect(matches('http://localhost:1/callback')).toBe(true);

    expect(matches('https://evil.example.com/api/mcp/auth_callback')).toBe(false);
    expect(matches('http://localhost:54321/evil')).toBe(false);
  });

  it('stores both loopback hostnames, since the matcher will not cross them', () => {
    const stored = expandRedirectUris([], {});
    expect(stored.some((u) => u.startsWith('http://localhost:'))).toBe(true);
    expect(stored.some((u) => u.startsWith('http://127.0.0.1:'))).toBe(true);
    // Guard the assumption this all rests on.
    expect(redirectUriMatches('http://localhost:5/callback', 'http://127.0.0.1:1/callback')).toBe(false);
  });

  it('drops a client’s own loopback port rather than duplicating it', () => {
    const stored = expandRedirectUris(['http://localhost:7777/callback'], {});
    expect(stored.filter((u) => u.includes('localhost'))).toHaveLength(1);
  });

  it('never stores a redirect it would refuse', () => {
    const stored = expandRedirectUris(['https://evil.example.com/cb'], {});
    expect(stored).not.toContain('https://evil.example.com/cb');
  });

  it('honours an operator allowlist', () => {
    const e = { POWER_EXTRA_REDIRECT_URIS: 'https://inspector.example.com/cb' };
    expect(isAllowedRedirectUri('https://inspector.example.com/cb', e)).toBe(true);
    expect(expandRedirectUris([], e)).toContain('https://inspector.example.com/cb');
  });
});
