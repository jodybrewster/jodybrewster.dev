/**
 * Telegram webhook: Jody's replies to the turns /api/chat sends him.
 *
 * A reply must quote the message it answers. That message id maps back to the
 * visitor's conversation (src/lib/operator.ts), and the reply is added there as
 * a turn from Jody, which the dock picks up from /api/replies. A bare message
 * names no visitor, so it is refused rather than guessed at.
 *
 * Everything past the secret-token check answers 200. Telegram redelivers any
 * non-2xx update, and a redelivered reply would show up twice in a visitor's
 * chat, so failures are swallowed here and reported to Jody in the bot instead.
 */
import type { APIRoute } from 'astro';
import { env } from '../../lib/env';
import { flags } from '../../lib/flags';
import { appendReply, appendTurn } from '../../lib/conversation';
import { audit, ref } from '../../lib/audit';
import { isCanonicalHost } from '../../lib/origin';
import { LIVE_WINDOW_MS, goLive, resolveTelegramMessage, takeHeld } from '../../lib/operator';
import { logEntries } from '../../lib/transcripts';
import {
  isOwnerUpdate, parseCommand, sanitizeForTelegram, sendNotice, type TelegramMessage,
} from '../../lib/telegram';

export const prerender = false;

/** A reply is read in the dock, not a letter. */
export const REPLY_MAX = 2000;

const HELP = [
  'Each question someone asks Verso arrives here with its answer.',
  'Swipe right on one and reply to answer them in the chat. Your reply appears as you, not as Verso, if they still have the page open.',
  `After you reply, Verso waits ${LIVE_WINDOW_MS / 60_000} min before answering their next question, so you can keep talking. Each reply restarts the wait.`,
  'Replies work for 24 hours after their last message.',
].join('\n\n');

const ack = () => new Response(JSON.stringify({ ok: true }), {
  status: 200, headers: { 'Content-Type': 'application/json' },
});

/** Unconfigured means the endpoint does not exist, rather than exists and refuses. */
const notFound = () => new Response('Not found', { status: 404 });

async function deliverReply(msg: TelegramMessage, text: string): Promise<void> {
  const quoted = msg.reply_to_message?.message_id;
  if (typeof quoted !== 'number') {
    await sendNotice('Swipe right on a question and reply to that. Nothing sent.');
    return;
  }
  const target = await resolveTelegramMessage(quoted);
  if (!target) {
    await sendNotice('That conversation has expired, or that message was not a question. Nothing sent.');
    return;
  }
  const reply = sanitizeForTelegram(text, REPLY_MAX);
  // A question held for him is answered by this reply, so it joins the thread first.
  const held = await takeHeld(target.cid);
  if (held) await appendTurn(target.cid, { r: 'u', t: held.q, ts: held.ts });
  if (!await appendReply(target.cid, reply, held?.q ?? target.q)) {
    await sendNotice('Your reply could not be saved. Nothing sent. Try again.');
    return;
  }
  await logEntries(target.cid, [{ r: 'j', t: reply, ts: Date.now() }]);
  const live = await goLive(target.cid);
  // Jody speaking as himself in a visitor's chat: anchored on Telegram at once.
  await audit({ action: 'operator.reply', outcome: 'allow', actor: { userId: 'jody' }, target: { kind: 'conversation', id: ref(target.cid) } }, { anchor: true });
  await sendNotice(live
    ? `Sent. It shows in their chat if the page is still open. Verso waits ${LIVE_WINDOW_MS / 60_000} min for anything else before it answers again.`
    : 'Sent. It shows in their chat if the page is still open.');
}

export const POST: APIRoute = async ({ request }) => {
  if (!flags.chat || !isCanonicalHost(request)) return notFound();
  const secret = env('TELEGRAM_WEBHOOK_SECRET');
  if (!secret) return notFound();
  // The one place a non-2xx is safe: this is not Telegram calling.
  if (request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    let update: { message?: unknown };
    try { update = await request.json() as { message?: unknown }; } catch { return ack(); }

    // Only fresh messages. An edited_message would post a reply twice.
    const raw = update?.message;
    if (!raw || typeof raw !== 'object') return ack();
    const msg = raw as TelegramMessage;

    // Wrong sender or a group chat: silence, so the endpoint confirms nothing.
    if (!isOwnerUpdate(msg, env('TELEGRAM_OWNER_ID'))) return ack();

    const command = parseCommand(msg.text);
    if (command) {
      await sendNotice(HELP);
      return ack();
    }
    const text = typeof msg.text === 'string' ? msg.text.trim() : '';
    if (!text) {
      await sendNotice('Text only. Nothing sent.');
      return ack();
    }
    await deliverReply(msg, text);
    return ack();
  } catch (err) {
    console.error('[telegram] webhook failed', err instanceof Error ? err.name : 'Error');
    return ack();
  }
};

export const GET: APIRoute = () => new Response('Telegram webhook. POST only.', {
  status: 405, headers: { 'Content-Type': 'text/plain', Allow: 'POST' },
});
