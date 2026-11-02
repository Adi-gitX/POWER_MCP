'use client';

import { usePathname } from 'next/navigation';
import { SITE, signUp } from '@/lib/site';

/**
 * The last screen before the footer. The home page has its own full-height
 * final CTA, so this compact version carries the same landscape and the same
 * way in on every other route instead of dropping straight from content to
 * legal links.
 */
export function SiteClosing() {
  const pathname = usePathname();
  if (pathname === '/' || pathname.startsWith('/app')) return null;

  return (
    <section className="closing" aria-labelledby="closing-title">
      <div className="closing-art" aria-hidden="true">
        <img src="/assets/img/dunes.webp" alt="" loading="lazy" />
      </div>
      <div className="shell closing-inner">
        <span className="eyebrow reveal">
          <span className="eyebrow-dot" />
          Start here
        </span>
        <h2 className="closing-title reveal" id="closing-title">
          Start shipping with Power.
        </h2>
        <p className="closing-sub reveal">
          Connect one MCP endpoint, point your agent at a project, and let it build — checked at
          every gate.
        </p>
        <div className="closing-actions reveal">
          <a className="btn btn-light btn-md" href={signUp}>
            Start building
          </a>
          <a className="btn btn-dark btn-md" href={`${SITE.app}/`}>
            Open workspace
          </a>
        </div>
      </div>
    </section>
  );
}
