import { Hero } from '@/components/site/hero';
import { Manifesto } from '@/components/site/manifesto';
import { Steps } from '@/components/site/steps';
import { Figure, Rest } from '@/components/site/figure';
import {
  ApprovalExhibit,
  ExportExhibit,
  MigrationExhibit,
  RefusalExhibit,
} from '@/components/site/exhibits';
import { Clients } from '@/components/site/clients';
import { ProofStrip } from '@/components/site/proof-strip';
import { PricingStrip } from '@/components/site/pricing-strip';
import { CTA } from '@/components/site/cta';

/**
 * The page is a set of exhibits.
 *
 * Power has almost no interface — its surface is a terminal and a set of tool
 * results — so every claim here is paired with the output that demonstrates it
 * rather than with a picture of a screen. The figures are numbered because a
 * labelled exhibit reads as evidence and a paragraph beside a screenshot reads
 * as marketing.
 */
export default function HomePage() {
  return (
    <>
      <Hero />
      <Manifesto />
      <Steps />

      <Figure
        n="1.1"
        eyebrow="The refusal"
        title={<>Gates the model can&rsquo;t <em className="text-accent">argue</em> with.</>}
        artifact={<RefusalExhibit />}
      >
        <p>
          Phase rules are code, not instructions in a prompt. A tool called out of order does not
          error — it comes back refused, naming the rule it broke and the one call that moves
          forward.
        </p>
        <p>
          Every retry is counted. After two, the run stops and asks you instead of looping, because
          an agent retrying forever burns your budget while looking like progress.
        </p>
      </Figure>

      <Figure
        n="1.2"
        eyebrow="The rehearsal"
        title={<>A database it <em className="text-accent">cannot</em> break.</>}
        artifact={<MigrationExhibit />}
        flip
      >
        <p>
          Every project gets two branches: the live one, and a safe copy the assistant writes to
          freely. A schema change is rehearsed on a throwaway copy of live, judged by a gate, and
          has to be reversible before it can be promoted.
        </p>
        <p>
          Promotion snapshots live first. If it goes wrong, the snapshot restores it.
        </p>
      </Figure>

      <Rest>Two decisions are never automatic.</Rest>

      <Figure
        n="1.3"
        eyebrow="The two stops"
        title={<>You approve. It <em className="text-accent">asks.</em></>}
        artifact={<ApprovalExhibit />}
      >
        <p>
          Nothing is built before you approve the plan, and nothing reaches your live app before you
          confirm it in a browser. Both confirmations are single-use and bound to one project.
        </p>
        <p>
          Taking a published app offline needs you to type its name. A button is too easy to click
          on an assistant&rsquo;s say-so.
        </p>
      </Figure>

      <Figure
        n="1.4"
        eyebrow="The way out"
        title={<>Leaving costs you <em className="text-accent">nothing.</em></>}
        artifact={<ExportExhibit />}
        flip
      >
        <p>
          Power runs no hosting. A published app goes to your own account, so you keep it whether or
          not you keep using Power.
        </p>
        <p>
          The export is a real git repository with its full history — every gate boundary is a
          commit — and it runs anywhere Postgres does. It is free, deliberately and permanently.
        </p>
      </Figure>

      <Clients />
      <ProofStrip />
      <PricingStrip />
      <CTA />
    </>
  );
}
