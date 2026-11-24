import { Reveal } from '@/components/motion/reveal';

const ROWS: [string, string][] = [
  ['Write code before the plan is approved', 'refused · wrong_phase'],
  ['Hand off a build with failing tests', 'refused · build gate'],
  ['Publish before verification', 'refused · gate_not_satisfied'],
  ['Run SQL against the live database', 'no such tool'],
  ['Drop a table on a button press', 'needs the project name typed'],
  ['Bill a refused call', 'never'],
  ['Keep your code from you', 'export is free, with history'],
];

export function Refusals() {
  return (
    <section className="section">
      <div className="wrap grid gap-10 lg:grid-cols-12">
        <Reveal className="lg:col-span-4">
          <span className="eyebrow">The difference</span>
          <h2 className="serif mt-5 text-h2">Refused, by code.</h2>
          <p className="mt-4 text-ink-2">
            Not guidelines in a prompt. Tool calls the server answers with a reason and a next step.
          </p>
        </Reveal>
        <Reveal delay={0.08} className="lg:col-span-8">
          <ul className="divide-y divide-line border-y border-line">
            {ROWS.map(([what, answer]) => (
              <li key={what} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4">
                <span>{what}</span>
                <span className="mono text-[0.78rem] text-ink-2">{answer}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
