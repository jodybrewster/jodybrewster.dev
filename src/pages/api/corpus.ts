import type { APIRoute } from 'astro';
import { searchVectors, getChunkText } from '../../lib/rag';
import { isCanonicalHost, isOriginAllowed, otherHost } from '../../lib/origin';
import { check, corpusLimiter, visitor } from '../../lib/limits';
import { isOn, SEARCH_OFF } from '../../lib/switches';
import { getRedis } from '../../lib/redis';
import { MAX_QUERY_LEN } from '../../lib/verso';
import { env } from '../../lib/env';
import { flags } from '../../lib/flags';
import { withDeadline } from '../../lib/deadline';

export const prerender = false;
/**
 * Retrieval without the model: the voice session's `search_site` tool. It
 * returns the same excerpts /api/chat grounds on, with slugs and urls, so a
 * spoken answer can cite and show cards for exactly what was found.
 */
const RESULTS = 5;
const TEXT_MAX = 1200;
const UNAVAILABLE = 'Search is temporarily unavailable. Try again shortly.';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export const POST: APIRoute = async ({ request }) => {
  if (!flags.chat) return new Response('Not found', { status: 404 });
  if (!isCanonicalHost(request)) return otherHost();
  if (!(await isOn('tool:search_site'))) return new Response(SEARCH_OFF, { status: 503, headers: { 'X-Switched-Off': 'tool:search_site', 'Cache-Control': 'no-store' } });
  const started = Date.now();
  let body: unknown;
  try { body = await withDeadline(() => request.json(), 4000, request.signal); }
  catch { return new Response('Invalid JSON', { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      typeof (body as { query?: unknown }).query !== 'string') {
    return new Response('query must be a string', { status: 400 });
  }
  const query = (body as { query: string }).query.trim();
  if (!query) return new Response('query required', { status: 400 });
  if (query.length > MAX_QUERY_LEN) return new Response(`query too long (max ${MAX_QUERY_LEN} chars)`, { status: 413 });
  if (!isOriginAllowed(request)) return new Response('Forbidden', { status: 403 });
  if (!getRedis() && env('VERCEL_ENV') === 'production') return new Response(UNAVAILABLE, { status: 503 });
  // Stage and timing only: the query is a visitor's words.
  const log = (stage: string, status: string) => console.info('[corpus]', { stage, status, elapsedMs: Date.now() - started });
  try {
    const denied = await withDeadline(async signal => {
      const decision = await check(corpusLimiter, visitor(request));
      signal.throwIfAborted();
      if (decision.ok) return null;
      if (decision.code === 'unavailable') return new Response(UNAVAILABLE, { status: 503 });
      return new Response('Rate limit exceeded. Try again in a minute.', { status: 429 });
    }, 4000, request.signal);
    if (denied) return denied;
  } catch {
    log('setup', 'unavailable');
    return new Response(UNAVAILABLE, { status: 503 });
  }
  try {
    const results = await withDeadline(async signal => {
      // Over-fetch: several chunks of one long piece would otherwise crowd out the rest.
      const hits = await searchVectors(query, RESULTS * 2, undefined, signal);
      const seen = new Set<string>();
      const unique = hits.filter(hit => {
        const key = `${hit.metadata.type}:${hit.metadata.slug}`;
        if (seen.has(key)) return false; seen.add(key); return true;
      }).slice(0, RESULTS);
      const texts = await Promise.all(unique.map(hit => getChunkText(hit.metadata).catch(() => '')));
      signal.throwIfAborted();
      return unique.flatMap(({ metadata: m }, i) => texts[i] ? [{
        type: m.type, slug: m.slug, title: m.title, url: m.url,
        text: texts[i].length > TEXT_MAX ? `${texts[i].slice(0, TEXT_MAX).replace(/\s+\S*$/, '')}...` : texts[i],
      }] : []);
    }, 15_000, request.signal);
    log('search', 'complete');
    return json({ results });
  } catch {
    log('search', request.signal.aborted ? 'disconnected' : 'failed');
    return new Response(UNAVAILABLE, { status: 503 });
  }
};
