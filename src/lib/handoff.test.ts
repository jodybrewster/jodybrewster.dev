import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONV_TTL_S,
  FINAL_TTL_S,
  HANDOFF_WINDOW_MS,
  MAX_REPLY_CHARS,
  MSG_TTL_S,
  PRESENCE_TTL_S,
  listOutstanding,
  appendTurn,
  claim,
  conversationLength,
  getFinal,
  getLastQuestion,
  getPending,
  getReply,
  isOperatorOnline,
  mapTelegramMessage,
  presenceTtlSeconds,
  putFinal,
  putPending,
  putReply,
  readHistory,
  resolveTelegramMessage,
  setLastQuestion,
  setPresence,
  type FinalAnswer,
  type PendingQuestion,
  type RedisLike,
} from './handoff';

interface SetCall {
  key: string;
  value: unknown;
  opts?: { nx?: true; ex?: number };
}

/**
 * In-memory Redis. Honours NX and records TTLs so the tests can assert the
 * expiry policy, not just the values. `set` does its check-and-write with no
 * await in between, which is what makes it a faithful model of SET NX: real
 * Redis runs one command at a time, so two concurrent claims cannot both win.
 */
class FakeRedis implements RedisLike {
  readonly store = new Map<string, unknown>();
  readonly ttls = new Map<string, number>();
  readonly setCalls: SetCall[] = [];

  async get<T = unknown>(key: string): Promise<T | null> {
    return this.store.has(key) ? (this.store.get(key) as T) : null;
  }

  async set(key: string, value: unknown, opts?: { nx?: true; ex?: number }): Promise<unknown> {
    this.setCalls.push({ key, value, opts });
    if (opts?.nx && this.store.has(key)) return null;
    this.store.set(key, value);
    if (opts?.ex !== undefined) this.ttls.set(key, opts.ex);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.store.delete(key)) removed += 1;
      this.ttls.delete(key);
    }
    return removed;
  }

  async ttl(key: string): Promise<number> {
    if (!this.store.has(key)) return -2;
    return this.ttls.get(key) ?? -1;
  }

  async rpush(key: string, ...values: unknown[]): Promise<number> {
    const list = this.list(key);
    list.push(...values);
    this.store.set(key, list);
    return list.length;
  }

  async lrange<T = unknown>(key: string, start: number, stop: number): Promise<T[]> {
    const list = this.list(key);
    const from = start < 0 ? list.length + start : start;
    const to = stop < 0 ? list.length + stop : stop;
    return list.slice(Math.max(from, 0), to + 1) as T[];
  }

  async llen(key: string): Promise<number> {
    return this.list(key).length;
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (!this.store.has(key)) return 0;
    this.ttls.set(key, seconds);
    return 1;
  }

  /** Sorted set, modelled as member -> score and sorted on read, which is all
   *  the outstanding-question set needs. */
  private zset(key: string): Map<string, number> {
    const existing = this.store.get(key);
    if (existing instanceof Map) return existing as Map<string, number>;
    const fresh = new Map<string, number>();
    this.store.set(key, fresh);
    return fresh;
  }

  async zadd(key: string, entry: { score: number; member: string }): Promise<unknown> {
    this.zset(key).set(entry.member, entry.score);
    return 1;
  }

  async zrem(key: string, ...members: string[]): Promise<unknown> {
    const set = this.zset(key);
    let removed = 0;
    for (const m of members) if (set.delete(m)) removed += 1;
    return removed;
  }

  async zrange<T = unknown>(key: string, start: number, stop: number): Promise<T[]> {
    const sorted = [...this.zset(key).entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([member]) => member);
    const from = start < 0 ? sorted.length + start : start;
    const to = stop < 0 ? sorted.length + stop : stop;
    return sorted.slice(Math.max(from, 0), to + 1) as T[];
  }

  async zremrangebyscore(key: string, min: number, max: number): Promise<unknown> {
    const set = this.zset(key);
    let removed = 0;
    for (const [member, score] of [...set.entries()]) {
      if (score >= min && score <= max) {
        set.delete(member);
        removed += 1;
      }
    }
    return removed;
  }

  /** Seed a list with raw values, including junk the module must survive. */
  seed(key: string, values: unknown[]): void {
    this.store.set(key, [...values]);
  }

  private list(key: string): unknown[] {
    const existing = this.store.get(key);
    return Array.isArray(existing) ? existing : [];
  }
}

