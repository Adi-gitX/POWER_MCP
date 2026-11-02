import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { POSTS, postFor } from '@/lib/posts';

export const dynamicParams = false;

export function generateStaticParams() {
  return POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = postFor(slug);
  if (!post) return { title: 'Blog' };
  return {
    title: post.title,
    description: post.description,
    openGraph: { type: 'article', title: post.title, description: post.description },
  };
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = postFor(slug);
  if (!post) notFound();

  const more = POSTS.filter((item) => item.slug !== post.slug).slice(0, 2);

  return (
    <article className="page">
      <header className="page-hero article-hero">
        <div className="shell">
          <Link className="back-link" href="/blog/">
            <svg className="icon" aria-hidden>
              <use href="#i-arrow-left" />
            </svg>
            All notes
          </Link>
          <div className="article-meta">
            <span>{post.category}</span>
            <span className="dot-sep" />
            <time dateTime={post.date}>{post.displayDate}</time>
          </div>
          <h1 className="page-title article-title">{post.title}</h1>
          <p className="page-sub">{post.description}</p>
        </div>
      </header>

      <div className="shell article-body">
        <div className="prose article-prose" dangerouslySetInnerHTML={{ __html: post.html }} />
        <footer className="article-foot">
          <span className="micro-label">
            <svg className="icon" aria-hidden>
              <use href="#i-arrow-right" />
            </svg>
            Keep reading
          </span>
          <div className="article-more">
            {more.map((item) => (
              <Link href={`/blog/${item.slug}/`} key={item.slug}>
                <span>{item.category}</span>
                <strong>{item.title}</strong>
                <svg className="icon" aria-hidden>
                  <use href="#i-arrow-right" />
                </svg>
              </Link>
            ))}
          </div>
        </footer>
      </div>
    </article>
  );
}
