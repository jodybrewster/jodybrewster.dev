/**
 * Verso's operator channel: finished turns go to Jody on Telegram, and a reply
 * he sends to one of them is added to that visitor's conversation.
 *
 * The link between the two is `chat:tg:<message_id>`, which maps the Telegram
 * message he replied to back to the conversation and the question. It lives as
 * long as the conversation itself, so a reply can never land in a thread that
 * has already expired.
 *
 * Nothing here throws: a missing bot or a Redis blip costs Jody a notification,
 * never the visitor their answer.
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
}

/** The slice of the Redis client this module uses. */
export interface OperatorRedis {
  set(key: string, value: unknown, opts: { ex: number }): Promise<unknown>;
  get<T = unknown>(key: string): Promise<T | null>;
}

const tgKey = (messageId: number) => `chat:tg:${messageId}`;

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
