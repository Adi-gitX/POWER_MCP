import { RunConsole } from './run-console';
import { Reveal } from '@/components/motion/reveal';

/**
 * The sky: one radial gradient that starts deep blue at the top of the page and
 * lands on white by the time the run console clears it, so the section needs no
 * hard edge against what follows.
 */
export function Hero() {
  return (
    <section className="hero-sky relative -mt-[4.25rem] overflow-hidden pb-16 pt-[7.5rem] md:pt-[8.5rem]">
      <div className="wrap text-center">
        <Reveal y={10}>
          <span className="eyebrow eyebrow-sky">An MCP server for building real apps</span>
        </Reveal>
        <Reveal delay={0.06}>
          <h1 className="serif mx-auto mt-6 max-w-[16ch] text-display font-medium tracking-tight text-white">
            Ship it <em>checked.</em>
          </h1>
        </Reveal>
        <Reveal delay={0.12}>
          <p className="mx-auto mt-6 max-w-[46ch] text-[1.18rem] leading-relaxed text-white/85">
            Your AI writes the plan and the code. Deterministic gates check both before you
            see them. You make two decisions. You get a receipt.
          </p>
        </Reveal>
        <Reveal delay={0.18} className="mt-10">
          <RunConsole />
        </Reveal>
      </div>
    </section>
  );
}
