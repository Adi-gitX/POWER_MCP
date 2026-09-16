'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * One entrance, used everywhere, so the whole page moves the same way.
 *
 * The content is visible in the served HTML. The hidden state is applied only
 * once the `js` class is on <html> (set by a blocking script in the head), so
 * a visitor without JavaScript, or one whose bundle fails, still reads the
 * page. Reduced motion skips the animation in CSS, with no hydration involved.
 */
export function Reveal({
  children, delay = 0, y = 18, className,
}: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (!('IntersectionObserver' in window)) { el.classList.add('is-in'); return; }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) { el.classList.add('is-in'); io.disconnect(); }
      },
      { rootMargin: '0px 0px -12% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn('reveal', className)}
      style={{ '--reveal-y': `${y}px`, '--reveal-delay': `${delay}s` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
