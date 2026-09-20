'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DOCS, DOC_SECTIONS } from '@/lib/docs';
import { cn } from '@/lib/utils';

const hrefFor = (slug: string) => (slug === 'index' ? '/docs/' : `/docs/${slug}/`);

export function DocsNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Documentation" className="lg:sticky lg:top-24 lg:self-start">
      {DOC_SECTIONS.map((section) => (
        <div key={section} className="mb-6">
          <h4 className="mono mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-3">
            {section}
          </h4>
          <ul className="space-y-0.5">
            {DOCS.filter((d) => d.section === section).map((d) => {
              const href = hrefFor(d.slug);
              const active = pathname === href;
              return (
                <li key={d.slug}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'block border-l-2 py-1.5 pl-3 text-[0.92rem] transition-colors',
                      active
                        ? 'border-blue font-medium text-blue'
                        : 'border-transparent text-ink-2 hover:border-line-2 hover:text-ink',
                    )}
                  >
                    {d.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
