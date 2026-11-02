import type { Metadata } from 'next';
import Link from 'next/link';
import { POSTS } from '@/lib/posts';

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Notes on agents, MCP and shipping software with a model in the loop.',
};

export default function BlogPage() {
  return (
    <div className="page">
      <section className="page-hero">
        <div className="shell">
          <span className="eyebrow reveal">
            <span className="eyebrow-dot" />
            Blog
          </span>
          <h1 className="page-title reveal">
            Notes on agents,
            <br />
            MCP and shipping
          </h1>
          <p className="page-sub reveal">
            Short, practical writing about the parts that decide whether an agent ships
            something worth keeping: context, contracts and checks.
          </p>
        </div>
      </section>

      <section className="page-section blog-index">
        <div className="shell">
          <div className="post-grid">
            {POSTS.map((post) => (
              <Link className="post reveal" href={`/blog/${post.slug}/`} key={post.slug}>
                <div className="post-media">
                  <img src={post.image} alt={post.imageAlt} loading="lazy" />
                </div>
                <div className="post-body">
                  <h3>{post.title}</h3>
                  <p className="post-deck">{post.description}</p>
                  <div className="post-meta">
                    <span>{post.category}</span>
                    <span className="dot-sep" />
                    <time dateTime={post.date}>{post.displayDate}</time>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
