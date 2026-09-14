'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { NAV, SITE } from '@/lib/site';
import { Button } from '@/components/ui/button';
import { Mark } from './mark';

export function SiteNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className="sticky top-0 z-40">
      <div className="wrap">
        <nav
          className={cn(
            'mt-3 flex h-14 items-center justify-between rounded-full border px-3 pl-4 backdrop-blur-xl transition-colors duration-300',
            scrolled
              ? 'border-line bg-white/85 shadow-[0_8px_30px_-18px_rgba(25,25,29,0.3)]'
              : 'border-white/55 bg-white/75 shadow-[0_8px_30px_-22px_rgba(16,40,90,0.45)]',
          )}
        >
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Mark className="size-6 text-blue" />
            {SITE.name}
          </Link>

          <div className="flex items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="hidden rounded-full px-3 py-2 text-[0.92rem] text-ink-2 transition-colors hover:text-ink sm:block"
              >
                {item.label}
              </Link>
            ))}
            <a
              href={SITE.github}
              className="hidden rounded-full px-3 py-2 text-[0.92rem] text-ink-2 transition-colors hover:text-ink md:block"
            >
              Source
            </a>
            <Button asChild size="sm" className="ml-1 rounded-full">
              <Link href="/docs/getting-started/">Connect</Link>
            </Button>
          </div>
        </nav>
      </div>
    </header>
  );
}
