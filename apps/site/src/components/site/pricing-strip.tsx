import Link from 'next/link';
import { PLANS } from '@power/protocol';
import { Reveal } from '@/components/motion/reveal';
import { Button } from '@/components/ui/button';

const ORDER = ['free', 'pro', 'power'] as const;
const LABEL: Record<(typeof ORDER)[number], string> = { free: 'Free', pro: 'Pro', power: 'Power' };

export function PricingStrip() {
  return (
    <section className="section">
      <div className="wrap grid gap-10 lg:grid-cols-12">
        <Reveal className="lg:col-span-4">
          <span className="eyebrow">Pricing</span>
          <h2 className="serif mt-5 text-h2">Pay for work that passed.</h2>
          <p className="mt-4 text-ink-2">
            Metered in build actions, not tokens. A refused call is refunded before the response
            is sent.
          </p>
        </Reveal>

        <Reveal delay={0.08} className="lg:col-span-8">
          <ul className="divide-y divide-line border-y border-line">
            {ORDER.map((k) => {
              const p = PLANS[k];
              return (
                <li key={k} className="flex flex-wrap items-center justify-between gap-4 py-5">
                  <span className="flex items-baseline gap-4">
                    <span className="serif w-20 text-[2.2rem] leading-none">${p.price_usd_month}</span>
                    <span className="grid">
                      <b className="font-semibold">{LABEL[k]}</b>
                      <small className="mono text-[0.74rem] text-ink-2">
                        {p.per_day.toLocaleString()} actions a day
                        {p.per_week ? ` · ${p.per_week} a week` : ''} ·{' '}
                        {p.projects ? `${p.projects} projects` : 'unlimited projects'}
                      </small>
                    </span>
                  </span>
                  <span className="text-[0.88rem] text-ink-3">per month</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-5 text-[0.92rem] text-ink-2">
            Refused calls are never billed. Reads and export are free on every plan.{' '}
            <Link href="/pricing/" className="text-blue hover:underline">See what counts →</Link>
          </p>
        </Reveal>
      </div>
    </section>
  );
}
