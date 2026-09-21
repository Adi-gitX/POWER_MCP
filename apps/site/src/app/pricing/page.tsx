import type { Metadata } from 'next';
import Link from 'next/link';
import { PLANS } from '@power/protocol';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Reveal } from '@/components/motion/reveal';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Flat monthly plans metered in build actions, not tokens. Refused calls are never billed. Reads and export are free on every plan.',
};

const ORDER = ['free', 'pro', 'power'] as const;
const LABEL: Record<(typeof ORDER)[number], string> = { free: 'Free', pro: 'Pro', power: 'Power' };
const BLURB: Record<(typeof ORDER)[number], string> = {
  free: 'Enough to take one idea all the way to published.',
  pro: 'For someone shipping and maintaining real projects.',
  power: 'For a team running several projects at once.',
};

const FEATURES: [string, (boolean | string)[]][] = [
  ['Build actions a day', ['100', '1,000', '5,000']],
  ['Projects', ['3', 'Unlimited', 'Unlimited']],
  ['Every gate and every refusal', [true, true, true]],
  ['Reads, context and export', ['Free', 'Free', 'Free']],
  ['Live database with a safe copy', [true, true, true]],
  ['Hosting and a rollback tag', [true, true, true]],
  ['Bring your own inference', [true, true, true]],
  ['Priority on long jobs', [false, true, true]],
  ['Self-host the server', [true, true, true]],
];

const FAQ: [string, string][] = [
  ['What is a build action?', 'One tool call that changes something: writing a file, proposing a migration, running the tests, publishing. Reading context, listing files and exporting your code are free and always have been.'],
  ['What happens when a gate refuses?', 'The call is refunded before the response is sent, so a refusal never costs you an action. Your AI gets the rule id, the reason and the next action to take.'],
  ['Do I pay for tokens as well?', 'Not to us. Power runs inside the AI you already pay for, so the thinking happens on your existing subscription. We meter the work, not the words.'],
  ['Can I take my code with me?', 'Yes, at any time, on any plan, including free. Export gives you the full git history, the schema and the migrations. There is no build step that only we can run.'],
];

export default function PricingPage() {
  return (
    <>
      <section className="pb-8 pt-16">
        <div className="wrap max-w-3xl text-center">
          <span className="eyebrow">Pricing</span>
          <h1 className="serif mx-auto mt-6 max-w-[18ch] text-[clamp(2.4rem,5.4vw,4rem)] leading-[1.02] tracking-tight">
            Pay for work that passed.
          </h1>
          <p className="mt-5 text-[1.15rem] leading-relaxed text-ink-2">
            Flat monthly plans, metered in build actions rather than tokens. A refused call is
            refunded before the response is sent.
          </p>
        </div>
      </section>

      <section className="pb-8">
        <div className="wrap grid gap-4 md:grid-cols-3">
          {ORDER.map((k, i) => {
            const p = PLANS[k];
            const featured = k === 'pro';
            return (
              <Reveal key={k} delay={i * 0.06}>
                <div
                  className={cn(
                    'flex h-full flex-col rounded-[18px] border p-7',
                    featured ? 'border-blue bg-blue-wash' : 'border-line bg-white',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-[1.15rem] font-semibold">{LABEL[k]}</h2>
                    {featured && (
                      <span className="rounded-full bg-blue px-2.5 py-1 text-[0.62rem] font-bold uppercase tracking-wider text-white">
                        Most picked
                      </span>
                    )}
                  </div>
                  <p className="mt-2 min-h-[3rem] text-[0.92rem] leading-relaxed text-ink-2">{BLURB[k]}</p>
                  <p className="mt-4 flex items-baseline gap-1.5">
                    <span className="serif text-[3.2rem] leading-none">${p.price_usd_month}</span>
                    <span className="text-[0.92rem] text-ink-2">/ month</span>
                  </p>
                  <p className="mono mt-3 text-[0.76rem] text-ink-2">
                    {p.per_day.toLocaleString()} actions a day
                    {p.per_week ? ` · ${p.per_week} a week` : ''}
                  </p>
                  <Button asChild variant={featured ? 'primary' : 'secondary'} className="mt-6 w-full">
                    <Link href="/docs/getting-started/">{p.price_usd_month === 0 ? 'Start free' : `Choose ${LABEL[k]}`}</Link>
                  </Button>
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2 className="serif text-h2">What each plan includes</h2>
          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-[0.95rem]">
              <thead>
                <tr className="border-b border-line-2">
                  <th className="py-3 text-left font-semibold" />
                  {ORDER.map((k) => <th key={k} className="py-3 text-left font-semibold">{LABEL[k]}</th>)}
                </tr>
              </thead>
              <tbody>
                {FEATURES.map(([label, vals]) => (
                  <tr key={label} className="border-b border-line">
                    <td className="py-3.5 pr-6 text-ink">{label}</td>
                    {vals.map((v, i) => (
                      <td key={i} className="py-3.5 text-ink-2">
                        {v === true ? <span className="text-pass">✓</span> : v === false ? <span className="text-ink-3">—</span> : v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section pt-0">
        <div className="wrap max-w-3xl">
          <h2 className="serif text-h2">Questions people actually ask</h2>
          <Accordion type="single" collapsible className="mt-8 border-t border-line">
            {FAQ.map(([q, a]) => (
              <AccordionItem key={q} value={q}>
                <AccordionTrigger>{q}</AccordionTrigger>
                <AccordionContent>{a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>
    </>
  );
}
