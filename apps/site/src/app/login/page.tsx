import type { Metadata } from 'next';
import '../auth.css';
import { AuthScreen } from '@/components/landing/auth';

export const metadata: Metadata = {
  title: 'Sign in',
  description:
    'Sign in to Power with one email link, connect your AI client, and ship a verified app tonight.',
  robots: { index: false, follow: true },
};

export default function LoginPage() {
  return <AuthScreen />;
}
