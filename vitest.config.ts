import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vite searches upward for a PostCSS config and would otherwise pick up an
  // unrelated one from the home directory. The suite processes no CSS.
  css: { postcss: {} },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    // `.power-local` is the local sandbox: every generated project lives there
    // with its own app.test.ts and leak.test.ts. Those belong to the apps the
    // server built, not to this repo, and without this exclude the suite grows
    // by four files on every e2e run and `pnpm check` stops being repeatable.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      '**/.power-local/**',
    ],
  },
});
