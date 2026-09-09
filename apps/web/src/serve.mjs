// The smallest static server, for `pnpm dev`. Production is any static host.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const root = new URL('../dist/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain', '.xml': 'application/xml' };
createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (path.endsWith('/')) path += 'index.html';
  else if (!extname(path)) path += '.html';
  try {
    // Static hosts serve /docs as docs/index.html; do the same here.
    const body = await readFile(join(root, path)).catch(() =>
      extname(path) === '.html' ? readFile(join(root, path.replace(/\.html$/, '/index.html'))) : Promise.reject(new Error('nf')),
    );
    res.writeHead(200, { 'content-type': `${types[extname(path)] ?? 'application/octet-stream'}; charset=utf-8` });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end(await readFile(join(root, '404.html')).catch(() => 'not found'));
  }
}).listen(Number(process.env.PORT ?? 4000), () => console.log(`web  http://localhost:${process.env.PORT ?? 4000}/`));
