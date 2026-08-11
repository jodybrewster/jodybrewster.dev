/**
 * Redis state for the chat handoff: the operator answers from Telegram, and
 * the LLM only speaks when they don't.
 *
 * The whole design turns on one atomic operation. When a visitor asks a
 * question and the operator is online, the HTTP request parks for up to
 * HANDOFF_WINDOW_MS while the question sits in Telegram. Two racers can end
 * that wait: the webhook, carrying a human reply, and the chat route itself,
 * hitting the deadline. Both call `claim`, which is `SET key value NX EX ttl`.
 * Redis settles it - exactly one caller gets the key, and the loser defers.
 * Without that, a reply landing on the 40th second gets answered twice.
 *
 * Nothing here throws. Every function takes the client as an optional last
 * argument (production omits it and gets `getRedis()`; tests inject a fake),
 * and returns a safe default when the client is null or Upstash blips. An
 * unconfigured or flaky Redis degrades the handoff to a plain LLM answer, it
 * never 500s the chat route.
 */

import { getRedis } from './redis';
import type { ConversationTurn } from './verso';

/** How long the visitor's request waits for a human before the LLM takes it. */
export const HANDOFF_WINDOW_MS = 40_000;
/** Reply poll cadence inside that window. Short enough to feel like typing. */
export const POLL_INTERVAL_MS = 1200;
/** Presence expires on its own so a forgotten "online" can't strand visitors. */
export const PRESENCE_TTL_S = 36000; // 10h
export const CONV_TTL_S = 86400; // 24h
export const MSG_TTL_S = 3600; // 1h
export const FINAL_TTL_S = 900; // 15m
/** Telegram allows longer, but a chat bubble past this is not a chat bubble. */
export const MAX_REPLY_CHARS = 4000;

/**
 * Only the commands this module actually issues. Structural on purpose: the
 * real `Redis` satisfies it, and so does a hand-rolled Map in the tests.
 */
export interface RedisLike {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { nx?: true; ex?: number }): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  ttl(key: string): Promise<number>;
  rpush(key: string, ...values: unknown[]): Promise<number>;
  lrange<T = unknown>(key: string, start: number, stop: number): Promise<T[]>;
  llen(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  getdel<T = unknown>(key: string): Promise<T | null>;
  zadd(key: string, entry: { score: number; member: string }): Promise<unknown>;
  zrem(key: string, ...members: string[]): Promise<unknown>;
  zrange<T = unknown>(key: string, start: number, stop: number): Promise<T[]>;
  zremrangebyscore(key: string, min: number, max: number): Promise<unknown>;
}

export interface PendingQuestion {
  cid: string;
  q: string;
  ts: number;
  /** Position in the conversation, so a late reply can be placed correctly. */
  index: number;
  /** Who is asking, when they gave a name. Operator context only. */
  name?: string;
}

/** A pending question with its id attached, for disambiguating a bare reply. */
export interface OutstandingQuestion extends PendingQuestion {
  mid: string;
}

export interface FinalAnswer {
  by: 'human' | 'llm';
  text: string;
  sources: unknown[];
  ts: number;
}

/*
 * Key names. The `rl:chat:*` prefix belongs to @upstash/ratelimit
 * (lib/rate-limit.ts) - nothing here may read or write it.
 */
const PRESENCE_KEY = 'chat:presence';
const TG_LAST_KEY = 'chat:tg:last';

/**
 * When the current handoff window ends, in epoch ms. Deliberately outlives
 * PRESENCE_KEY: a Redis key expiring runs nothing, so a lapse is invisible
 * until something asks. This is the something to ask - it survives the
 * presence key it describes, so a later request can see that the window
 * closed on its own and say so once. Cleared by an explicit /off, which needs
 * no announcement.
 */
const PRESENCE_UNTIL_KEY = 'chat:presence:until';

/**
 * Questions currently waiting on a human, scored by the moment they were
 * asked. A bare Telegram reply carries no target, and answering the newest
 * open question is only safe when it is the ONLY open question - with two
 * visitors waiting, guessing sends one person's answer to the other and says
 * "Sent as Verso." either way. This set is what makes that case detectable.
 */
const OUTSTANDING_KEY = 'chat:pending';

const convKey = (cid: string) => `chat:conv:${cid}`;
const msgKey = (mid: string) => `chat:msg:${mid}`;
const claimKey = (mid: string) => `chat:msg:${mid}:claim`;
const replyKey = (mid: string) => `chat:msg:${mid}:reply`;
const finalKey = (mid: string) => `chat:msg:${mid}:final`;
const tgKey = (tgMessageId: number) => `chat:tg:${tgMessageId}`;

