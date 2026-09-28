import type { APIRoute } from 'astro';
import { buildCardIndex } from '../lib/cards';

/**
 * Everything Verso can show as a card, as one static file. The voice session
 * fetches it once and resolves its tool calls in the browser, the same way
 * /api/chat resolves them on the server. Page text rides along so a quote can
 * be checked against the page before it is shown.
 */
export const prerender = true;
export const GET: APIRoute = async () => new Response(JSON.stringify(await buildCardIndex()), {
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
});
