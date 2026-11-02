'use client';

import { usePathname } from 'next/navigation';
import { SITE, signIn } from '@/lib/site';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { href: '/', label: 'Homepage' },
      { href: '/pricing/', label: 'Pricing' },
      { href: '/proof/', label: 'Proof' },
      { href: '/updates/', label: 'Updates' },
    ],
  },
  {
    title: 'Explore',
    links: [
      { href: '/docs/getting-started/', label: 'Get started' },
      { href: '/docs/', label: 'Docs' },
      { href: '/blog/', label: 'Blog' },
      { href: `${SITE.app}/`, label: 'Workspace' },
      { href: signIn, label: 'Sign in' },
      { href: SITE.github, label: 'GitHub' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/terms/', label: 'Terms of use' },
      { href: '/privacy/', label: 'Privacy policy' },
      { href: '/privacy/#cookies', label: 'Cookie policy' },
    ],
  },
] as const;

export function SiteFooter() {
  const pathname = usePathname();
  if (pathname.startsWith('/app')) return null;

  return (
    <footer className="site-footer">
      <div className="shell footer-inner">
        <div className="footer-brand">
          <a className="brand" href="/" aria-label="Power home">
            <img
              className="brand-mark"
              src="/assets/img/power-mark.svg"
              alt=""
              width={27}
              height={28}
            />
            <span>Power</span>
          </a>
          <p className="footer-note">One connection for your tools, skills and context.</p>
        </div>

        <div className="footer-cols">
          {COLUMNS.map((column) => (
            <div className="footer-col" key={column.title}>
              <h4>{column.title}</h4>
              {column.links.map((link) => (
                <a key={link.href} href={link.href}>
                  {link.label}
                </a>
              ))}
            </div>
          ))}
        </div>

        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} Power. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
