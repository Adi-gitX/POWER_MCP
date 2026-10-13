/**
 * Runs the parts of the suite that only mean something against real Postgres.
 *
 * Power's tenant isolation is three mutually exclusive row-level security
 * policies. Every test of them so far has run on PGlite, which is a different
 * implementation of the same protocol and never exercises the connection-level
 * `role` parameter the production path depends on. This is the gap between
 * "the policies are tested" and "the policies work where they are deployed".
 *
 *   POWER_TEST_DATABASE_URL='postgres://…?sslmode=require' pnpm test:postgres
 *
 * Point it at a throwaway database. The suite creates roles and tables.
 */
import { spawn } from 'node:child_process';

const url = process.env.POWER_TEST_DATABASE_URL;
if (!url) {
  console.error(
    [
      'POWER_TEST_DATABASE_URL is not set, so there is nothing to test against.',
      '',
      'Create a throwaway Postgres database -- Neon’s free tier is enough -- and:',
      '',
      "  POWER_TEST_DATABASE_URL='postgres://user:pass@host/db?sslmode=require' pnpm test:postgres",
      '',
      'Do not point this at anything you care about: it creates roles and tables.',
    ].join('\n'),
  );
  process.exit(1);
}

// Refuse the obvious mistake rather than discovering it afterwards.
if (/\bpower\b(?!_test)/.test(new URL(url).pathname)) {
  console.error(
    `Refusing to run: the database in that URL is named "${new URL(url).pathname.slice(1)}",\n` +
      'which looks like a real one. Use a throwaway database.',
  );
  process.exit(1);
}

const SUITES = ['apps/mcp-server/src/infra.test.ts', 'apps/mcp-server/src/secrets-pg.test.ts'];

console.log(`Running against ${new URL(url).host}\n`);
const child = spawn('pnpm', ['vitest', 'run', ...SUITES], {
  stdio: 'inherit',
  env: process.env,
});
child.on('exit', (code) => {
  if (code === 0) {
    console.log('\nThe isolation suite passed against real Postgres. Safe to deploy.');
  } else {
    console.error('\nDo not deploy. Tenant isolation did not hold against real Postgres.');
  }
  process.exit(code ?? 1);
});
