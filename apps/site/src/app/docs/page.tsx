import type { Metadata } from 'next';
import { getDoc } from '@/lib/docs';
import { DocArticle } from '@/components/site/doc-article';

const doc = getDoc('index')!;

export const metadata: Metadata = { title: doc.title, description: doc.description };

export default function DocsIndex() {
  return <DocArticle doc={doc} />;
}
