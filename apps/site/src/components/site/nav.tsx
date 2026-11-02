'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/#product', label: 'Product' },
  { href: '/proof/', label: 'Proof' },
  { href: '/pricing/', label: 'Pricing' },
  { href: '/docs/', label: 'Docs' },
] as const;

export function SiteNav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('menu-open', open);
    return () => document.body.classList.remove('menu-open');
  }, [open]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (pathname.startsWith('/app')) return null;

  const isActive = (href: string) => {
    if (href === '/#product') return pathname === '/';
    const base = href.replace(/\/$/, '');
    return pathname === href || pathname.startsWith(`${base}/`);
  };

  return (
    <>
      <header className={`site-header${scrolled ? ' is-scrolled' : ''}`} id="siteHeader">
        <div className="header-inner">
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

          <nav className="primary-nav" aria-label="Primary">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} aria-current={isActive(item.href) ? 'page' : undefined}>
                {item.label}
              </a>
            ))}
          </nav>

          <div className="header-right">
            <a className="btn btn-glass btn-sm" href="/docs/getting-started/">
              Get started
            </a>
            <button
              className="menu-toggle"
              type="button"
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              aria-controls="mobileMenu"
              onClick={() => setOpen((value) => !value)}
            >
              <svg className="icon">
                <use href={open ? '#i-close' : '#i-menu'} />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div className={`mobile-menu${open ? ' is-open' : ''}`} id="mobileMenu" aria-hidden={!open}>
        <nav aria-label="Mobile">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} onClick={() => setOpen(false)}>
              {item.label}
            </a>
          ))}
          <a href="/docs/getting-started/" onClick={() => setOpen(false)}>
            Get started
          </a>
        </nav>
      </div>
    </>
  );
}
