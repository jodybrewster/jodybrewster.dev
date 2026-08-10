import { env } from './env';

/**
 * Telegram bot client for the chat handoff.
 *
 * A visitor's question is pushed to the owner's phone, he replies in the thread,
 * and the reply goes back to the visitor verbatim as the chat persona "Verso".
 * This module is the transport plus every pure piece of formatting and parsing
 * around it; the conversation mapping lives elsewhere.
 *
 * Nothing here throws. When the bot is not configured the calls no-op and the
 * chat behaves exactly as it does without a human on the other end.
 *
 * The webhook route separately checks TELEGRAM_WEBHOOK_SECRET against the
 * X-Telegram-Bot-Api-Secret-Token header; that check belongs to the route, not
 * to the client.
 */

const API_ROOT = 'https://api.telegram.org';

/** Owner commands. Everything else the owner types is treated as a reply. */
export type Command = 'on' | 'off' | 'status' | 'help' | 'start';

const COMMANDS: readonly Command[] = ['on', 'off', 'status', 'help', 'start'];

/** The slice of Telegram's Message we actually read. */
export interface TelegramMessage {
  message_id: number;
  from?: { id: number; is_bot?: boolean; first_name?: string };
  chat?: { id: number; type?: string };
  text?: string;
  reply_to_message?: { message_id: number };
}

/** Longest visitor question we forward. Well inside Telegram's 4096-char
 *  message limit once the header and footer are added. */
const QUESTION_MAX = 3500;

/** Enough of the previous exchange to recognize the thread on a phone. */
const PREVIEW_MAX = 60;

/** C0 and C1 control characters, minus tab and newline. Telegram renders them
 *  as nothing useful and they are a cheap way to hide text in a question. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

/**
 * Both vars or nothing. Every caller branches on this, so a half-configured
 * bot must read as unconfigured rather than fail at the first send.
 */
export function telegramConfigured(): boolean {
  return Boolean(env('TELEGRAM_BOT_TOKEN') && env('TELEGRAM_OWNER_ID'));
}

/**
 * `/off@versodev_bot now` -> `off`. Telegram appends the bot name in groups and
 * phone keyboards like to capitalize and pad, so the loose forms have to match
 * or the owner's command silently becomes a reply to the visitor.
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
 * Prepares visitor text for the owner's phone.
 *
 * Deliberately does NOT escape markdown, because messages are sent with no
 * parse_mode at all. Under Markdown an unbalanced `*` or `_` in a question
 * makes Telegram answer 400 and the question disappears with no visible cause;
 * under HTML an `<a href>` is a clickable link injected onto his phone. Plain
 * text parses no entities, so there is nothing to escape and the question
 * arrives exactly as it was typed.
 *
 * What it does remove is invisible junk, runaway blank space, and the leading
 * slash that would let visitor text land as a bot command.
 */
export function sanitizeForTelegram(text: unknown, max = QUESTION_MAX): string {
  if (typeof text !== 'string') return '';

  let out = text.replace(CONTROL_CHARS, '').replace(/\n{3,}/g, '\n\n');
  if (out.startsWith('/')) out = ` ${out}`;
  if (out.length > max) out = `${out.slice(0, max - 1)}…`;
  return out;
}

/** Collapses to one line for the header preview, where a newline would break
 *  the shape of the message. */
function oneLine(text: unknown, max: number): string {
  const collapsed = sanitizeForTelegram(text).replace(/\s+/g, ' ').trim();
  return sanitizeForTelegram(collapsed, max);
}

/**
 * The outbound question.
 *
 * The metadata header comes first and only the fixed footer follows the
 * visitor's text, so visitor text can append to the message but never reframe
 * what sits above it.
 */
export function formatQuestionMessage(opts: {
  cid: string;
  question: string;
  index: number;
  prevQ?: string;
  prevA?: string;
  windowSeconds: number;
}): string {
  const header = [`Verso · ${String(opts.cid).slice(0, 4)} · q${opts.index}`];

  const prevQ = oneLine(opts.prevQ, PREVIEW_MAX);
  const prevA = oneLine(opts.prevA, PREVIEW_MAX);
  if (prevQ && prevA) header.push(`prev: "${prevQ}" -> "${prevA}"`);

  const question = sanitizeForTelegram(opts.question);
  const footer = `${opts.windowSeconds}s. Reply to this message.`;

  return `${header.join('\n')}\n\n${question}\n\n${footer}`;
}

/**
 * The owner, in his own private chat with the bot. The chat-type check is the
 * point: without it, anyone who adds the bot to a group could speak as Verso.
 */
export function isOwnerUpdate(msg: unknown, ownerId: string | undefined): boolean {
  if (typeof ownerId !== 'string' || !ownerId.trim()) return false;
  if (!msg || typeof msg !== 'object') return false;

  const { from, chat } = msg as { from?: { id?: unknown }; chat?: { type?: unknown } };
  if (!from || !chat) return false;
  if (from.id === undefined || from.id === null) return false;

  // Telegram sends the id as a number, the env var arrives as a string.
  return String(from.id) === String(ownerId).trim() && chat.type === 'private';
}

/**
 * One POST to the Bot API. Returns the `result` field, or null on any failure.
 *
 * The failure worth recognizing in the log is `403 bot can't initiate
 * conversation with a user`: the bot is fine, the owner has simply never sent
 * it `/start`, and no message will ever arrive until he does.
 */
export async function tgCall<T = unknown>(
  method: string,
  payload: Record<string, unknown>,
): Promise<T | null> {
  if (!telegramConfigured()) return null;
  const token = env('TELEGRAM_BOT_TOKEN');

  try {
    const res = await fetch(`${API_ROOT}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; result?: T; description?: string }
      | null;

    if (!res.ok || !body?.ok) {
      console.error(`[telegram] ${method} failed`, res.status, body?.description ?? '');
      return null;
    }

    return body.result ?? null;
  } catch (err) {
    console.error(`[telegram] ${method} failed`, err);
    return null;
  }
}

/**
 * Sends a visitor question and returns the message id, which is how a later
 * reply is matched back to its conversation.
 *
 * `force_reply` is what makes answering one tap on a phone, and it is what
 * makes Telegram attach `reply_to_message` to the answer.
 */
export async function sendQuestion(text: string): Promise<number | null> {
  const result = await tgCall<{ message_id?: number }>('sendMessage', {
    chat_id: env('TELEGRAM_OWNER_ID'),
    text,
    disable_web_page_preview: true,
    reply_markup: { force_reply: true, input_field_placeholder: 'Reply as Verso' },
  });
  return typeof result?.message_id === 'number' ? result.message_id : null;
}

/** Confirmations and status lines. No force_reply, since there is nothing to
 *  answer, and failure is not worth surfacing to the visitor. */
export async function sendNotice(text: string): Promise<void> {
  await tgCall('sendMessage', {
    chat_id: env('TELEGRAM_OWNER_ID'),
    text,
    disable_web_page_preview: true,
  });
}
