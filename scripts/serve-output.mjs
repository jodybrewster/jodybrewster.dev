/**
 * Serves the built site (.vercel/output/static) the way Vercel does for the
 * security header specs (playwright.headers.config.ts): the routes in
 * .vercel/output/config.json up to the "filesystem" step run first (header
 * routes add headers and continue; redirects answer), then the file. No
 * functions: the specs mock every /api route in the browser. GET /__served
 * lists the paths served so far, so a spec can see requests a browser does
 * not report to the page (audio worklets in Chromium). Test-only.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = '.vercel/output/static';
const PORT = Number(process.env.PORT ?? 4394);
const config = JSON.parse(readFileSync('.vercel/output/config.json', 'utf8'));
const before = [];
for (const route of config.routes ?? []) {
  if (route.handle === 'filesystem') break;
  if (route.src) before.push({ ...route, re: new RegExp(route.src) });
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.pdf': 'application/pdf', '.txt': 'text/plain', '.xml': 'application/xml', '.md': 'text/markdown', '.pagefind': 'application/octet-stream', '.pf_meta': 'application/octet-stream', '.pf_index': 'application/octet-stream', '.pf_fragment': 'application/octet-stream' };

function file(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  for (const candidate of [clean, `${clean}.html`, join(clean, 'index.html')]) {
    const path = join(ROOT, candidate);
    if (path.startsWith(ROOT) && existsSync(path) && statSync(path).isFile()) return path;
  }
  return null;
}

const served = [];

createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/__served') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(served));
  }
  served.push(pathname);
  for (const route of before) {
    if (!route.re.test(pathname)) continue;
    for (const [k, v] of Object.entries(route.headers ?? {})) res.setHeader(k, v);
    if (route.status) { res.writeHead(route.status); return res.end(); }
    if (!route.continue) break;
  }
  const path = file(pathname);
  if (!path) {
    const notFound = join(ROOT, '404.html');
    res.writeHead(404, { 'content-type': TYPES['.html'] });
    return res.end(existsSync(notFound) ? readFileSync(notFound) : 'Not found');
  }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
  res.end(readFileSync(path));
}).listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}`));
