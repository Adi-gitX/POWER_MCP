import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vite searches upward for a PostCSS config and would otherwise pick up an
  // unrelated one from the home directory. This repo has no CSS to process.
  css: { postcss: {} },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
  },
});
