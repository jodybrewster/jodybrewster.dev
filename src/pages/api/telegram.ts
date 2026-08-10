/**
 * Telegram webhook: the return path of the chat handoff.
 *
 * /api/chat pushes a visitor's question to the owner's phone and parks the SSE
 * response for HANDOFF_WINDOW_MS. His reply lands here. Both sides then call
 * `claim(mid, ...)`, an atomic SET NX, so a reply arriving on the 40th second
 * either wins the visitor's answer outright or loses cleanly to the model.
 * Never both.
 *
 * Everything past the secret-token check answers 200. Telegram redelivers any
 * non-2xx update, and a redelivered reply is a second answer to a visitor who
 * already got one, so a failure here has to be swallowed rather than reported.
 */
import type { APIRoute } from 'astro';
import { env } from '../../lib/env';
import { flags } from '../../lib/flags';
import { getGlobalLimiter } from '../../lib/rate-limit';
import {
  claim,
  getFinal,
  getLastQuestion,
  isOperatorOnline,
  presenceTtlSeconds,
  putReply,
  resolveTelegramMessage,
  setPresence,
  HANDOFF_WINDOW_MS,
  PRESENCE_TTL_S,
} from '../../lib/handoff';
import {
  isOwnerUpdate,
  parseCommand,
  sanitizeForTelegram,
  sendNotice,
  type TelegramMessage,
} from '../../lib/telegram';

export const prerender = false;

/** Enough of the model's answer for the owner to recognize what the visitor
 *  actually saw, short enough to stay a single glance on a phone. */
const FINAL_PREVIEW_CHARS = 120;

const PRESENCE_HOURS = Math.round(PRESENCE_TTL_S / 3600);
const WINDOW_SECONDS = Math.round(HANDOFF_WINDOW_MS / 1000);

const COMMAND_LIST = [
  `/on - take questions here for ${PRESENCE_HOURS}h`,
  '/off - hand them back to the model',
  '/status - presence, time left, model budget',
  '/help - this list',
].join('\n');

/**
 * The only response this route gives once a caller has proved it is Telegram.
 * See the header: a non-2xx buys a duplicate answer, not a retry that helps.
 */
function ack(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Unconfigured or flagged off means the endpoint does not exist, rather than
 *  exists and refuses. Nothing to probe. */
function notFound(): Response {
  return new Response('Not found', { status: 404 });
}

/** Redis is optional, so a status read must degrade rather than eat the reply. */
async function budgetLine(): Promise<string> {
  const limiter = getGlobalLimiter();
  if (!limiter) return 'Model budget: unavailable (no Redis).';
  try {
    const { remaining, limit } = await limiter.getRemaining('global');
    return `Model budget: ${remaining} of ${limit} left today.`;
  } catch (err) {
    console.error('[telegram] budget read failed', err);
    return 'Model budget: unavailable.';
  }
}

async function statusMessage(): Promise<string> {
  const online = await isOperatorOnline();
  const ttl = await presenceTtlSeconds();
  const presence = online
    ? `Handoff ON. ${Math.ceil(ttl / 60)}m left.`
    : 'Handoff OFF. Verso answers from the corpus.';
  return `${presence}\n${await budgetLine()}`;
}

/**
 * A reply typed by the owner, on its way to whoever asked.
 *
 * The target is normally the quoted question. Quick-reply from the notification
 * shade does not carry `reply_to_message` on every platform, so a bare reply
 * falls back to the newest outstanding question - the one he almost certainly
 * meant.
 */
async function deliverReply(msg: TelegramMessage, text: string): Promise<void> {
  const quoted = msg.reply_to_message?.message_id;
  const mid =
    (typeof quoted === 'number' ? await resolveTelegramMessage(quoted) : null) ??
    (await getLastQuestion());

  if (!mid) {
    await sendNotice('That question expired (older than an hour). Nothing sent.');
    return;
  }

  if (await claim(mid, 'human')) {
    await putReply(mid, text);
    await sendNotice('Sent as Verso.');
    return;
  }

  // Lost the race: the window closed and the model already answered. The
  // visitor's request is gone, so this reply is deliberately dropped rather
  // than delivered. Known v2 gap - a late reply could be appended to the
  // conversation and pushed to a still-open client.
  const final = await getFinal(mid);
  const preview = sanitizeForTelegram(
    String(final?.text ?? '').replace(/\s+/g, ' ').trim(),
    FINAL_PREVIEW_CHARS,
  );
  const tail = preview ? `\n\nVerso said: "${preview}"` : '';
  await sendNotice(`Too late - Verso answered from the corpus. Not sent.${tail}`);
}

export const POST: APIRoute = async ({ request }) => {
  if (!flags.chat) return notFound();

  const secret = env('TELEGRAM_WEBHOOK_SECRET');
  if (!secret) return notFound();

  // The one place a non-2xx is safe: this is not Telegram calling, so there is
  // no delivery to retry and nothing to duplicate.
  if (request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    let update: { message?: unknown };
    try {
      update = (await request.json()) as { message?: unknown };
    } catch {
      return ack();
    }

    // Only fresh messages. An edited_message would resend an already-answered
    // question, and channel_post / callback_query have no reply semantics here.
    const raw = update?.message;
    if (!raw || typeof raw !== 'object') return ack();
    const msg = raw as TelegramMessage;

    // Wrong sender, or a group chat the bot was added to. Answering either one
    // would confirm the endpoint is live, so it gets silence.
    if (!isOwnerUpdate(msg, env('TELEGRAM_OWNER_ID'))) return ack();

    const text = typeof msg.text === 'string' ? msg.text.trim() : '';

    switch (parseCommand(msg.text)) {
      case 'start':
        await sendNotice(`Verso handoff wired up. You are the operator.\n\n${COMMAND_LIST}`);
        return ack();

      case 'on':
        await setPresence(true);
        await sendNotice(
          `Handoff ON for ${PRESENCE_HOURS}h. Questions arrive here; unanswered ones fall to the model after ${WINDOW_SECONDS}s.\n` +
            'Verso talks about Jody in the third person. Write "Jody built that", never "I built that".',
        );
        return ack();

      case 'off':
        await setPresence(false);
        await sendNotice('Handoff OFF. Verso answers from the corpus.');
        return ack();

      case 'status':
        await sendNotice(await statusMessage());
        return ack();

      case 'help':
        await sendNotice(COMMAND_LIST);
        return ack();

      default:
        // A sticker or a photo has nothing to forward. Say so, because silence
        // on this bot otherwise means "sent".
        if (!text) {
          await sendNotice('Text only. Nothing sent.');
          return ack();
        }
        await deliverReply(msg, text);
        return ack();
    }
  } catch (err) {
    console.error('[telegram] webhook failed', err);
    return ack();
  }
};

export const GET: APIRoute = () =>
  new Response('Telegram webhook. POST only.', {
    status: 405,
    headers: { 'Content-Type': 'text/plain', Allow: 'POST' },
  });
