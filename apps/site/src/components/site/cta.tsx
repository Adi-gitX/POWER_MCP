import Link from 'next/link';
import { Reveal } from '@/components/motion/reveal';
import { Button } from '@/components/ui/button';
import { SITE } from '@/lib/site';

export function CTA() {
  return (
    <section className="section">
      <div className="wrap">
        <Reveal className="rounded-[20px] border border-line bg-paper-2 px-8 py-14 text-center">
          <h2 className="serif mx-auto max-w-[20ch] text-h2">
            Connect Power to the AI you already pay for.
          </h2>
          <p className="mt-4 text-ink-2">Two minutes. The first project is free.</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg"><Link href="/docs/getting-started/">Connect</Link></Button>
            <Button asChild size="lg" variant="secondary"><a href={SITE.github}>Read the source</a></Button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
