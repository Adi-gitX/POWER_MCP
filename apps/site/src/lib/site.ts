/**
 * The domain, in one place.
 *
 * It used to be written out in four of the values below, so changing it meant
 * finding every copy, and the ones in the email address and the MCP URL were
 * the easiest to miss. SITE_URL still overrides the whole origin for a preview
 * deploy; POWER_DOMAIN changes the name everywhere at once.
 */
const DOMAIN = process.env.POWER_DOMAIN ?? 'usepower.dev';

/**
 * Where the app lives.
 *
 * The marketing site and the dashboard are separate origins, so every primary
 * call to action has to be an absolute link to the server. `NEXT_PUBLIC_`
 * because the landing is static HTML hydrated in the browser.
 *
 * The default is the server's own development port in every build mode. It
 * used to switch to `https://app.${DOMAIN}` whenever NODE_ENV was production,
 * so a local `pnpm build:site` sent "Start building" to the deployed app
 * instead of the one running beside it. A public deploy names its app
 * explicitly (deploy-site.yml and vercel.json both do).
 */
const EXPLICIT_APP_URL = process.env.NEXT_PUBLIC_POWER_APP_URL ?? process.env.POWER_APP_URL;
const APP_URL = (EXPLICIT_APP_URL ?? 'http://localhost:4321').replace(/\/+$/, '');

/**
 * The MCP endpoint people paste into their client. Locally it is the same
 * server as the app (`pnpm dev` serves both on one port); a public deploy
 * keeps its dedicated `mcp.` host unless NEXT_PUBLIC_POWER_MCP_URL says
 * otherwise.
 */
const MCP_URL =
  process.env.NEXT_PUBLIC_POWER_MCP_URL ??
  process.env.POWER_MCP_URL ??
  (EXPLICIT_APP_URL ? `https://mcp.${DOMAIN}/mcp` : `${APP_URL}/mcp`);

export const SITE = {
  name: 'Power',
  tagline: 'Ship it checked.',
  url: process.env.SITE_URL ?? `https://${DOMAIN}`,
  github: 'https://github.com/Adi-gitX/power',
  email: `hello@${DOMAIN}`,
  // The URL a person types into Claude. It has to match the server's own
  // `resource` byte for byte, including the absence of a trailing slash.
  mcp: MCP_URL,
  app: APP_URL,
} as const;

export const signIn = `${SITE.app}/login`;

export const signUp = `${SITE.app}/login?next=/`;

/**
 * Required by Anthropic's connector directory, and until now written and
 * unreachable: both pages existed with nothing linking to them.
 */
export const LEGAL = [
  { href: '/privacy/', label: 'Privacy' },
  { href: '/terms/', label: 'Terms' },
] as const;

export const NAV = [
  { href: '/proof/', label: 'Proof' },
  { href: '/docs/', label: 'Docs' },
  { href: '/pricing/', label: 'Pricing' },
] as const;
