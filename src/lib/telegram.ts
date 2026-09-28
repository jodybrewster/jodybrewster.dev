import { env } from './env';
import { withDeadline } from './deadline';

/**
 * Telegram bot client for Verso's operator channel.
 *
 * Each finished question and Verso's answer go to Jody's phone. If he replies
 * to one, the reply is added to that visitor's conversation as a turn from him
 * (src/lib/operator.ts). Verso never waits for him.
 *
 * This module is the transport plus the pure formatting and parsing around it.
 * Nothing here throws. When the bot is not configured every call no-ops.
 *
 * Messages are sent with no parse_mode. Under Markdown an unbalanced `*` in a
 * visitor's question makes Telegram answer 400 and the message disappears;
 * under HTML an `<a href>` is a link injected onto his phone. Plain text parses
 * no entities, so nothing needs escaping.
 */

const API_ROOT = 'https://api.telegram.org';

export type Command = 'start' | 'help';
const COMMANDS: readonly Command[] = ['start', 'help'];

/** The slice of Telegram's Message we read. */
export interface TelegramMessage {
  message_id: number;
  from?: { id: number; is_bot?: boolean };
  chat?: { id: number; type?: string };
  text?: string;
  reply_to_message?: { message_id: number };
}

/** Well inside Telegram's 4096-char limit once the rest of the message is added. */
const QUESTION_MAX = 1500;
const ANSWER_MAX = 1200;

/** C0 and C1 control characters, minus tab and newline. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

/** All three vars or nothing: a half-configured bot reads as unconfigured. */
export function telegramConfigured(): boolean {
  return Boolean(env('TELEGRAM_BOT_TOKEN') && env('TELEGRAM_OWNER_ID'));
}

/**
 * `/help@versodev_bot` -> `help`. Telegram appends the bot name in some clients
 * and phone keyboards capitalize, so the loose forms have to match or a
 * command becomes a reply to a visitor.
 */
export function parseCommand(text: unknown): Command | null {
  if (typeof text !== 'string') return null;
  const [first = ''] = text.trim().split(/\s+/);
  if (!first.startsWith('/')) return null;
  const [word = ''] = first.slice(1).split('@');
  const command = word.toLowerCase();
  return COMMANDS.includes(command as Command) ? (command as Command) : null;
}

/**
 * Prepares visitor or model text for the owner's phone: strips invisible junk
 * and runaway blank lines, and neutralises a leading slash that would let the
 * text read as a bot command. Markdown is deliberately left alone (see above).
 */
export function sanitizeForTelegram(text: unknown, max = QUESTION_MAX): string {
  if (typeof text !== 'string') return '';
  let out = text.replace(CONTROL_CHARS, '').replace(/\n{3,}/g, '\n\n').trim();
  if (out.startsWith('/')) out = ` ${out}`;
  if (out.length > max) out = `${out.slice(0, max - 1)}…`;
  return out;
}

/**
 * One finished turn. The header comes first and only fixed text follows the
 * visitor's words, so a question can append to the message but never reframe
 * what sits above it. A failed turn says so on the first line, since that is
 * the one he most needs to know about.
 */
export function formatTurnMessage(opts: {
  cid: string;
  index: number;
  question: string;
  answer?: string;
  failed?: boolean;
}): string {
  const tag = `Verso · ${String(opts.cid).slice(0, 4)} · q${opts.index}`;
  const header = opts.failed ? `${tag} · no answer` : tag;
  const question = sanitizeForTelegram(opts.question);
  const answer = sanitizeForTelegram(opts.answer, ANSWER_MAX);
  const middle = opts.failed
    ? 'Verso could not answer this one.'
    : `Verso said:\n${answer}`;
  return `${header}\n\n${question}\n\n${middle}\n\nReply to this message to answer them in the chat.`;
}

/**
 * The owner, in his own private chat with the bot. Without the chat-type check
 * anyone who adds the bot to a group could write into a visitor's chat.
 */
export function isOwnerUpdate(msg: unknown, ownerId: string | undefined): boolean {
  if (typeof ownerId !== 'string' || !ownerId.trim()) return false;
  if (!msg || typeof msg !== 'object') return false;
  const { from, chat } = msg as { from?: { id?: unknown }; chat?: { type?: unknown } };
  if (!from || !chat || from.id === undefined || from.id === null) return false;
  // Telegram sends the id as a number, the env var arrives as a string.
  return String(from.id) === ownerId.trim() && chat.type === 'private';
}

/**
 * One POST to the Bot API. Returns `result`, or null on any failure.
 *
 * The failure worth recognizing in the log is `403 bot can't initiate
 * conversation with a user`: the owner has never sent the bot /start.
 */
export async function tgCall<T = unknown>(
  method: string,
  payload: Record<string, unknown>,
  parent?: AbortSignal,
): Promise<T | null> {
  if (!telegramConfigured()) return null;
  const token = env('TELEGRAM_BOT_TOKEN');
  try {
    return await withDeadline(async signal => {
      const res = await fetch(`${API_ROOT}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; result?: T; description?: string }
        | null;
      if (!res.ok || !body?.ok) {
        console.error(`[telegram] ${method} failed`, res.status, body?.description ?? '');
        return null;
      }
      return body.result ?? null;
    }, 5000, parent);
  } catch (err) {
    console.error(`[telegram] ${method} failed`, err instanceof Error ? err.name : 'Error');
    return null;
  }
}

/**
 * Sends a turn and returns its message id, which is how a reply is matched
 * back to the conversation. `force_reply` makes answering one tap on a phone
 * and makes Telegram attach `reply_to_message` to the answer.
 */
export async function sendTurn(text: string, signal?: AbortSignal): Promise<number | null> {
  const result = await tgCall<{ message_id?: number }>('sendMessage', {
    chat_id: env('TELEGRAM_OWNER_ID'),
    text,
    disable_web_page_preview: true,
    reply_markup: { force_reply: true, input_field_placeholder: 'Reply to them in the chat' },
  }, signal);
  return typeof result?.message_id === 'number' ? result.message_id : null;
}

/** Confirmations. No force_reply, since there is nothing to answer. */
export async function sendNotice(text: string): Promise<void> {
  await tgCall('sendMessage', {
    chat_id: env('TELEGRAM_OWNER_ID'),
    text,
    disable_web_page_preview: true,
  });
}
