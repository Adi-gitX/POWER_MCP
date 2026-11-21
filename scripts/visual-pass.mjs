/**
 * Captures the six product surfaces at desktop and phone widths.
 *
 *   pnpm dev:site            # http://localhost:4000
 *   PORT=4321 pnpm dev       # http://localhost:4321
 *   pnpm visual
 *
 * The dashboard is captured while signed in. There is no checked-in cookie and
 * no /tmp state file: the script signs in through the development login that
 * `pnpm dev` enables on loopback, then signs that session out when it is done.
 * That means the app server must be the one `pnpm dev` starts, with
 * POWER_DEV_LOGIN=1, rather than `pnpm start`. The first run creates the
 * visual-pass account if the dev database does not have it yet.
 *
 * playwright-core drives the Chrome already installed on the machine, so no
 * browser download is needed. Override the origin or the account with
 * POWER_VISUAL_SITE_URL, POWER_VISUAL_APP_URL, POWER_VISUAL_EMAIL, or the output
 * directory with POWER_VISUAL_DIR. Set POWER_VISUAL_HEADED=1 to watch it run.
 */
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const SITE = (process.env.POWER_VISUAL_SITE_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const APP = (process.env.POWER_VISUAL_APP_URL ?? 'http://localhost:4321').replace(/\/+$/, '');
const OUT = resolve(process.env.POWER_VISUAL_DIR ?? 'screenshots');
const EMAIL = process.env.POWER_VISUAL_EMAIL ?? 'visual-pass@example.com';
const HEADED = process.env.POWER_VISUAL_HEADED === '1';

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];

/** The five public screens. The dashboard is added after signing in. */
const SURFACES = [
  { name: 'landing', path: '/' },
  { name: 'pricing', path: '/pricing/' },
  { name: 'docs', path: '/docs/' },
  { name: 'app', path: '/app/' },
  { name: 'login', path: '/login/' },
];

async function up(url) {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(2500) });
    return response.status < 500;
  } catch {
    return false;
  }
}

/**
 * Load, let webfonts and reveal-on-scroll settle, then return to the top.
 * Reduced motion is set on every context, so the wait is for layout rather
 * than for an animation to finish.
 */
async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await document.fonts.ready;
    const height = document.body.scrollHeight;
    for (let y = 0; y < height; y += 600) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 35));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(2400);
}

async function main() {
  const [siteUp, appUp] = await Promise.all([up(`${SITE}/`), up(`${APP}/login`)]);
  if (!siteUp || !appUp) {
    console.error(
      [
        'The visual pass needs both dev servers running:',
        '',
        `  pnpm dev:site          # ${SITE}`,
        `  PORT=4321 pnpm dev     # ${APP}`,
        '',
        siteUp ? '  site:      up' : '  site:      not answering',
        appUp ? '  dashboard: up' : '  dashboard: not answering',
      ].join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: !HEADED });

  try {
    for (const viewport of VIEWPORTS) {
      console.log(`\n${viewport.width}×${viewport.height}`);
      for (const surface of SURFACES) {
        const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
        try {
          const response = await page.goto(SITE + surface.path, { waitUntil: 'networkidle' });
          if (!response || response.status() >= 400) {
            throw new Error(`${surface.name} returned ${response?.status() ?? 'no response'}`);
          }
          await settle(page);
          const file = join(OUT, `${surface.name}-${viewport.width}.png`);
          await page.screenshot({ path: file });
          console.log(`  ${surface.name.padEnd(8)} → ${file}`);
        } finally {
          await page.close();
        }
      }
    }

    // One session, two widths: the dashboard is the only surface that needs it.
    const context = await browser.newContext({ viewport: VIEWPORTS[0], reducedMotion: 'reduce' });
    try {
      const page = await context.newPage();
      const login = await page.goto(
        `${APP}/login/dev?email=${encodeURIComponent(EMAIL)}&next=/`,
        { waitUntil: 'networkidle' },
      );
      const landed = new URL(page.url());
      const content = await page.content();
      if (!login || login.status() === 404 || landed.origin !== new URL(APP).origin) {
        throw new Error(
          [
            `The dashboard at ${APP} has no development login.`,
            'Start it with `PORT=4321 pnpm dev` (POWER_DEV_LOGIN=1), not `pnpm start` or a bare tsx command.',
          ].join('\n'),
        );
      }
      if (!content.includes('Projects')) {
        throw new Error(`The development login did not reach the dashboard (landed on ${page.url()}).`);
      }

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(`${APP}/`, { waitUntil: 'networkidle' });
        await settle(page);
        const file = join(OUT, `dashboard-${viewport.width}.png`);
        await page.screenshot({ path: file });
        console.log(`  dashboard → ${file}`);
      }

      // Leave the dev server as we found it: no session hanging around.
      await page.goto(`${APP}/logout`, { waitUntil: 'networkidle' });
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }

  console.log(`\nCaptured ${SURFACES.length * VIEWPORTS.length + VIEWPORTS.length} screenshots in ${OUT}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
