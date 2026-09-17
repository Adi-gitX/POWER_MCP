'use client';

import { Reveal } from '@/components/motion/reveal';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Artifact, ArtifactNote, AskRow, RuleNote, ToolLine } from './artifact';

const CARDS = [
  {
    tag: 'The refusal',
    title: 'Gates the AI can’t argue with',
    body: 'Every refusal names the rule and the fix, so the retry converges instead of guessing again. After two, it stops and asks you.',
  },
  {
    tag: 'The tool list',
    title: 'A database the AI can’t break',
    body: 'Every change is rehearsed on a copy of live and has to be reversible before it is promoted.',
  },
  {
    tag: 'The two stops',
    title: 'Two decisions stay yours',
    body: 'Nothing is built before the first and nothing goes live before the second. The chat can ask; it cannot answer.',
  },
];

export function Features() {
  return (
    <section className="section">
      <div className="wrap">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="eyebrow">What it does</span>
          <h2 className="serif mt-5 text-h2">
            Where the model meets a <em className="text-blue">no</em>.
          </h2>
          <p className="mt-4 text-[1.18rem] leading-relaxed text-ink-2">
            Three pieces of code that don’t care how confident the model sounds.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {/* 1 — the refusal, switchable */}
          <Reveal delay={0}>
            <article className="flex h-full flex-col rounded-[14px] border border-line bg-white p-[1.15rem] shadow-[0_1px_2px_rgba(25,25,29,0.04)]">
              <Tag>{CARDS[0].tag}</Tag>
              <Tabs defaultValue="no">
                <Artifact>
                  <TabsContent value="no" className="flex-1">
                    <ToolLine state="no" tool="submit_spec" status="refused" />
                    <RuleNote tone="no" id="ears.missing">R2 has no acceptance criterion.</RuleNote>
                    <ArtifactNote>next_action: submit_spec · retries left: 1 · not billed</ArtifactNote>
                  </TabsContent>
                  <TabsContent value="ok" className="flex-1">
                    <ToolLine state="ok" tool="submit_spec" status="ok" />
                    <RuleNote tone="ok" id="R2">WHEN a slot is taken THE SYSTEM SHALL offer the next free time.</RuleNote>
                    <ArtifactNote>phase: spec_approval · waiting for you</ArtifactNote>
                  </TabsContent>
                  <TabsList className="mt-3">
                    <TabsTrigger value="no">Refused</TabsTrigger>
                    <TabsTrigger value="ok">After the fix</TabsTrigger>
                  </TabsList>
                </Artifact>
              </Tabs>
              <Body title={CARDS[0].title}>{CARDS[0].body}</Body>
            </article>
          </Reveal>

          {/* 2 — what exists and what does not */}
          <Reveal delay={0.08}>
            <article className="flex h-full flex-col rounded-[14px] border border-line bg-white p-[1.15rem] shadow-[0_1px_2px_rgba(25,25,29,0.04)]">
              <Tag>{CARDS[1].tag}</Tag>
              <Artifact>
                <div className="flex-1 space-y-1.5">
                  <ToolLine state="ok" tool="provision_database" status="live + safe copy" />
                  <ToolLine state="ok" tool="propose_migration" status="rehearsed on a copy" />
                  <ToolLine state="ok" tool="promote_migration" status="after the tests pass" />
                  <ToolLine state="gone" tool="execute_sql" status="no such tool" />
                </div>
                <ArtifactNote>Not restricted. Absent.</ArtifactNote>
              </Artifact>
              <Body title={CARDS[1].title}>{CARDS[1].body}</Body>
            </article>
          </Reveal>

          {/* 3 — the two human gates */}
          <Reveal delay={0.16}>
            <article className="flex h-full flex-col rounded-[14px] border border-line bg-white p-[1.15rem] shadow-[0_1px_2px_rgba(25,25,29,0.04)]">
              <Tag>{CARDS[2].tag}</Tag>
              <Artifact>
                <div className="flex-1 space-y-2">
                  <AskRow title="Approve the plan" phase="spec_approval" />
                  <AskRow title="Confirm publish" phase="verify_approval" />
                </div>
                <ArtifactNote>Both clicks happen in your browser.</ArtifactNote>
              </Artifact>
              <Body title={CARDS[2].title}>{CARDS[2].body}</Body>
            </article>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="mono mb-3.5 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-blue-ink">{children}</span>;
}

function Body({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <h3 className="mt-[1.1rem] text-[1.05rem] leading-tight">{title}</h3>
      <p className="mt-1.5 text-[0.92rem] leading-relaxed text-ink-2">{children}</p>
    </>
  );
}
