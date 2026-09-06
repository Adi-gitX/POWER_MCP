/**
 * One layout for every page. Plain HTML strings, no framework: the site is
 * twelve pages that change rarely, and a build that cannot break is worth more
 * than a build that can do anything.
 */
export const SITE = {
  name: 'Power',
  tagline: 'The AI can’t mark its own homework.',
  tag: 'Ship it checked.',
  url: process.env.SITE_URL ?? 'https://power.build',
  mcp: 'https://mcp.power.build/mcp',
  github: 'https://github.com/Adi-gitX/power',
  email: 'hello@power.build',
};

export interface Page {
  path: string; // e.g. 'pricing' or 'docs/how-it-works'
  title: string;
  description: string;
  body: string;
  /** Extra <head> markup. */
  head?: string;
}

/** The gate mark: a square with a slit. The slit takes the signal colour only while something passes. */
export const MARK = `<svg class="mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="2.5" y="2.5" width="19" height="19" rx="4" fill="none" stroke="currentColor" stroke-width="1.6"/><rect class="slit" x="7" y="11" width="10" height="2" rx="1"/></svg>`;

const NAV = [
  ['/pricing', 'Pricing'],
  ['/docs', 'Docs'],
  ['/proof', 'Proof'],
] as const;

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function render(page: Page, depth: number): string {
  const rel = depth === 0 ? './' : '../'.repeat(depth);
  // Section roots ('/docs') are directories with an index page.
  const href = (p: string) => {
    if (p === '/') return `${rel}index.html`;
    const clean = p.replace(/^\//, '');
    return `${rel}${clean === 'docs' ? 'docs/index' : clean}.html`;
  };
  const current = '/' + page.path.replace(/\/index$/, '').replace(/^index$/, '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)} · ${SITE.name}</title>
<meta name="description" content="${esc(page.description)}">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE.name}">
<meta property="og:image" content="${SITE.url}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#2b73eb">
<link rel="icon" href="${rel}favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${rel}styles.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.13.0/gsap.min.js" defer></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.13.0/ScrollTrigger.min.js" defer></script>
<script src="https://cdn.jsdelivr.net/npm/lenis@1.3.4/dist/lenis.min.js" defer></script>
<script src="${rel}js/motion.js" defer></script>
${page.head ?? ''}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="wrap row">
    <a class="brand" href="${href('/')}">${MARK}<span class="name">${SITE.name}</span></a>
    <nav aria-label="Main">
      ${NAV.map(([p, label]) => `<a href="${href(p)}"${current === p || current.startsWith(p + '/') ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
      <a class="ghost" href="${SITE.github}">Source</a>
      <a class="btn outline small" href="${href('/docs/getting-started')}">Connect</a>
    </nav>
  </div>
</header>
<main id="main">
${page.body}
</main>
<footer class="foot">
  <div class="wrap cols">
    <div>
      <a class="brand" href="${href('/')}">${MARK}<span class="name">${SITE.name}</span></a>
      <p class="muted" style="margin:.6rem 0 0;max-width:34ch">${SITE.tagline}</p>
    </div>
    <div><h4>Product</h4><a href="${href('/pricing')}">Pricing</a><a href="${href('/proof')}">Proof</a><a href="${href('/docs/tools')}">Tool reference</a><a href="${href('/docs/export')}">Export &amp; self-hosting</a></div>
    <div><h4>Docs</h4><a href="${href('/docs/getting-started')}">Getting started</a><a href="${href('/docs/how-it-works')}">How it works</a><a href="${href('/docs/data')}">Data &amp; migrations</a><a href="${href('/docs/security')}">Security &amp; data</a></div>
    <div><h4>Company</h4><a href="${SITE.github}">Source</a><a href="mailto:${SITE.email}">${SITE.email}</a><a href="${href('/docs/faq')}">FAQ</a></div>
  </div>
  <div class="wrap fine"><span>© ${new Date().getFullYear()} ${SITE.name}</span><span>Bring your own model. Keep your own code.</span></div>
</footer>
</body>
</html>`;
}
