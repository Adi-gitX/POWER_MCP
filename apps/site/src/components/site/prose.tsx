import { cn } from '@/lib/utils';

/** Docs body. One place decides how long-form content looks. */
export function Prose({ html, className }: { html: string; className?: string }) {
  return (
    <div
      className={cn(
        'prose prose-neutral max-w-[68ch]',
        'prose-headings:font-medium prose-headings:tracking-tight',
        'prose-h2:mt-12 prose-h2:text-[1.6rem] prose-h3:text-[1.1rem]',
        'prose-p:text-ink-2 prose-li:text-ink-2',
        'prose-a:text-blue prose-a:no-underline hover:prose-a:underline',
        'prose-strong:text-ink prose-strong:font-semibold',
        'prose-code:rounded prose-code:bg-paper-2 prose-code:px-1.5 prose-code:py-0.5',
        'prose-code:font-mono prose-code:text-[0.86em] prose-code:font-normal prose-code:text-ink',
        'prose-code:before:content-none prose-code:after:content-none',
        'prose-pre:rounded-xl prose-pre:border prose-pre:border-[#23242b] prose-pre:bg-[#101116]',
        'prose-table:text-[0.9rem] prose-th:text-ink prose-td:align-top',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
