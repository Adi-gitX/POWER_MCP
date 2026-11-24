import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { RunConsole } from './run-console';
import { CopyLine } from './copy-line';
import { Reveal } from '@/components/motion/reveal';
import { Button } from '@/components/ui/button';
import { SITE } from '@/lib/site';

/**
 * The void: one radial gradient that starts near-black at the top of the page and
 * lands on the page color by the time the run console clears it, so the section needs no
 * hard edge against what follows.
 *
 * The copy is left-aligned rather than centred, and the install command sits
 * beside the first button. For a product whose entire setup is one line in a
 * terminal, that line is the first thing a developer is looking for, and the
 * person who copies it has already started.
 */
export function Hero() {
  return (
    <section className="hero-sky relative -mt-[4.25rem] overflow-hidden pb-16 pt-[7.5rem] md:pt-[8.5rem]">
      <div aria-hidden className="hero-grid" />
      <div aria-hidden className="aurora aurora-a" />
      <div aria-hidden className="aurora aurora-b" />
      <div className="wrap">
        <div className="max-w-[46rem]">
          <Reveal y={10}>
            <span className="eyebrow eyebrow-sky">
              <span className="live-dot" aria-hidden />
              MCP server · works with the Claude subscription you already pay for
            </span>
          </Reveal>
          <Reveal delay={0.06}>
            <h1 className="serif mt-6 max-w-[15ch] text-display font-medium tracking-tight text-bright">
              Ship it <em>checked.</em>
            </h1>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="mt-6 max-w-[52ch] text-[1.18rem] leading-relaxed text-bright/85">
              Your AI writes the plan and the code. Deterministic gates check both before you
              see them, two decisions stay yours, and what you get is a git repository you own.
            </p>
          </Reveal>
          <Reveal delay={0.18}>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="md" variant="primary" className="rounded-xl">
                <Link href="/docs/getting-started/">
                  Get started <ArrowRight />
                </Link>
              </Button>
              <CopyLine
                tone="sky"
                className="w-full sm:max-w-[30rem]"
                command={`claude mcp add --transport http power ${SITE.mcp}`}
              />
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.24} className="mt-12">
          <RunConsole />
        </Reveal>
      </div>
    </section>
  );
}
