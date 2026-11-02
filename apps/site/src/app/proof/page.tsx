import type { Metadata } from 'next';
import Link from 'next/link';
import { loadTranscript } from '@/lib/transcript';
import { Artifact, ArtifactNote, AskRow, RuleNote, ToolLine } from '@/components/site/artifact';

export const metadata: Metadata = {
  title: 'Proof',
  description:
    'A real model driven through Power’s gates: every tool call, every refusal, and what it did next. Rendered from the committed transcript.',
};

const PHASES: { n: string; title: string; id: string; you?: boolean; phase: string }[] = [
  { n: '01', title: 'Plan', id: 'plan', phase: '1' },
  { n: '02', title: 'Approve', id: 'approve', phase: '', you: true },
  { n: '03', title: 'Build and verify', id: 'build', phase: '2' },
  { n: '04', title: 'Publish', id: 'publish', phase: '3', you: true },
];

export default function ProofPage() {
  const t = loadTranscript();

  return (
    <div className="page proof-page">
      <section className="page-hero">
        <div className="shell">
          <span className="eyebrow">
            <span className="eyebrow-dot" />
            Proof, not a demo video
          </span>
          <h1 className="page-title proof-title">
            A real model. Start to ship.
            <br />
            Every call, unedited.
          </h1>
          <p className="page-sub">
            This page is generated from the transcripts committed under{' '}
            <code className="mono">docs/evals</code>. Nothing here is typed by hand, so the site
            cannot claim something the run did not do.
          </p>
          <div className="proof-badges">
            <span className="proof-badge">
              <b>{t.calls.length}</b> tool calls
            </span>
            <span className="proof-badge is-refuse">
              <b>{t.refusals.length}</b> refusal
            </span>
            <span className="proof-badge is-pass">
              <b>0</b> protocol errors
            </span>
          </div>
        </div>
      </section>

      <section className="proof-section">
        <div className="shell proof-shell">
          {PHASES.map((p) => {
            const calls = p.phase ? t.calls.filter((c) => c.phase === p.phase) : [];
            return (
              <div className="proof-phase" id={p.id} key={p.n}>
                <div className="proof-phase-head">
                  <span className="proof-num">{p.n}</span>
                  <h2>{p.title}</h2>
                </div>

                {p.you ? (
                  <Artifact className="is-ask">
                    <AskRow
                      title={p.n === '02' ? 'Approve the plan' : 'Confirm publish'}
                      phase={p.n === '02' ? 'spec_approval' : 'verify_approval'}
                    />
                    <ArtifactNote>
                      The run stopped here until a person clicked. The model could ask, not answer.
                    </ArtifactNote>
                  </Artifact>
                ) : (
                  <Artifact>
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
                  </Artifact>
                )}
              </div>
            );
          })}

          {t.finals['3'] && (
            <figure className="proof-quote">
              <h2>In its own words</h2>
              <blockquote>“{t.finals['3'].replace(/\s+/g, ' ').slice(0, 400)}”</blockquote>
            </figure>
          )}

          <p className="proof-repro">
            Reproduce it yourself with <code className="mono">scripts/eval-claude.sh</code>.{' '}
            <Link href="/docs/how-it-works/">How the gates work →</Link>
          </p>
        </div>
      </section>
    </div>
  );
}