/**
 * One place where an Upstash failure becomes a safe default. A dropped
 * connection should cost the visitor a human answer, not the whole response.
 */
async function guard<T>(label: string, fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    console.error(`[handoff] ${label}`, err);
    return fallback;
  }
}

/**
 * @upstash/redis JSON-parses on read, so a stored object comes back as an
 * object while a stored JSON string comes back as a string. Both paths are
 * real depending on how a value was written, so every structured read goes
 * through here. Anything that isn't an object is treated as corrupt.
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

/**
 * Same parsing quirk, other direction: a value we wrote as a plain string can
 * come back as a number or a boolean if it happens to look like JSON.
 */
function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === 'string' ? v : String(v);
}

export async function isOperatorOnline(redis: RedisLike | null = getRedis()): Promise<boolean> {
  if (!redis) return false;
  return guard('presence read failed', false, async () => {
    const raw = await redis.get(PRESENCE_KEY);
    return raw === '1' || raw === 1;
  });
}

/** Going offline deletes the key rather than writing a falsy marker, so a
 *  half-failed write can never read back as "online". */
export async function setPresence(on: boolean, redis: RedisLike | null = getRedis()): Promise<void> {
  if (!redis) return;
  await guard<void>('presence write failed', undefined, async () => {
    if (on) {
      await redis.set(PRESENCE_KEY, '1', { ex: PRESENCE_TTL_S });
      // Outlives the window by a day so the lapse is still observable after it
      // happens. Going off deliberately clears it - he already knows.
      await redis.set(PRESENCE_UNTIL_KEY, String(Date.now() + PRESENCE_TTL_S * 1000), {
        ex: PRESENCE_TTL_S + 86400,
      });
    } else {
      await redis.del(PRESENCE_KEY, PRESENCE_UNTIL_KEY);
    }
  });
}

/**
 * Did the handoff window close on its own since anyone last looked?
 *
 * Returns the moment it ended, once, and never again - the read deletes the
 * marker, so whichever request notices first is the only one that reports it.
 * That matters because this is called from both the webhook and the chat
 * route, and two visitors arriving together must not produce two notices.
 *
 * Returns null while presence is still live, when it was switched off by hand,
 * and when someone has already been told.
 */
export async function claimPresenceLapse(
  redis: RedisLike | null = getRedis(),
): Promise<number | null> {
  if (!redis) return null;
  return guard<number | null>('lapse check failed', null, async () => {
    const until = asString(await redis.get(PRESENCE_UNTIL_KEY));
    if (!until) return null;
    const endedAt = Number(until);
    if (!Number.isFinite(endedAt) || endedAt > Date.now()) return null;
    // Still on means the window was extended by a fresh /on - not a lapse.
    if (await redis.get(PRESENCE_KEY)) return null;
    // GETDEL is the claim: only one caller gets a value back.
    return (await redis.getdel(PRESENCE_UNTIL_KEY)) ? endedAt : null;
  });
}

/** Seconds of presence left, for the operator's own status display. Redis
 *  reports -2 for a missing key and -1 for no expiry; both mean "no countdown"
 *  to a caller, so they flatten to 0. */
