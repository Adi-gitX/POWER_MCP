import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vite searches upward for a PostCSS config and would otherwise pick up an
  // unrelated one from the home directory. The suite processes no CSS.
  css: { postcss: {} },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    // PGlite is a real Postgres, and several suites now start their own
    // instance. Provisioning two database branches genuinely takes seconds, so
    // the 5s default made that test pass or fail on machine load rather than
    // on whether the code works.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Each PGlite instance carries its own WASM Postgres, and several suites
    // start more than one. Run two files at a time rather than one per core:
    // unbounded parallelism was being killed outright by the OOM killer on a
    // laptop, which looks exactly like a failing test and is not one.
    pool: 'forks',
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
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
