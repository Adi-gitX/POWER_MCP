import Link from 'next/link';
import { Reveal } from '@/components/motion/reveal';
import { Artifact, RuleNote, ToolLine } from './artifact';
import { loadTranscript } from '@/lib/transcript';

export function ProofStrip() {
  const t = loadTranscript();
  const i = t.calls.findIndex((c) => c.ok === false);
  const refused = t.calls[i];
  const fixed = t.calls[i + 1];

  return (
    <section className="section bg-paper-2">
      <div className="wrap grid gap-10 lg:grid-cols-12">
        <Reveal className="lg:col-span-4">
          <span className="eyebrow">Proof</span>
          <h2 className="serif mt-5 text-h2">A real model did this.</h2>
          <p className="mt-4 text-ink-2">
            {t.calls.length} calls, {t.refusals.length} refusal, 0 protocol errors. Read from the
            committed transcript at build time, not typed by hand.
          </p>
          <Link href="/proof/" className="mt-5 inline-block text-blue hover:underline">
            Every call, unedited →
          </Link>
        </Reveal>

        <Reveal delay={0.08} className="lg:col-span-8">
          <Artifact className="h-auto bg-white">
            <div className="flex-1 space-y-2">
              {refused && <ToolLine state="no" tool={refused.tool} status={`refused · ${refused.reason ?? 'gate_not_satisfied'}`} />}
              {refused?.reason && <RuleNote tone="no" id={refused.reason}>The gate named the rule and the next action.</RuleNote>}
              {fixed?.says && (
                <p className="serif px-0.5 py-2 text-[1.05rem] leading-snug text-ink-2">
                  “{fixed.says.replace(/\s+/g, ' ').slice(0, 150)}”
                </p>
              )}
              {fixed && <ToolLine state="ok" tool={fixed.tool} status="ok · phase: spec_approval" />}
            </div>
          </Artifact>
        </Reveal>
      </div>
    </section>
  );
}
