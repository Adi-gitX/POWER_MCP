import { cn } from '@/lib/utils';

/** The shell every artifact sits in: one panel, one border, one type scale. */
export function Artifact({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('artifact', className)}>{children}</div>;
}

export function ArtifactNote({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn('artifact-note', className)}>{children}</p>;
}

type LineState = 'ok' | 'no' | 'gone' | 'idle';

const GLYPH: Record<LineState, string> = { ok: '✓', no: '×', gone: '—', idle: '·' };

/** One tool call: glyph, name, and what the server answered. */
export function ToolLine({ state = 'idle', tool, status }: { state?: LineState; tool: string; status: string }) {
  return (
    <div className={cn('tool-line', `is-${state}`)}>
      <span className="tool-glyph">{GLYPH[state]}</span>
      <span className="tool-name">{tool}</span>
      <span className="tool-status">{status}</span>
    </div>
  );
}

/** The rule a gate names, or the requirement that satisfied it. */
export function RuleNote({ tone, id, children }: { tone: 'no' | 'ok'; id: string; children: React.ReactNode }) {
  return (
    <div className={cn('rule-note', tone === 'no' ? 'is-refuse' : 'is-pass')}>
      <b>{id}</b>
      <span>{children}</span>
    </div>
  );
}

/** A stop that waits for a person. */
export function AskRow({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="ask-row">
      <span>
        <b>{title}</b>
        <small>{phase}</small>
      </span>
      <em>You</em>
    </div>
  );
}
