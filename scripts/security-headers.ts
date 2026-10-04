/**
 * Adds the security headers to the build (M1 1.9, site step S6), run by
 * `postbuild` after Astro writes .vercel/output.
 *
 * Vercel serves the adapter's Build Output (.vercel/output/config.json) and
 * applies neither vercel.json headers nor any route after the "filesystem"
 * step to static files, so the headers go in as one route at the top of
 * config.json, ahead of everything, for every path.
 *
 * The Content Security Policy is the preset's (src/lib/security.ts) with
 * scripts allowed by origin and by the SHA-256 of every inline script in
 * the built HTML (all pages share one policy, so the client router's page
 * swaps never meet a different one); styles allow 'unsafe-inline' because
 * the pages use style attributes, which styles cannot turn into script.
 * The build fails on an inline event handler, which would need
 * 'unsafe-hashes'.
 *
 * For the same reason (Vercel reads the adapter's config.json, not
 * vercel.json, for this site) it copies vercel.json's `crons` into
 * config.json, so the daily audit anchor runs.
 *
 *   tsx scripts/security-headers.ts [--check]   # --check: report, change nothing
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { astroCspDirectives, astroScriptResources, vercelHeaders } from '@jodybrewster/gemini-live/server/headers';
import { SECURITY } from '../src/lib/security';

const OUTPUT = '.vercel/output';
const STATIC = join(OUTPUT, 'static');
const CONFIG = join(OUTPUT, 'config.json');
const MARK = 'content-security-policy';

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? htmlFiles(path) : name.endsWith('.html') ? [path] : [];
  });
}

const EXECUTABLE = /^(|text\/javascript|application\/javascript|module)$/i;

/** The hashes of a page's inline scripts, and its inline event handlers. */
export function scanHtml(html: string): { hashes: string[]; handlers: string[] } {
  const hashes: string[] = [];
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1] ?? '';
    if (!EXECUTABLE.test(type)) continue; // data blocks (application/ld+json) never run
    hashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  const handlers = [...html.matchAll(/<[a-z][^>]*\s(on[a-z]+)\s*=/gi)].map(m => m[1]);
  return { hashes, handlers };
}

/** The headers for every response, given the inline scripts' hashes. */
export function securityHeaders(hashes: Iterable<string>): Record<string, string> {
  const policy = [
    ...astroCspDirectives(SECURITY),
    `script-src ${[...astroScriptResources(SECURITY), ...[...new Set(hashes)].sort()].join(' ')}`,
    `style-src 'self' 'unsafe-inline' ${(SECURITY.style ?? []).join(' ')}`.trim(),
    "frame-ancestors 'none'",
  ].join('; ');
  const out: Record<string, string> = {};
  for (const { key, value } of vercelHeaders(SECURITY).headers) out[key.toLowerCase()] = value;
  out[MARK] = policy;
  return out;
}

function main(): void {
  const check = process.argv.includes('--check');
  const hashes = new Set<string>();
  const handlers: string[] = [];
  for (const file of htmlFiles(STATIC)) {
    const scan = scanHtml(readFileSync(file, 'utf8'));
    scan.hashes.forEach(h => hashes.add(h));
    handlers.push(...scan.handlers.map(h => `${file.slice(STATIC.length + 1)}: ${h}`));
  }
  if (handlers.length) {
    console.error(`Inline event handlers need 'unsafe-hashes'; move them into scripts:\n${handlers.join('\n')}`);
    process.exit(1);
  }
  const headers = securityHeaders(hashes);
  console.log(`security headers: ${hashes.size} inline script hashes, policy ${headers[MARK].length} characters`);
  if (check) return;
  const config = JSON.parse(readFileSync(CONFIG, 'utf8')) as { routes?: Array<Record<string, unknown>>; crons?: Array<{ path: string; schedule: string }> };
  const crons = (JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons?: Array<{ path: string; schedule: string }> }).crons ?? [];
  if (crons.length) config.crons = crons;
  // Re-runnable: replace a route this script added before.
  const routes = (config.routes ?? []).filter(r => !(r.headers && MARK in (r.headers as Record<string, string>)));
  config.routes = [{ src: '^/(.*)$', headers, continue: true }, ...routes];
  writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`);
}

if (process.argv[1]?.endsWith('security-headers.ts')) main();
