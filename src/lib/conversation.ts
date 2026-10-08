/**
 * Redis state for Verso's conversations: the transcript of each chat, keyed by
 * conversation id under the `chat:` namespace.
 *
 * History lives here and is read back server-side on every turn. It is never
 * accepted from the client, or a caller could write assistant turns of its own
 * into the prompt.
 *
 * Nothing here throws. Every function takes the client as an optional last
 * argument (production omits it and gets `getRedis()`; tests inject a fake),
 * and returns a safe default when the client is null or Upstash blips. A flaky
 * Redis costs the visitor their follow-up context, never the answer.
 */

import { getRedis } from './redis';
import { redactText } from '@jodybrewster/gemini-live/server/redact';
import type { ConversationTurn } from './verso';

export const CONV_TTL_S = 86400; // 24h

/**
 * Only the commands this module actually issues. Structural on purpose: the
 * real `Redis` satisfies it, and so does a hand-rolled Map in the tests.
 */
export interface RedisLike {
  rpush(key: string, ...values: unknown[]): Promise<number>;
  lrange<T = unknown>(key: string, start: number, stop: number): Promise<T[]>;
  llen(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

/*
 * Key names. The `rl:*` prefixes belong to the rate limiter
 * (lib/limits.ts) - nothing here may read or write them.
 */
export const convKey = (cid: string) => `chat:conv:${cid}`;

async function guard<T>(label: string, fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    // Name only: an error object can carry the request, which holds visitor text.
    console.error(`[conversation] ${label}`, err instanceof Error ? err.name : 'Error');
    return fallback;
  }
}

/**
 * @upstash/redis JSON-parses on read, so a stored object comes back as an
 * object while a stored JSON string comes back as a string. Both paths are
 * real depending on how a value was written, so every read goes through here.
 * Anything that isn't an object is treated as corrupt.
 */
function coerce<T>(v: unknown): T | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    try {
      const parsed: unknown = JSON.parse(v);
      return parsed !== null && typeof parsed === 'object' ? (parsed as T) : null;
    } catch {
      return null;
    }
  }
  return typeof v === 'object' ? (v as T) : null;
}

export async function readHistory(
  cid: string,
  redis: RedisLike | null = getRedis(),
): Promise<ConversationTurn[]> {
  if (!redis) return [];
  return guard('history read failed', [], async () => {
    const rows = await redis.lrange(convKey(cid), 0, -1);
    const turns: ConversationTurn[] = [];
    for (const row of rows) {
      // One unreadable turn drops out; the rest of the thread survives.
      const turn = coerce<ConversationTurn>(row);
      if (turn) turns.push(turn);
    }
    return turns;
  });
}

export async function appendTurn(
  cid: string,
  turn: ConversationTurn,
  redis: RedisLike | null = getRedis(),
): Promise<void> {
  if (!redis) return;
  await guard<void>('turn append failed', undefined, async () => {
    const key = convKey(cid);
    // Redacted here, so the prompt history never holds what the disclosure
    // says is removed. Jody's replies go through appendReply, as he wrote them.
    await redis.rpush(key, JSON.stringify({ ...turn, t: redactText(turn.t) }));
    // Refreshed on every append so the window runs from the last message, not
    // the first. A conversation still going at hour 23 must not expire.
    await redis.expire(key, CONV_TTL_S);
  });
}

export async function conversationLength(
  cid: string,
  redis: RedisLike | null = getRedis(),
): Promise<number> {
  if (!redis) return 0;
  return guard('conversation length failed', 0, async () => redis.llen(convKey(cid)));
}

/** A reply Jody sent from Telegram, as the dock shows it. */
export interface Reply { t: string; ts: number; q: string }

export async function appendReply(
  cid: string,
  text: string,
  question: string,
  redis: RedisLike | null = getRedis(),
): Promise<boolean> {
  if (!redis) return false;
  return guard('reply append failed', false, async () => {
    const key = convKey(cid);
    await redis.rpush(key, JSON.stringify({ r: 'j', t: text, q: question, ts: Date.now() } satisfies ConversationTurn));
    await redis.expire(key, CONV_TTL_S);
    return true;
  });
}

export async function readReplies(
  cid: string,
  redis: RedisLike | null = getRedis(),
): Promise<Reply[]> {
  const turns = await readHistory(cid, redis);
  return turns.flatMap(turn => turn.r === 'j' && typeof turn.t === 'string' && typeof turn.ts === 'number'
    ? [{ t: turn.t, ts: turn.ts, q: typeof turn.q === 'string' ? turn.q : '' }]
    : []);
}
