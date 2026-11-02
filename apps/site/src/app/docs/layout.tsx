import { DocsNav } from '@/components/site/docs-nav';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell docs-layout">
      <DocsNav />
      {children}
    </div>
  );
}
