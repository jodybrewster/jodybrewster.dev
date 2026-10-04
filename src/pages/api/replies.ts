/**
 * Jody's replies in one conversation, for the dock to show.
 *
 * The conversation id is an unguessable UUID held in the visitor's
 * sessionStorage, and it is the whole of the authorization: the same id
 * already lets its holder continue the conversation through /api/chat. Only
 * Jody's turns and whether he is live come back, never the transcript.
 */
import type { APIRoute } from 'astro';
import { flags } from '../../lib/flags';
import { isValidConversationId } from '../../lib/verso';
import { readReplies } from '../../lib/conversation';
import { liveUntil } from '../../lib/operator';
import { check, repliesLimiter, visitor } from '../../lib/limits';

export const prerender = false;

export const GET: APIRoute = async ({ url, request }) => {
  if (!flags.chat) return new Response('Not found', { status: 404 });
  const cid = url.searchParams.get('cid');
  if (!isValidConversationId(cid)) return new Response('cid required', { status: 400 });
  // Polling is cheap but not free (two Redis reads): 60 a minute per IP
  // covers a few tabs polling every 3 s while Jody is live.
  const decision = await check(repliesLimiter, visitor(request));
  if (!decision.ok) {
    const status = decision.code === 'unavailable' ? 503 : 429;
    return new Response(status === 503 ? 'Temporarily unavailable.' : 'Too many requests.', {
      status, headers: { 'Retry-After': String(decision.retryAfterSeconds), 'Cache-Control': 'no-store' },
    });
  }
  const [replies, live] = await Promise.all([readReplies(cid), liveUntil(cid)]);
  // `liveUntil` tells the dock Jody is in the conversation, and until when.
  return new Response(JSON.stringify({ replies, liveUntil: live }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
