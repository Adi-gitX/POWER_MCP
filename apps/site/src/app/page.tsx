import fs from 'node:fs';
import path from 'node:path';
import { SITE } from '@/lib/site';

/**
 * The marketing page is a single, fully art-directed surface. It is authored
 * as one document so the scroll choreography, card stack and hero parallax can
 * be tuned together, then hydrated by the motion layer in
 * `/assets/js/power.js`.
 */
export default function HomePage() {
  // The document is authored as HTML, but the app lives on another origin, so
  // primary calls to action are resolved here rather than hard-coded.
  const landing = fs
    .readFileSync(path.join(process.cwd(), 'src/content/landing.html'), 'utf8')
    .replaceAll('{{APP}}', SITE.app);

  return <div dangerouslySetInnerHTML={{ __html: landing }} />;
}