/** Every command rejects, standing in for an Upstash outage mid-request. */
class BrokenRedis implements RedisLike {
  private fail(): never {
    throw new Error('upstash unreachable');
  }
  async get<T = unknown>(_key: string): Promise<T | null> {
    return this.fail();
  }
  async set(_key: string, _value: unknown, _opts?: { nx?: true; ex?: number }): Promise<unknown> {
    return this.fail();
  }
  async del(..._keys: string[]): Promise<number> {
    return this.fail();
  }
  async ttl(_key: string): Promise<number> {
    return this.fail();
  }
  async rpush(_key: string, ..._values: unknown[]): Promise<number> {
    return this.fail();
  }
  async lrange<T = unknown>(_key: string, _start: number, _stop: number): Promise<T[]> {
    return this.fail();
  }
  async llen(_key: string): Promise<number> {
    return this.fail();
  }
  async expire(_key: string, _seconds: number): Promise<number> {
    return this.fail();
  }
  async zadd(_key: string, _entry: { score: number; member: string }): Promise<unknown> {
    return this.fail();
  }
  async zrem(_key: string, ..._members: string[]): Promise<unknown> {
    return this.fail();
  }
  async zrange<T = unknown>(_key: string, _start: number, _stop: number): Promise<T[]> {
    return this.fail();
  }
  async zremrangebyscore(_key: string, _min: number, _max: number): Promise<unknown> {
    return this.fail();
  }
}

const pending: PendingQuestion = { cid: 'c1', q: 'Are you around?', ts: 1_700_000_000_000, index: 2 };
const final: FinalAnswer = { by: 'human', text: 'I am.', sources: [], ts: 1_700_000_000_100 };

let redis: FakeRedis;

beforeEach(() => {
  redis = new FakeRedis();
});

