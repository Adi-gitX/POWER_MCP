import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  images: { unoptimized: true },
  trailingSlash: true,
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
