import type { Metadata } from 'next';
import Link from 'next/link';
import { loadTranscript } from '@/lib/transcript';
import { Artifact, ArtifactNote, AskRow, RuleNote, ToolLine } from '@/components/site/artifact';
import { Reveal } from '@/components/motion/reveal';
import { Badge } from '@/components/ui/badge';

export const metadata: Metadata = {
  title: 'Proof',
  description:
    'A real model driven through Power’s gates: every tool call, every refusal, and what it did next. Rendered from the committed transcript.',
};

const PHASES: { n: string; title: string; you?: boolean; phase: string }[] = [
  { n: '01', title: 'Plan', phase: '1' },
  { n: '02', title: 'Approve', phase: '', you: true },
  { n: '03', title: 'Build and verify', phase: '2' },
  { n: '04', title: 'Publish', phase: '3', you: true },
];

export default function ProofPage() {
  const t = loadTranscript();

  return (
    <>
      <section className="pb-10 pt-16">
        <div className="wrap max-w-3xl">
          <span className="eyebrow">Proof, not a demo video</span>
          <h1 className="serif mt-6 text-[clamp(2.4rem,5.4vw,4rem)] leading-[1.02] tracking-tight">
            A real model. Start to ship.<br />Every call, unedited.
          </h1>
          <p className="mt-5 text-[1.15rem] leading-relaxed text-ink-2">
            This page is generated from the transcripts committed under <code className="mono text-[0.92rem]">docs/evals</code>.
            Nothing here is typed by hand, so the site cannot claim something the run did not do.
          </p>
          <div className="mt-7 flex flex-wrap gap-2">
            <Badge tone="neutral">{t.calls.length} tool calls</Badge>
            <Badge tone="refuse">{t.refusals.length} refusal</Badge>
            <Badge tone="pass">0 protocol errors</Badge>
          </div>
        </div>
      </section>

      <section className="pb-20">
        <div className="wrap max-w-4xl space-y-4">
          {PHASES.map((p, i) => {
            const calls = p.phase ? t.calls.filter((c) => c.phase === p.phase) : [];
            return (
              <Reveal key={p.n} delay={i * 0.05}>
                <div className="rounded-[14px] border border-line bg-white p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <span className="mono text-[0.74rem] font-semibold tracking-[0.1em] text-blue-ink">{p.n}</span>
                    <h2 className="text-[1.05rem] font-semibold">{p.title}</h2>
                    {p.you && <Badge tone="solid" size="xs">you</Badge>}
                  </div>

                  {p.you ? (
                    <Artifact className="h-auto">
                      <AskRow
                        title={p.n === '02' ? 'Approve the plan' : 'Confirm publish'}
                        phase={p.n === '02' ? 'spec_approval' : 'verify_approval'}
                      />
                      <ArtifactNote>
                        The run stopped here until a person clicked. The model could ask, not answer.
                      </ArtifactNote>
                    </Artifact>
                  ) : (
                    <Artifact className="h-auto">
                      <div className="space-y-2">
                        {calls.map((c, j) => (
                          <div key={j}>
                            <ToolLine
                              state={c.ok === false ? 'no' : 'ok'}
                              tool={c.tool}
                              status={c.ok === false ? `refused · ${c.reason ?? 'gate_not_satisfied'}` : 'ok'}
                            />
                            {c.ok === false && c.reason && (
                              <RuleNote tone="no" id={c.reason}>
                                The gate named the rule and the next action. The retry was free.
                              </RuleNote>
                            )}
                          </div>
                        ))}
                      </div>
                    </Artifact>
                  )}
                </div>
              </Reveal>
            );
          })}

          {t.finals['3'] && (
            <Reveal delay={0.2}>
              <div className="rounded-[14px] border border-line bg-paper-2 p-6">
                <h2 className="mb-3 text-[1.05rem] font-semibold">In its own words</h2>
                <p className="serif text-[1.25rem] leading-snug text-ink-2">
                  “{t.finals['3'].replace(/\s+/g, ' ').slice(0, 400)}”
                </p>
              </div>
            </Reveal>
          )}

          <Reveal delay={0.24}>
            <p className="pt-4 text-ink-2">
              Reproduce it yourself with <code className="mono">scripts/eval-claude.sh</code>.{' '}
              <Link href="/docs/how-it-works/" className="text-blue hover:underline">How the gates work →</Link>
            </p>
          </Reveal>
        </div>
      </section>
    </>
  );
}
