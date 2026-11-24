import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

const base: NextConfig = {
  output: 'export',
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  images: { unoptimized: true },
  trailingSlash: true,
  typescript: { ignoreBuildErrors: false },
};

/**
 * `next dev` and `next build` get separate build folders. They used to share
 * `.next`, so running `pnpm build:site` while `pnpm dev:site` was up replaced
 * the dev server's runtime chunks: the page stopped hydrating, power.js never
 * ran, and every scroll-revealed section stayed black until a restart.
 */
export default function config(phase: string): NextConfig {
  return phase === PHASE_DEVELOPMENT_SERVER ? { ...base, distDir: '.next-dev' } : base;
}
