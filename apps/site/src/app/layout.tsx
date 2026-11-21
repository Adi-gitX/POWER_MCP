import type { Metadata, Viewport } from 'next';
import './globals.css';
import './power.css';
import Script from 'next/script';
import { SITE } from '@/lib/site';
import { SiteNav } from '@/components/site/nav';
import { SiteClosing } from '@/components/site/closing';
import { SiteFooter } from '@/components/site/footer';
import { SmoothScroll } from '@/components/motion/smooth-scroll';
import { IconSprite } from '@/components/site/icon-sprite';

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name} — ship it checked`, template: `%s — ${SITE.name}` },
  description:
    'Power is the MCP server that builds, checks and hosts full-stack apps. Your model does the thinking; real code execution and deterministic gates verify the work before production.',
  openGraph: {
    type: 'website',
    siteName: SITE.name,
    title: 'Power — ship it checked',
    description:
      'Build full-stack apps with the AI you already use. Every step is checked by real code, and two decisions stay yours.',
    images: [
      {
        url: '/assets/img/art/hero-warrior.jpg',
        width: 2000,
        height: 1039,
        alt: 'A marble statue against a bright blue sky — Power, ship it checked.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Power — ship it checked',
    description:
      'Build full-stack apps with the AI you already use. Every step is checked by real code, and two decisions stay yours.',
    images: ['/assets/img/art/hero-warrior.jpg'],
  },
  icons: { icon: '/assets/img/power-mark.svg' },
};

export const viewport: Viewport = { themeColor: '#f4f1ea' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }}
        />
        <link
          rel="preload"
          href="/assets/fonts/inter-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin=""
        />
        <link
          rel="preload"
          href="/assets/fonts/instrument-serif.woff2"
          as="font"
          type="font/woff2"
          crossOrigin=""
        />

      </head>
      <body>
        <SmoothScroll />
        <IconSprite />
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <SiteNav />
        <main id="main">{children}</main>
        <SiteClosing />
        <SiteFooter />
        <Script src="/assets/js/power.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
