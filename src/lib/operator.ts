/**
 * Verso's operator channel: finished turns go to Jody on Telegram, and a reply
 * he sends to one of them is added to that visitor's conversation.
 *
 * The link between the two is `chat:tg:<message_id>`, which maps the Telegram
 * message he replied to back to the conversation and the question. It lives as
 * long as the conversation itself, so a reply can never land in a thread that
 * has already expired.
 *
 * When Jody replies, the conversation is live with him for LIVE_WINDOW_MS.
 * Verso holds the visitor's next question for him instead of answering it
 * (`chat:live:<cid>` holds the time the window ends, `chat:held:<cid>` the
 * question). Each reply restarts the window. When it runs out, the dock asks
 * again with `fallback` and Verso answers as usual.
 *
 * Nothing here throws: a missing bot or a Redis blip costs Jody a notification,
 * never the visitor their answer. A failed read of the live window reads as
 * "not live", so Verso answers rather than leaving someone waiting.
 */

import { getRedis } from './redis';
import { CONV_TTL_S } from './conversation';
import { formatTurnMessage, sendTurn, telegramConfigured } from './telegram';

export interface TurnNotice {
  cid: string;
  index: number;
  question: string;
  answer?: string;
  failed?: boolean;
  topic?: string;
  /** Held for Jody: Verso answers after this many seconds if he does not. */
  waitSeconds?: number;
}

/** The slice of the Redis client this module uses. */
export interface OperatorRedis {
  set(key: string, value: unknown, opts: { ex: number }): Promise<unknown>;
  get<T = unknown>(key: string): Promise<T | null>;
  del(...keys: string[]): Promise<number>;
}

const tgKey = (messageId: number) => `chat:tg:${messageId}`;
const liveKey = (cid: string) => `chat:live:${cid}`;
const heldKey = (cid: string) => `chat:held:${cid}`;

/** How long Verso stays quiet after Jody replies, waiting to see if he has more to say. */
export const LIVE_WINDOW_MS = 120_000;

export async function notifyTurn(
  turn: TurnNotice,
  signal?: AbortSignal,
  redis: OperatorRedis | null = getRedis(),
): Promise<void> {
  if (!telegramConfigured()) return;
  const messageId = await sendTurn(formatTurnMessage(turn), signal);
  if (messageId === null || !redis) return;
  try {
    await redis.set(tgKey(messageId), { cid: turn.cid, q: turn.question }, { ex: CONV_TTL_S });
  } catch (err) {
    console.error('[operator] mapping write failed', err instanceof Error ? err.name : 'Error');
  }
}

export async function resolveTelegramMessage(
  messageId: number,
  redis: OperatorRedis | null = getRedis(),
): Promise<{ cid: string; q: string } | null> {
  if (!redis) return null;
  try {
    const value = await redis.get<unknown>(tgKey(messageId));
    const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
    if (!parsed || typeof parsed !== 'object') return null;
    const { cid, q } = parsed as { cid?: unknown; q?: unknown };
    return typeof cid === 'string' ? { cid, q: typeof q === 'string' ? q : '' } : null;
  } catch (err) {
    console.error('[operator] mapping read failed', err instanceof Error ? err.name : 'Error');
    return null;
  }
}

/** Starts or restarts Jody's window in a conversation. Returns when it ends. */
export async function goLive(cid: string, redis: OperatorRedis | null = getRedis()): Promise<number | null> {
  if (!redis) return null;
  const until = Date.now() + LIVE_WINDOW_MS;
  try {
    await redis.set(liveKey(cid), until, { ex: Math.ceil(LIVE_WINDOW_MS / 1000) });
    return until;
  } catch (err) {
    console.error('[operator] live write failed', err instanceof Error ? err.name : 'Error');
    return null;
  }
}

/** When Jody's window ends, or null if he is not live in this conversation. */
export async function liveUntil(cid: string, redis: OperatorRedis | null = getRedis()): Promise<number | null> {
  if (!redis) return null;
  try {
    const until = Number(await redis.get(liveKey(cid)));
    return Number.isFinite(until) && until > Date.now() ? until : null;
  } catch (err) {
    console.error('[operator] live read failed', err instanceof Error ? err.name : 'Error');
    return null;
  }
}

/** The question waiting on Jody. Only the latest one is kept: the dock holds one at a time. */
export async function holdQuestion(cid: string, q: string, redis: OperatorRedis | null = getRedis()): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(heldKey(cid), { q, ts: Date.now() }, { ex: Math.ceil(LIVE_WINDOW_MS / 1000) + 300 });
  } catch (err) {
    console.error('[operator] hold write failed', err instanceof Error ? err.name : 'Error');
  }
}

/** Removes and returns the held question, once Jody or Verso has answered it. */
export async function takeHeld(cid: string, redis: OperatorRedis | null = getRedis()): Promise<{ q: string; ts: number } | null> {
  if (!redis) return null;
  try {
    const value = await redis.get<unknown>(heldKey(cid));
    await redis.del(heldKey(cid));
    const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
    if (!parsed || typeof parsed !== 'object') return null;
    const { q, ts } = parsed as { q?: unknown; ts?: unknown };
    return typeof q === 'string' && typeof ts === 'number' ? { q, ts } : null;
  } catch (err) {
    console.error('[operator] hold read failed', err instanceof Error ? err.name : 'Error');
    return null;
  }
}
