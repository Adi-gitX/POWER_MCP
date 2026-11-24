/**
 * The four exhibits.
 *
 * Every one of these renders something Power actually emits — a refusal, a
 * rehearsal verdict, an approval record, an exported repository — rather than
 * a picture of a user interface. Power has almost no interface: its surface is
 * a terminal and a set of tool results, so the honest thing to show is the
 * output itself.
 *
 * They are static on purpose. A looping animation in four places at once is
 * noise, and these are meant to be read.
 */
import { cn } from '@/lib/utils';

/** The shell every exhibit shares, so four different things still look related. */
function Panel({
  title,
  right,
  dark = false,
  className,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  dark?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'min-w-0 overflow-hidden rounded-[14px] border shadow-[0_24px_60px_-40px_rgba(16,40,90,0.45)]',
        dark ? 'border-[#23242b] bg-[#101116]' : 'border-line bg-surface',
        className,
      )}
    >
      <div
        className={cn(
          'flex items-center justify-between gap-3 border-b px-4 py-2.5',
          dark ? 'border-brightline/10' : 'border-line bg-paper-2',
        )}
      >
        <span
          className={cn(
            'mono text-[0.68rem] uppercase tracking-[0.14em]',
            dark ? 'text-bright/40' : 'text-ink-3',
          )}
        >
          {title}
        </span>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Pill({ tone, children }: { tone: 'ok' | 'no' | 'wait'; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'mono rounded-full px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wider',
        tone === 'ok' && 'bg-pass-wash text-pass',
        tone === 'no' && 'bg-refuse-wash text-refuse',
        tone === 'wait' && 'bg-accent-wash text-accent-ink',
      )}
    >
      {children}
    </span>
  );
}

/* ── Fig 1.1 — the refusal ───────────────────────────────────────────────── */

export function RefusalExhibit() {
  return (
    <Panel title="tool result" dark right={<Pill tone="no">refused</Pill>}>
      <pre className="mono overflow-x-auto text-[0.76rem] leading-relaxed text-bright/75">
        <span className="text-bright/35">{'> '}</span>
        <span className="text-bright">write_file</span>
        <span className="text-bright/45">{'({ path: "src/app.ts" })'}</span>
        {'\n\n'}
        <span className="text-refuse">{'{'}</span>
        {'\n  '}
        <span className="text-bright/50">&quot;ok&quot;</span>: <span className="text-refuse">false</span>,
        {'\n  '}
        <span className="text-bright/50">&quot;reason&quot;</span>:{' '}
        <span className="text-[#e8a33d]">&quot;wrong_phase&quot;</span>,
        {'\n  '}
        <span className="text-bright/50">&quot;rule&quot;</span>:{' '}
        <span className="text-[#e8a33d]">&quot;build.requires_approved_spec&quot;</span>,
        {'\n  '}
        <span className="text-bright/50">&quot;message&quot;</span>:{' '}
        <span className="text-bright/80">&quot;No approved plan yet, so nothing</span>
        {'\n     '}
        <span className="text-bright/80">can be written. The user approves it</span>
        {'\n     '}
        <span className="text-bright/80">in a browser, not in chat.&quot;</span>,
        {'\n  '}
        <span className="text-bright/50">&quot;next_action&quot;</span>:{' '}
        <span className="text-[#6ea8fe]">&quot;submit_spec&quot;</span>,
        {'\n  '}
        <span className="text-bright/50">&quot;billed&quot;</span>: <span className="text-pass">false</span>
        {'\n'}
        <span className="text-refuse">{'}'}</span>
      </pre>
      <p className="mt-3 border-t border-brightline/10 pt-2.5 font-sans text-[0.72rem] leading-snug text-bright/45">
        A refusal is a successful response, not an error. It names the rule it broke and the one
        tool that moves forward, so the next attempt converges instead of guessing. Refusals are
        never billed.
      </p>
    </Panel>
  );
}

/* ── Fig 1.2 — the rehearsal ─────────────────────────────────────────────── */

const DIFF: { sign: ' ' | '+' | '-'; text: string }[] = [
  { sign: ' ', text: 'create table orders (' },
  { sign: ' ', text: '  id          bigserial primary key,' },
  { sign: '-', text: '  customer    text not null,' },
  { sign: '+', text: '  customer_id text not null references customers(id),' },
  { sign: '+', text: '  placed_at   timestamptz not null default now(),' },
  { sign: ' ', text: ');' },
];

