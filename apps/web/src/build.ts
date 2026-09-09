/**
 * Build the site into dist/. Also checks every internal link resolves, so a
 * renamed page cannot ship a dead link.
 */
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE, render, type Page } from './layout.js';
import { docs } from './pages/docs.js';
import { home } from './pages/home.js';
import { pricing } from './pages/pricing.js';
import { proof } from './pages/proof.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'dist');
const pub = join(here, '..', 'public');

const pages: Page[] = [home, pricing, proof, ...docs];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(pub, out, { recursive: true });

for (const page of pages) {
  const depth = page.path.split('/').length - 1;
  const file = join(out, `${page.path}.html`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, render(page, depth));
}

await writeFile(
  join(out, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#2b73eb"/><rect x="7.5" y="7.5" width="17" height="17" rx="4" fill="none" stroke="#fff" stroke-width="1.8"/><rect x="11" y="15" width="10" height="2" rx="1" fill="#a7f3d0"/></svg>`,
);
await writeFile(
  join(out, '404.html'),
  render({ path: '404', title: 'Not found', description: '', body: `<section><div class="wrap"><h1>Not found</h1><p class="muted">That page does not exist. <a href="index.html">Home</a>.</p></div></section>` }, 0),
);
await writeFile(
  join(out, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .map((p) => `  <url><loc>${SITE.url}/${p.path === 'index' ? '' : p.path.replace(/\/index$/, '/')}</loc></url>`)
    .join('\n')}\n</urlset>\n`,
);
await writeFile(join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE.url}/sitemap.xml\n`);

// ---- link check
const files = new Set<string>();
const walk = async (dir: string, prefix = ''): Promise<void> => {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) await walk(join(dir, e.name), `${prefix}${e.name}/`);
    else files.add(`${prefix}${e.name}`);
  }
};
await walk(out);

let broken = 0;
for (const page of pages) {
  const html = await readFile(join(out, `${page.path}.html`), 'utf8');
  const base = dirname(page.path);
  for (const m of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    const url = m[1]!;
    if (/^(https?:|mailto:|data:)/.test(url)) continue;
    const parts = (base === '.' ? [] : base.split('/')).concat(url.split('/'));
    const resolved: string[] = [];
    for (const p of parts) {
      if (p === '..') resolved.pop();
      else if (p !== '.' && p !== '') resolved.push(p);
    }
    const target = resolved.join('/');
    if (!files.has(target)) {
      broken++;
      console.error(`broken link in ${page.path}.html → ${url} (resolved ${target})`);
    }
  }
}
if (broken) {
  console.error(`${broken} broken link(s)`);
  process.exit(1);
}
console.log(`built ${pages.length} pages → ${out} (${files.size} files, all internal links resolve)`);
