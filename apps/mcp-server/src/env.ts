/**
 * Local settings from `.env`, loaded before anything reads `process.env`.
 *
 * Imported first by index.ts, so it runs before every other module's top
 * level. The repository root's file is read, then the server package's own;
 * a variable already in the environment always wins, so a deployment's real
 * configuration is never overridden by a stray file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const files = ['../../../.env', '../.env'].map((p) => fileURLToPath(new URL(p, import.meta.url)));

for (const file of files) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trimStart().startsWith('#')) continue;
    const [, name, raw] = match as unknown as [string, string, string];
    if (process.env[name] !== undefined) continue;
    const quoted = /^(['"])(.*)\1$/.exec(raw);
    process.env[name] = quoted ? quoted[2]! : raw.replace(/\s+#.*$/, '');
  }
}