describe('claim', () => {
  it('gives the window to exactly one racer', async () => {
    const results = await Promise.all([
      claim('m1', 'human', redis),
      claim('m1', 'llm', redis),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = results[0] ? 'human' : 'llm';
    expect(redis.store.get('chat:msg:m1:claim')).toBe(winner);
  });

  it('refuses a second claim on an already-claimed message', async () => {
    expect(await claim('m1', 'human', redis)).toBe(true);
    expect(await claim('m1', 'llm', redis)).toBe(false);
    expect(await claim('m1', 'human', redis)).toBe(false);
    expect(redis.store.get('chat:msg:m1:claim')).toBe('human');
  });

  it('claims a different message independently', async () => {
    expect(await claim('m1', 'human', redis)).toBe(true);
    expect(await claim('m2', 'llm', redis)).toBe(true);
  });

  it('writes the claim only with NX and an expiry', async () => {
    await claim('m1', 'llm', redis);
    const call = redis.setCalls.find(entry => entry.key === 'chat:msg:m1:claim');
    expect(call?.opts).toEqual({ nx: true, ex: MSG_TTL_S });
  });
});

describe('pending questions', () => {
  it('round-trips a pending question under chat:msg:<mid>', async () => {
    await putPending('m1', pending, redis);
    expect(redis.store.has('chat:msg:m1')).toBe(true);
    expect(redis.ttls.get('chat:msg:m1')).toBe(MSG_TTL_S);
    expect(await getPending('m1', redis)).toEqual(pending);
  });

  it('returns null for an unknown mid', async () => {
    expect(await getPending('nope', redis)).toBeNull();
  });

  it('returns null rather than junk when the stored value is unparseable', async () => {
    redis.store.set('chat:msg:m1', 'half-written');
    expect(await getPending('m1', redis)).toBeNull();
  });
});

describe('final answers', () => {
  it('round-trips a final answer under chat:msg:<mid>:final', async () => {
    await putFinal('m1', final, redis);
    expect(redis.ttls.get('chat:msg:m1:final')).toBe(FINAL_TTL_S);
    expect(await getFinal('m1', redis)).toEqual(final);
  });

  it('returns null for an unknown mid', async () => {
    expect(await getFinal('missing', redis)).toBeNull();
  });

  it('reads an already-parsed object back, as Upstash hands it over', async () => {
    redis.store.set('chat:msg:m1:final', { ...final });
    expect(await getFinal('m1', redis)).toEqual(final);
  });
});

describe('replies', () => {
  it('round-trips a reply under chat:msg:<mid>:reply', async () => {
    await putReply('m1', 'On my way.', redis);
    expect(redis.ttls.get('chat:msg:m1:reply')).toBe(MSG_TTL_S);
    expect(await getReply('m1', redis)).toBe('On my way.');
  });

  it('truncates an overlong reply', async () => {
    await putReply('m1', 'x'.repeat(MAX_REPLY_CHARS + 500), redis);
    expect(await getReply('m1', redis)).toHaveLength(MAX_REPLY_CHARS);
  });

  it('returns a string even when Upstash parsed the value into a number', async () => {
    redis.store.set('chat:msg:m1:reply', 42);
    expect(await getReply('m1', redis)).toBe('42');
  });

  it('returns null for an unknown mid', async () => {
    expect(await getReply('nope', redis)).toBeNull();
  });
});

describe('conversation history', () => {
  it('returns an empty history for an unknown cid', async () => {
    expect(await readHistory('nobody', redis)).toEqual([]);
    expect(await conversationLength('nobody', redis)).toBe(0);
  });

  it('round-trips appended turns in order under chat:conv:<cid>', async () => {
    await appendTurn('c1', { r: 'u', t: 'first', ts: 1 }, redis);
    await appendTurn('c1', { r: 'a', t: 'second', ts: 2, by: 'human' }, redis);
    await appendTurn('c1', { r: 'u', t: 'third', ts: 3 }, redis);

    expect(redis.store.has('chat:conv:c1')).toBe(true);
    const turns = await readHistory('c1', redis);
    expect(turns.map(turn => turn.t)).toEqual(['first', 'second', 'third']);
    expect(turns[1].by).toBe('human');
    expect(await conversationLength('c1', redis)).toBe(3);
  });

  it('drops malformed entries and keeps the readable ones', async () => {
    redis.seed('chat:conv:c1', [
      JSON.stringify({ r: 'u', t: 'good', ts: 1 }),
      'not json at all',
      '42',
      null,
      JSON.stringify({ r: 'a', t: 'also good', ts: 2 }),
    ]);
    const turns = await readHistory('c1', redis);
    expect(turns.map(turn => turn.t)).toEqual(['good', 'also good']);
  });

  it('refreshes the conversation TTL on every append', async () => {
    await appendTurn('c1', { r: 'u', t: 'first', ts: 1 }, redis);
    redis.ttls.set('chat:conv:c1', 12);

    await appendTurn('c1', { r: 'a', t: 'second', ts: 2 }, redis);
    expect(redis.ttls.get('chat:conv:c1')).toBe(CONV_TTL_S);
  });
});

describe('presence', () => {
  it('reads back online with the presence TTL', async () => {
    await setPresence(true, redis);
    expect(redis.store.get('chat:presence')).toBe('1');
    expect(await isOperatorOnline(redis)).toBe(true);
    expect(redis.ttls.get('chat:presence')).toBe(PRESENCE_TTL_S);
    expect(await presenceTtlSeconds(redis)).toBe(PRESENCE_TTL_S);
  });

  it('reads back offline once presence is cleared', async () => {
    await setPresence(true, redis);
    await setPresence(false, redis);
    expect(redis.store.has('chat:presence')).toBe(false);
    expect(await isOperatorOnline(redis)).toBe(false);
    expect(await presenceTtlSeconds(redis)).toBe(0);
  });

  it('is offline when nothing was ever written', async () => {
    expect(await isOperatorOnline(redis)).toBe(false);
    expect(await presenceTtlSeconds(redis)).toBe(0);
  });

  it('still reads online when Upstash parsed the marker into a number', async () => {
    redis.store.set('chat:presence', 1);
    expect(await isOperatorOnline(redis)).toBe(true);
  });
});

describe('telegram mapping', () => {
  it('round-trips a telegram message id under chat:tg:<id>', async () => {
    await mapTelegramMessage(9876, 'm1', redis);
    expect(redis.store.get('chat:tg:9876')).toBe('m1');
    expect(redis.ttls.get('chat:tg:9876')).toBe(MSG_TTL_S);
    expect(await resolveTelegramMessage(9876, redis)).toBe('m1');
  });

  it('returns null for an unmapped telegram message', async () => {
    expect(await resolveTelegramMessage(1234, redis)).toBeNull();
  });

  it('round-trips the last question under chat:tg:last', async () => {
    expect(await getLastQuestion(redis)).toBeNull();
    await setLastQuestion('m1', redis);
    expect(redis.store.get('chat:tg:last')).toBe('m1');
    expect(redis.ttls.get('chat:tg:last')).toBe(MSG_TTL_S);
    expect(await getLastQuestion(redis)).toBe('m1');

    await setLastQuestion('m2', redis);
    expect(await getLastQuestion(redis)).toBe('m2');
  });
});

describe('degradation', () => {
  let errors: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errors.mockRestore();
  });

  it('no-ops safely with no Redis configured', async () => {
    await expect(isOperatorOnline(null)).resolves.toBe(false);
    await expect(setPresence(true, null)).resolves.toBeUndefined();
    await expect(setPresence(false, null)).resolves.toBeUndefined();
    await expect(presenceTtlSeconds(null)).resolves.toBe(0);
    await expect(readHistory('c1', null)).resolves.toEqual([]);
    await expect(appendTurn('c1', { r: 'u', t: 'hi', ts: 1 }, null)).resolves.toBeUndefined();
    await expect(conversationLength('c1', null)).resolves.toBe(0);
    await expect(putPending('m1', pending, null)).resolves.toBeUndefined();
    await expect(getPending('m1', null)).resolves.toBeNull();
    await expect(putReply('m1', 'hi', null)).resolves.toBeUndefined();
    await expect(getReply('m1', null)).resolves.toBeNull();
    await expect(putFinal('m1', final, null)).resolves.toBeUndefined();
    await expect(getFinal('m1', null)).resolves.toBeNull();
    await expect(mapTelegramMessage(1, 'm1', null)).resolves.toBeUndefined();
    await expect(resolveTelegramMessage(1, null)).resolves.toBeNull();
    await expect(setLastQuestion('m1', null)).resolves.toBeUndefined();
    await expect(getLastQuestion(null)).resolves.toBeNull();
  });

  it('cannot claim without Redis, so the LLM answers', async () => {
    expect(await claim('m1', 'human', null)).toBe(false);
    expect(await claim('m1', 'llm', null)).toBe(false);
  });

  it('swallows a failing Redis and returns the same safe defaults', async () => {
    const broken = new BrokenRedis();

    await expect(isOperatorOnline(broken)).resolves.toBe(false);
    await expect(setPresence(true, broken)).resolves.toBeUndefined();
    await expect(setPresence(false, broken)).resolves.toBeUndefined();
    await expect(presenceTtlSeconds(broken)).resolves.toBe(0);
    await expect(readHistory('c1', broken)).resolves.toEqual([]);
    await expect(appendTurn('c1', { r: 'u', t: 'hi', ts: 1 }, broken)).resolves.toBeUndefined();
    await expect(conversationLength('c1', broken)).resolves.toBe(0);
    await expect(putPending('m1', pending, broken)).resolves.toBeUndefined();
    await expect(getPending('m1', broken)).resolves.toBeNull();
    await expect(claim('m1', 'human', broken)).resolves.toBe(false);
    await expect(putReply('m1', 'hi', broken)).resolves.toBeUndefined();
    await expect(getReply('m1', broken)).resolves.toBeNull();
    await expect(putFinal('m1', final, broken)).resolves.toBeUndefined();
    await expect(getFinal('m1', broken)).resolves.toBeNull();
    await expect(mapTelegramMessage(1, 'm1', broken)).resolves.toBeUndefined();
    await expect(resolveTelegramMessage(1, broken)).resolves.toBeNull();
    await expect(setLastQuestion('m1', broken)).resolves.toBeUndefined();
    await expect(getLastQuestion(broken)).resolves.toBeNull();

    expect(errors).toHaveBeenCalled();
  });
});

