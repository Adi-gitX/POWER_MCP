import { cn } from '@/lib/utils';

/** The shell every artifact sits in: one panel, one border, one type scale. */
export function Artifact({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('mono flex h-[230px] flex-col rounded-[10px] border border-line bg-paper-2 p-3 text-[0.76rem]', className)}>
      {children}
    </div>
  );
}

export function ArtifactNote({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <p className={cn('mt-3 border-t border-line pt-2.5 font-sans text-[0.7rem] leading-snug text-ink-2', className)}>
      {children}
    </p>
  );
}

type LineState = 'ok' | 'no' | 'gone' | 'idle';

const GLYPH: Record<LineState, string> = { ok: '✓', no: '×', gone: '―', idle: '·' };

/** One tool call: glyph, name, and what the server answered. */
export function ToolLine({ state = 'idle', tool, status }: { state?: LineState; tool: string; status: string }) {
  return (
    <div className="grid grid-cols-[0.9rem_minmax(0,1fr)] items-baseline gap-x-2">
      <span className={cn(state === 'ok' && 'text-pass', state === 'no' && 'text-refuse', (state === 'gone' || state === 'idle') && 'text-ink-3')}>
        {GLYPH[state]}
      </span>
      <span className={cn('break-words', state === 'gone' ? 'text-ink-3 line-through decoration-line-2' : 'text-ink')}>
        {tool}
      </span>
      <span className={cn('col-start-2 text-[0.68rem]', state === 'ok' && 'text-pass', (state === 'no' || state === 'gone') && 'text-refuse', state === 'idle' && 'text-ink-2')}>
        {status}
      </span>
    </div>
  );
}

/** The rule a gate names, or the requirement that satisfied it. */
export function RuleNote({ tone, id, children }: { tone: 'no' | 'ok'; id: string; children: React.ReactNode }) {
  return (
    <div className={cn('mt-0.5 rounded-r-md border-l-2 bg-white px-2.5 py-2', tone === 'no' ? 'border-refuse' : 'border-pass')}>
      <b className={cn('mb-0.5 block font-semibold', tone === 'no' ? 'text-refuse' : 'text-pass')}>{id}</b>
      <span className="leading-snug text-ink-2">{children}</span>
    </div>
  );
}

/** A stop that waits for a person. */
export function AskRow({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="flex items-center justify-between gap-2.5 rounded-lg border border-line-2 bg-white px-2.5 py-2">
      <span className="grid min-w-0">
        <b className="font-sans text-[0.82rem] font-semibold leading-tight text-ink">{title}</b>
        <span className="text-[0.68rem] text-ink-2">{phase}</span>
      </span>
      <span className="shrink-0 rounded-full bg-blue px-1.5 py-0.5 font-sans text-[0.62rem] font-bold uppercase tracking-wider text-white">
        you
      </span>
    </div>
  );
}
