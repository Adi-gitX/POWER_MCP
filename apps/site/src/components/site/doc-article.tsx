import type { Doc } from '@/lib/docs';

type Heading = { id: string; label: string };

/**
 * The docs bodies are trusted HTML we author in this repo, not user input.
 * Headings get stable ids so the “On this page” rail can link to them without
 * every article having to hand-maintain anchors.
 */
function withHeadingIds(html: string): { html: string; headings: Heading[] } {
  const headings: Heading[] = [];
  const seen = new Map<string, number>();
  const next = html.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/g, (match, attrs: string, inner: string) => {
    if (/\sid=/.test(attrs)) return match;
    const label = inner.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
    let id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!id) return match;
    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    if (count > 1) id = `${id}-${count}`;
    headings.push({ id, label });
    return `<h2${attrs} id="${id}">${inner}</h2>`;
  });
  return { html: next, headings };
}

export function DocArticle({ doc }: { doc: Doc }) {
  const { html, headings } = withHeadingIds(doc.html);

  return (
    <div className="doc-body">
      <article className="doc-article min-w-0">
        <span className="eyebrow doc-eyebrow">
          <span className="eyebrow-dot" />
          {doc.section}
        </span>
        <h1 className="doc-title">{doc.title}</h1>
        <p className="doc-sub">{doc.description}</p>
        <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />
      </article>

      {headings.length > 1 && (
        <aside className="doc-toc" aria-label="On this page">
          <h4>On this page</h4>
          <ol>
            {headings.map((heading) => (
              <li key={heading.id}>
                <a href={`#${heading.id}`}>{heading.label}</a>
              </li>
            ))}
          </ol>
        </aside>
      )}
    </div>
  );
}
