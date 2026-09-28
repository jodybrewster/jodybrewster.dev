/**
 * Jody's replies in one conversation, for the dock to show.
 *
 * The conversation id is an unguessable UUID held in the visitor's
 * sessionStorage, and it is the whole of the authorization: the same id
 * already lets its holder continue the conversation through /api/chat. Only
 * Jody's turns come back, never the transcript.
 */
import type { APIRoute } from 'astro';
import { flags } from '../../lib/flags';
import { isValidConversationId } from '../../lib/verso';
import { readReplies } from '../../lib/conversation';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  if (!flags.chat) return new Response('Not found', { status: 404 });
  const cid = url.searchParams.get('cid');
  if (!isValidConversationId(cid)) return new Response('cid required', { status: 400 });
  const replies = await readReplies(cid);
  return new Response(JSON.stringify({ replies }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
