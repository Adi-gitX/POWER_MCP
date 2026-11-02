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
 * because the landing is static HTML hydrated in the browser; the default is
 * the server's own development port.
 */
const APP_URL =
  process.env.NEXT_PUBLIC_POWER_APP_URL ??
  process.env.POWER_APP_URL ??
  (process.env.NODE_ENV === 'production' ? `https://app.${DOMAIN}` : 'http://localhost:4321');

export const SITE = {
  name: 'Power',
  tagline: 'Ship it checked.',
  url: process.env.SITE_URL ?? `https://${DOMAIN}`,
  github: 'https://github.com/Adi-gitX/power',
  email: `hello@${DOMAIN}`,
  // The URL a person types into Claude. It has to match the server's own
  // `resource` byte for byte, including the absence of a trailing slash.
  mcp: `https://mcp.${DOMAIN}/mcp`,
  app: APP_URL.replace(/\/+$/, ''),
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