export async function presenceTtlSeconds(redis: RedisLike | null = getRedis()): Promise<number> {
  if (!redis) return 0;
  return guard('presence ttl failed', 0, async () => {
    const ttl = await redis.ttl(PRESENCE_KEY);
    return typeof ttl === 'number' && ttl > 0 ? ttl : 0;
  });
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
    await redis.rpush(key, JSON.stringify(turn));
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

export async function putPending(
  mid: string,
  p: PendingQuestion,
  redis: RedisLike | null = getRedis(),
): Promise<void> {
  if (!redis) return;
  await guard<void>('pending write failed', undefined, async () => {
    await redis.set(msgKey(mid), JSON.stringify(p), { ex: MSG_TTL_S });
    await redis.zadd(OUTSTANDING_KEY, { score: p.ts, member: mid });
    // The set is pruned by score on read, but an expire keeps it from
    // outliving the process entirely if every reader goes away.
    await redis.expire(OUTSTANDING_KEY, MSG_TTL_S);
  });
}

/**
 * Questions still genuinely waiting, newest last. Anything older than the
 * handoff window has already been answered by the model, so it is pruned on
 * read rather than trusted - a request that died mid-flight never got to
 * remove itself.
 */
export async function listOutstanding(
  redis: RedisLike | null = getRedis(),
): Promise<OutstandingQuestion[]> {
  if (!redis) return [];
  return guard<OutstandingQuestion[]>('outstanding read failed', [], async () => {
    await redis.zremrangebyscore(OUTSTANDING_KEY, 0, Date.now() - HANDOFF_WINDOW_MS);
    const mids = await redis.zrange<string>(OUTSTANDING_KEY, 0, -1);
    const out: OutstandingQuestion[] = [];
    for (const mid of mids) {
      if (typeof mid !== 'string') continue;
      const pending = coerce<PendingQuestion>(await redis.get(msgKey(mid)));
      if (pending) out.push({ ...pending, mid });
    }
    return out;
  });
}

export async function getPending(
  mid: string,
  redis: RedisLike | null = getRedis(),
): Promise<PendingQuestion | null> {
  if (!redis) return null;
  return guard('pending read failed', null, async () =>
    coerce<PendingQuestion>(await redis.get(msgKey(mid))),
  );
}

/**
 * The race, settled. `NX` means the first writer wins and every later one is
 * refused, so the webhook and the deadline timer can both fire and only one
 * answer reaches the visitor. Returns true only to the winner.
 *
 * No Redis means no way to arbitrate, so nobody may claim - the chat route
 * reads that false as "run the LLM" and the handoff simply doesn't happen.
 */
export async function claim(
  mid: string,
  who: 'human' | 'llm',
  redis: RedisLike | null = getRedis(),
): Promise<boolean> {
  if (!redis) return false;
  return guard('claim failed', false, async () => {
    const res = await redis.set(claimKey(mid), who, { nx: true, ex: MSG_TTL_S });
    // Upstash returns 'OK' when the write landed and null when NX blocked it.
    const won = Boolean(res);
    // Claimed by either side means no longer waiting, so it leaves the
    // outstanding set whoever won. Removing only on a human claim would leave
    // model-answered questions there to be miscounted as open.
    if (won) await redis.zrem(OUTSTANDING_KEY, mid);
    return won;
  });
}

export async function putReply(
  mid: string,
  text: string,
  redis: RedisLike | null = getRedis(),
): Promise<void> {
  if (!redis) return;
  await guard<void>('reply write failed', undefined, async () => {
    await redis.set(replyKey(mid), text.slice(0, MAX_REPLY_CHARS), { ex: MSG_TTL_S });
  });
}

export async function getReply(
  mid: string,
  redis: RedisLike | null = getRedis(),
): Promise<string | null> {
  if (!redis) return null;
  return guard('reply read failed', null, async () => asString(await redis.get(replyKey(mid))));
}

/** The settled answer, cached so a reconnecting client sees what it missed
 *  rather than re-running the question. */
export async function putFinal(
  mid: string,
  final: FinalAnswer,
  redis: RedisLike | null = getRedis(),
): Promise<void> {
  if (!redis) return;
  await guard<void>('final write failed', undefined, async () => {
    await redis.set(finalKey(mid), JSON.stringify(final), { ex: FINAL_TTL_S });
  });
}

export async function getFinal(
  mid: string,
  redis: RedisLike | null = getRedis(),
): Promise<FinalAnswer | null> {
  if (!redis) return null;
  return guard('final read failed', null, async () =>
    coerce<FinalAnswer>(await redis.get(finalKey(mid))),
  );
}

/** Telegram tells us which message a reply quoted, not which visitor asked it.
 *  This is the lookup back to our own message id. */
export async function mapTelegramMessage(
  tgMessageId: number,
  mid: string,
  redis: RedisLike | null = getRedis(),
): Promise<void> {
  if (!redis) return;
  await guard<void>('telegram map write failed', undefined, async () => {
    await redis.set(tgKey(tgMessageId), mid, { ex: MSG_TTL_S });
  });
}

export async function resolveTelegramMessage(
  tgMessageId: number,
  redis: RedisLike | null = getRedis(),
): Promise<string | null> {
  if (!redis) return null;
  return guard('telegram map read failed', null, async () =>
    asString(await redis.get(tgKey(tgMessageId))),
  );
}

/** Fallback target for an operator who types a bare reply without quoting
 *  anything. The most recent question is the one they almost certainly meant. */
export async function setLastQuestion(
  mid: string,
  redis: RedisLike | null = getRedis(),
): Promise<void> {
  if (!redis) return;
  await guard<void>('last question write failed', undefined, async () => {
    await redis.set(TG_LAST_KEY, mid, { ex: MSG_TTL_S });
  });
}

export async function getLastQuestion(
  redis: RedisLike | null = getRedis(),
): Promise<string | null> {
  if (!redis) return null;
  return guard('last question read failed', null, async () => asString(await redis.get(TG_LAST_KEY)));
}
