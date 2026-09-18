import { Reveal } from '@/components/motion/reveal';
import { cn } from '@/lib/utils';

const STEPS = [
  { n: '01', title: 'Plan', you: false, body: 'Your AI writes a short spec. The gate checks it has requirements, acceptance criteria and tasks that trace to them.' },
  { n: '02', title: 'Approve', you: true, body: 'You read the plan and approve it in your browser. Nothing is built until you do.' },
  { n: '03', title: 'Build', you: false, body: 'Your AI writes code and tests in an isolated workbench. It can’t hand off until typecheck and tests are green.' },
  { n: '04', title: 'Verify', you: false, body: 'A fresh-eyes check against the plan. Every requirement must be exercised, not just looked at.' },
  { n: '05', title: 'Publish', you: true, body: 'You confirm. Power tags a release and puts it live. Rollback is one call.' },
];

export function Steps() {
  return (
    <section className="section bg-paper-2">
      <div className="wrap">
        <Reveal className="max-w-[46rem]">
          <span className="eyebrow">How it works</span>
          <h2 className="serif mt-5 text-h2">Five steps. Two of them are yours.</h2>
          <p className="mt-4 max-w-[52ch] text-[1.12rem] leading-relaxed text-ink-2">
            Your AI walks the pipeline, code checks each step, and you make the two decisions
            that should be a person’s.
          </p>
        </Reveal>

        <div className="relative mt-12">
          {/* the connector sits behind the cards, so it shows only in the gaps */}
          <div
            aria-hidden
            className="absolute left-[10%] right-[10%] top-[calc(1.2rem+12px)] hidden h-0.5 rounded bg-gradient-to-r from-blue to-blue/25 opacity-60 lg:block"
          />
          <ol className="relative grid gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 0.06}>
                <li
                  className={cn(
                    'flex h-full flex-col rounded-[14px] border p-[1.2rem]',
                    s.you ? 'border-blue-line bg-gradient-to-b from-blue-wash to-[#e3ecfd]' : 'border-line bg-white',
                  )}
                >
                  <div className="flex min-h-6 items-center justify-between gap-2">
                    <span className="mono text-[0.74rem] font-semibold leading-6 tracking-[0.1em] text-blue-ink">{s.n}</span>
                    {s.you && (
                      <span className="rounded-full border border-blue-line bg-white px-2 py-1 text-[0.62rem] font-bold uppercase leading-none tracking-[0.1em] text-blue-ink">
                        you
                      </span>
                    )}
                  </div>
                  <h3 className="mt-3.5 text-[1.03rem] leading-tight">{s.title}</h3>
                  <p className="mt-1.5 text-[0.9rem] leading-relaxed text-ink-2">{s.body}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>

        <Reveal delay={0.1}>
          <p className="mt-8 max-w-[56ch] text-ink-2">
            Then: <em className="text-ink">“add dark mode.”</em> A new run starts against the same
            project — same code, data and secrets, fresh plan, fresh checks.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
