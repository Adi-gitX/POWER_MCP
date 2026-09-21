import { DocsNav } from '@/components/site/docs-nav';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="wrap grid gap-10 py-14 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-16">
      <DocsNav />
      {children}
    </div>
  );
}
