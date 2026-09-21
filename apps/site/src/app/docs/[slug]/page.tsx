import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DOCS, getDoc } from '@/lib/docs';
import { DocArticle } from '@/components/site/doc-article';

export function generateStaticParams() {
  return DOCS.filter((d) => d.slug !== 'index').map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const doc = getDoc(slug);
  return doc ? { title: doc.title, description: doc.description } : {};
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) notFound();
  return <DocArticle doc={doc} />;
}
