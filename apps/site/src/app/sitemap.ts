import type { MetadataRoute } from 'next';
import { DOCS } from '@/lib/docs';
import { POSTS } from '@/lib/posts';
import { SITE } from '@/lib/site';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE.url.replace(/\/+$/, '');
  const url = (path: string) => `${base}${path}`;

  const pages: MetadataRoute.Sitemap = [
    { url: url('/'), changeFrequency: 'weekly', priority: 1 },
    { url: url('/pricing/'), changeFrequency: 'monthly', priority: 0.9 },
    { url: url('/proof/'), changeFrequency: 'monthly', priority: 0.8 },
    { url: url('/docs/'), changeFrequency: 'weekly', priority: 0.9 },
    { url: url('/blog/'), changeFrequency: 'weekly', priority: 0.7 },
    { url: url('/updates/'), changeFrequency: 'weekly', priority: 0.6 },
    { url: url('/privacy/'), changeFrequency: 'yearly', priority: 0.3 },
    { url: url('/terms/'), changeFrequency: 'yearly', priority: 0.3 },
  ];

  const docs = DOCS.filter((doc) => doc.slug !== 'index').map((doc) => ({
    url: url(`/docs/${doc.slug}/`),
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }));

  const posts = POSTS.map((post) => ({
    url: url(`/blog/${post.slug}/`),
    lastModified: new Date(post.date),
    changeFrequency: 'yearly' as const,
    priority: 0.6,
  }));

  return [...pages, ...docs, ...posts];
}
