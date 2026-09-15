import Link from 'next/link';
import { NAV, SITE } from '@/lib/site';
import { Mark } from './mark';

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-paper-2">
      <div className="wrap flex flex-col gap-6 py-10 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2.5">
          <Mark className="size-5 text-blue" />
          <span className="font-semibold">{SITE.name}</span>
          <span className="text-[0.92rem] text-ink-2">{SITE.tagline}</span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[0.92rem] text-ink-2">
          {NAV.map((i) => (
            <Link key={i.href} href={i.href} className="transition-colors hover:text-ink">{i.label}</Link>
          ))}
          <a href={SITE.github} className="transition-colors hover:text-ink">Source</a>
        </nav>
      </div>
      <div className="wrap border-t border-line py-5 text-[0.82rem] text-ink-3">
        © {new Date().getFullYear()} {SITE.name}. Your code and your data stay exportable, always.
      </div>
    </footer>
  );
}
