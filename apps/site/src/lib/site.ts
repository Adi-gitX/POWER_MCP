export const SITE = {
  name: 'Power',
  tagline: 'Ship it checked.',
  url: process.env.SITE_URL ?? 'https://power.build',
  github: 'https://github.com/Adi-gitX/power',
  email: 'hello@power.build',
  mcp: 'https://mcp.power.build/mcp',
} as const;

export const NAV = [
  { href: '/proof/', label: 'Proof' },
  { href: '/docs/', label: 'Docs' },
  { href: '/pricing/', label: 'Pricing' },
] as const;