export function MigrationExhibit() {
  return (
    <Panel title="migration rehearsal" right={<Pill tone="ok">reversible</Pill>}>
      <div className="mono max-w-full overflow-x-auto rounded-[10px] border border-line bg-paper-2 text-[0.74rem] leading-relaxed">
        {DIFF.map((line, i) => (
          <div
            key={i}
            className={cn(
              'flex gap-2 px-3 py-[0.1rem]',
              line.sign === '+' && 'bg-pass-wash',
              line.sign === '-' && 'bg-refuse-wash',
            )}
          >
            <span
              className={cn(
                'select-none',
                line.sign === '+' && 'text-pass',
                line.sign === '-' && 'text-refuse',
                line.sign === ' ' && 'text-ink-3',
              )}
            >
              {line.sign}
            </span>
            <span
              className={cn(
                'whitespace-pre',
                line.sign === '-' ? 'text-refuse' : line.sign === '+' ? 'text-ink' : 'text-ink-2',
              )}
            >
              {line.text}
            </span>
          </div>
        ))}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 font-sans text-[0.74rem]">
        {[
          ['Rehearsed on', 'a copy of live'],
          ['Rows touched', '0 destroyed'],
          ['Down migration', 'present, tested'],
          ['Snapshot', 'taken before promote'],
        ].map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-2 border-b border-line pb-1">
            <dt className="text-ink-3">{k}</dt>
            <dd className="mono text-[0.72rem] text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 font-sans text-[0.72rem] leading-snug text-ink-2">
        No tool runs arbitrary SQL against your live database. That absence is the feature.
      </p>
    </Panel>
  );
}

/* ── Fig 1.3 — the record ────────────────────────────────────────────────── */

const LOG = [
  { action: 'spec.approved', actor: 'you', target: 'browser', time: '14:02' },
  { action: 'migration.rehearsed', actor: 'power', target: 'scratch copy', time: '14:19' },
  { action: 'migration.promoted', actor: 'you', target: 'typed the name', time: '14:21' },
  { action: 'publish.confirmed', actor: 'you', target: 'browser', time: '14:26' },
  { action: 'app.published', actor: 'power', target: 'your hosting', time: '14:27' },
];

export function ApprovalExhibit() {
  return (
    <Panel title="audit log" right={<Pill tone="wait">2 human decisions</Pill>}>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="font-sans text-[0.66rem] uppercase tracking-[0.1em] text-ink-3">
            <th className="pb-2 font-medium">Action</th>
            <th className="pb-2 font-medium">Actor</th>
            <th className="hidden pb-2 font-medium sm:table-cell">Where</th>
            <th className="pb-2 text-right font-medium">Time</th>
          </tr>
        </thead>
        <tbody className="mono text-[0.74rem]">
          {LOG.map((row) => (
            <tr key={row.action} className="border-t border-line">
              <td className="py-2 pr-3 text-ink">{row.action}</td>
              <td className="py-2 pr-3">
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wider',
                    row.actor === 'you' ? 'bg-accent text-bright' : 'bg-paper-2 text-ink-2',
                  )}
                >
                  {row.actor}
                </span>
              </td>
              <td className="hidden py-2 pr-3 text-ink-2 sm:table-cell">{row.target}</td>
              <td className="py-2 text-right text-ink-3">{row.time}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 border-t border-line pt-2.5 font-sans text-[0.72rem] leading-snug text-ink-2">
        Approving the plan and confirming anything that reaches live both happen in a browser. The
        assistant can ask for them. It cannot answer.
      </p>
    </Panel>
  );
}

/* ── Fig 1.4 — the way out ───────────────────────────────────────────────── */

const TREE = [
  { depth: 0, name: 'your-app/', dim: false },
  { depth: 1, name: '.git/', note: 'full history, every gate a commit', dim: true },
  { depth: 1, name: 'src/', dim: false },
  { depth: 2, name: 'app.ts', dim: false },
  { depth: 2, name: 'db.ts', dim: false },
  { depth: 2, name: 'auth.ts', dim: false },
  { depth: 1, name: 'migrations/', dim: false },
  { depth: 1, name: 'docker-compose.yml', note: 'Postgres, locally', dim: true },
  { depth: 1, name: 'SPEC.md', note: 'what you approved', dim: true },
  { depth: 1, name: '.env.example', dim: true },
];

export function ExportExhibit() {
  return (
    <Panel title="export_project" right={<Pill tone="ok">always free</Pill>}>
      <div className="mono space-y-[0.1rem] text-[0.76rem]">
        {TREE.map((row) => (
          <div key={row.name} className="flex items-baseline gap-2">
            <span style={{ paddingLeft: `${row.depth * 0.9}rem` }} className={row.dim ? 'text-ink-2' : 'text-ink'}>
              {row.name}
            </span>
            {row.note && <span className="truncate text-[0.68rem] text-ink-3">— {row.note}</span>}
          </div>
        ))}
      </div>
      <p className="mt-3 border-t border-line pt-2.5 font-sans text-[0.72rem] leading-snug text-ink-2">
        A real repository with real history, not a zip of the current files. It runs with{' '}
        <code className="mono rounded bg-paper-2 px-1 text-[0.7rem]">docker compose up</code> on a
        laptop that has never heard of Power.
      </p>
    </Panel>
  );
}
