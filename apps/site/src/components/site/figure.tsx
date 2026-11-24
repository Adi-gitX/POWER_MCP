import { Reveal } from '@/components/motion/reveal';
import { cn } from '@/lib/utils';

/**
 * One claim, one artifact, numbered.
 *
 * The number is doing real work rather than decoration: a labelled figure
 * reads as evidence, and a paragraph next to a screenshot reads as marketing.
 * Everything Power claims is something its own output can be shown doing, so
 * the page is built out of exhibits.
 *
 * The rule the layout enforces: exactly one artifact per claim. A section with
 * two visuals dilutes both, and a section with none is a section nobody
 * believes.
 */
export function Figure({
  n,
  eyebrow,
  title,
  children,
  artifact,
  flip = false,
}: {
  /** "1.1". Sequential down the page, so a reader can refer to one. */
  n: string;
  eyebrow: string;
  title: React.ReactNode;
  children: React.ReactNode;
  artifact: React.ReactNode;
  /** Put the artifact on the left. Alternating stops the page marching. */
  flip?: boolean;
}) {
  return (
    <section className="section-figure border-t border-line">
      <div className="wrap">
        <div className="grid items-center gap-10 md:grid-cols-2 md:gap-14">
          <Reveal className={cn('min-w-0', flip && 'md:order-2')}>
            <div className="flex items-center gap-3">
              <span className="mono text-[0.72rem] font-medium tracking-[0.08em] text-ink-3">Fig {n}</span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <span className="eyebrow mt-5">{eyebrow}</span>
            <h2 className="serif mt-4 text-h2">{title}</h2>
            <div className="mt-4 space-y-3 text-[1.08rem] leading-relaxed text-ink-2">{children}</div>
          </Reveal>

          <Reveal delay={0.08} className={cn('min-w-0', flip && 'md:order-1')}>
            {artifact}
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/** A quiet section between heavy figures, so the page can breathe. */
export function Rest({ children }: { children: React.ReactNode }) {
  return (
    <section className="section border-t border-line">
      <div className="wrap">
        <Reveal>
          <p className="serif mx-auto max-w-[24ch] text-center text-serif-lg text-ink">{children}</p>
        </Reveal>
      </div>
    </section>
  );
}
