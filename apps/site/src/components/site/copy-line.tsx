'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The command, copyable.
 *
 * For a product whose install step is one line in a terminal, this is the
 * first conversion event on the page — more important than any button, because
 * the person who copies it has already started. It sits next to the primary
 * call to action rather than being buried in the docs.
 */
export function CopyLine({
  command,
  tone = 'light',
  className,
  label = 'Copy the install command',
}: {
  command: string;
  /** `sky` sits on the blue hero; `light` sits on paper. */
  tone?: 'light' | 'sky';
  className?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      // A denied clipboard is not worth an error state: the text is on screen
      // and selectable, which is the fallback either way.
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  }, [command]);

  const sky = tone === 'sky';

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      className={cn(
        'group mono flex w-full min-w-0 max-w-full items-center gap-3 rounded-xl border py-2.5 pl-3.5 pr-2.5 text-left text-[0.82rem] transition-colors',
        sky
          ? 'border-brightline/25 bg-surface/20 text-bright/90 hover:bg-surface/30'
          : 'border-line bg-paper-2 text-ink hover:border-line-2',
        className,
      )}
    >
      <span className={cn('shrink-0 select-none', sky ? 'text-bright/45' : 'text-ink-3')}>$</span>
      <span className="min-w-0 flex-1 truncate">{command}</span>
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors',
          sky ? 'bg-surface/15 text-bright group-hover:bg-surface/25' : 'bg-surface text-ink-2 group-hover:text-ink',
        )}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </span>
      {/* Announced rather than only shown, so the confirmation is not purely visual. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  );
}
