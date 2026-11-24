// Compiles src/components/ui/otp-input.tsx (through src/embeds/otp-mount.tsx)
// into a standalone bundle and stylesheet for the MCP server's sign-in page.
//
//   pnpm --filter @power/site build:otp
//
// Output goes to apps/mcp-server/assets/otp/, which the server serves at
// /assets/otp/. The files are committed, so the server needs no build step.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(site, '../mcp-server/assets/otp');
await mkdir(out, { recursive: true });

await build({
  entryPoints: [join(site, 'src/embeds/otp-mount.tsx')],
  outfile: join(out, 'otp.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020', 'safari15'],
  jsx: 'automatic',
  tsconfig: join(site, 'tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  logLevel: 'warning',
});

await build({
  entryPoints: [join(site, 'src/embeds/new-app.tsx')],
  outfile: join(out, 'new-app.js'),
  bundle: true, minify: true, format: 'iife', target: ['es2020', 'safari15'], jsx: 'automatic',
  tsconfig: join(site, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'none', logLevel: 'warning',
});
await writeFile(join(out, 'new-app.css'), await readFile(join(site, 'src/embeds/new-app.css'), 'utf8'));

const from = join(site, 'src/embeds/otp.css');
const css = await postcss([tailwind({ base: site, optimize: { minify: true } })]).process(await readFile(from, 'utf8'), { from });
await writeFile(join(out, 'otp.css'), css.css);

const sizes = await Promise.all(['otp.js', 'otp.css'].map(async (f) => `${f} ${((await readFile(join(out, f))).length / 1024).toFixed(1)} KB`));
console.log(`otp bundle  ${sizes.join(' · ')}`);
