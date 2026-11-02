import fs from 'node:fs';
import path from 'node:path';

/**
 * The marketing page is a single, fully art-directed surface. It is authored
 * as one document so the scroll choreography, card stack and hero parallax can
 * be tuned together, then hydrated by the motion layer in
 * `/assets/js/power.js`.
 */
export default function HomePage() {
  const landing = fs.readFileSync(
    path.join(process.cwd(), 'src/content/landing.html'),
    'utf8',
  );

  return <div dangerouslySetInnerHTML={{ __html: landing }} />;
}
