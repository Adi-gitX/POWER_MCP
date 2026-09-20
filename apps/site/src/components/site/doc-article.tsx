import type { Doc } from '@/lib/docs';

/** The docs bodies are trusted HTML we author in this repo, not user input. */
export function DocArticle({ doc }: { doc: Doc }) {
  return (
    <article className="min-w-0">
      <h1 className="serif text-[clamp(2rem,3.6vw,2.8rem)] leading-tight">{doc.title}</h1>
      <p className="mt-3 text-[1.1rem] leading-relaxed text-ink-2">{doc.description}</p>
      <div
        className="prose prose-neutral mt-9 max-w-[68ch]
          prose-headings:font-medium prose-headings:tracking-tight
          prose-h2:mt-12 prose-h2:text-[1.5rem] prose-h3:text-[1.1rem]
          prose-p:text-ink-2 prose-li:text-ink-2
          prose-a:text-blue prose-a:no-underline hover:prose-a:underline
          prose-strong:text-ink
          prose-code:rounded prose-code:bg-paper-2 prose-code:px-1.5 prose-code:py-0.5
          prose-code:font-normal prose-code:text-ink prose-code:before:content-none prose-code:after:content-none
          prose-pre:rounded-xl prose-pre:bg-[#101116] prose-pre:text-[0.84rem]
          prose-table:text-[0.9rem] prose-th:text-ink prose-td:text-ink-2"
        dangerouslySetInnerHTML={{ __html: doc.html }}
      />
    </article>
  );
}
