/**
 * The domain, in one place.
 *
 * It used to be written out in four of the values below, so changing it meant
 * finding every copy, and the ones in the email address and the MCP URL were
 * the easiest to miss. SITE_URL still overrides the whole origin for a preview
 * deploy; POWER_DOMAIN changes the name everywhere at once.
 */
const DOMAIN = process.env.POWER_DOMAIN ?? 'usepower.dev';

export const SITE = {
  name: 'Power',
  tagline: 'Ship it checked.',
  url: process.env.SITE_URL ?? `https://${DOMAIN}`,
  github: 'https://github.com/Adi-gitX/power',
  email: `hello@${DOMAIN}`,
  // The URL a person types into Claude. It has to match the server's own
  // `resource` byte for byte, including the absence of a trailing slash.
  mcp: `https://mcp.${DOMAIN}/mcp`,
} as const;

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
