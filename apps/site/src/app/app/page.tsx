import type { Metadata } from 'next';
import { Workspace } from '@/components/site/workspace';

export const metadata: Metadata = {
  title: 'Workspace',
  description:
    'The build bench: sessions on the left, the verified pipeline behind every send, browser, files, terminal and changes on the right.',
};

export default function WorkspacePage() {
  return <Workspace />;
}