describe('listOutstanding', () => {
  const at = (ts: number) => ({ cid: 'c1', q: 'q', ts, index: 1 });

  it('is empty with nothing pending', async () => {
    expect(await listOutstanding(redis)).toEqual([]);
  });

  it('returns pending questions oldest first, carrying the name', async () => {
    const now = Date.now();
    await putPending('m1', { ...at(now - 2000), name: 'Sarah' }, redis);
    await putPending('m2', { ...at(now - 1000), name: 'Dave' }, redis);

    const open = await listOutstanding(redis);
    expect(open.map(q => q.mid)).toEqual(['m1', 'm2']);
    expect(open.map(q => q.name)).toEqual(['Sarah', 'Dave']);
  });

  it('drops a question once either side claims it', async () => {
    const now = Date.now();
    await putPending('m1', at(now), redis);
    await putPending('m2', at(now), redis);

    await claim('m1', 'human', redis);
    expect((await listOutstanding(redis)).map(q => q.mid)).toEqual(['m2']);

    // The model winning must clear it too, or a question the visitor already
    // got an answer to would still count as open and block a bare reply.
    await claim('m2', 'llm', redis);
    expect(await listOutstanding(redis)).toEqual([]);
  });

  it('prunes anything older than the handoff window', async () => {
    const now = Date.now();
    await putPending('stale', at(now - HANDOFF_WINDOW_MS - 5000), redis);
    await putPending('fresh', at(now), redis);

    expect((await listOutstanding(redis)).map(q => q.mid)).toEqual(['fresh']);
  });

  it('skips members whose record has expired out from under the set', async () => {
    await putPending('m1', at(Date.now()), redis);
    await redis.del('chat:msg:m1');
    expect(await listOutstanding(redis)).toEqual([]);
  });

  it('returns [] with no redis and on a broken client', async () => {
    expect(await listOutstanding(null)).toEqual([]);
    expect(await listOutstanding(new BrokenRedis())).toEqual([]);
  });
});

describe('key names', () => {
  it('writes only under the chat: namespace it owns', async () => {
    await setPresence(true, redis);
    await appendTurn('c1', { r: 'u', t: 'hi', ts: 1 }, redis);
    await putPending('m1', pending, redis);
    await claim('m1', 'human', redis);
    await putReply('m1', 'hello', redis);
    await putFinal('m1', final, redis);
    await mapTelegramMessage(9876, 'm1', redis);
    await setLastQuestion('m1', redis);

    expect([...redis.store.keys()].sort()).toEqual([
      'chat:conv:c1',
      'chat:msg:m1',
      'chat:msg:m1:claim',
      'chat:msg:m1:final',
      'chat:msg:m1:reply',
      'chat:pending',
      'chat:presence',
      'chat:tg:9876',
      'chat:tg:last',
    ]);
    // rl:chat:* belongs to @upstash/ratelimit; this module never goes near it.
    expect([...redis.store.keys()].some(key => key.startsWith('rl:'))).toBe(false);
  });
});
