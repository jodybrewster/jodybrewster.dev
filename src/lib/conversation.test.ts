import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONV_TTL_S, appendReply, appendTurn, conversationLength, readHistory, readReplies, type RedisLike } from './conversation';
import { normalizeTurns } from './verso';

/** In-memory Redis lists. Records TTLs so the expiry policy can be asserted. */
class FakeRedis implements RedisLike {
  readonly store = new Map<string, unknown[]>();
  readonly ttls = new Map<string, number>();

  async rpush(key: string, ...values: unknown[]): Promise<number> {
    const list = this.store.get(key) ?? [];
    list.push(...values);
    this.store.set(key, list);
    return list.length;
  }

  async lrange<T = unknown>(key: string, start: number, stop: number): Promise<T[]> {
    const list = this.store.get(key) ?? [];
    const from = start < 0 ? list.length + start : start;
    const to = stop < 0 ? list.length + stop : stop;
    return list.slice(Math.max(from, 0), to + 1) as T[];
  }

  async llen(key: string): Promise<number> {
    return (this.store.get(key) ?? []).length;
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (!this.store.has(key)) return 0;
    this.ttls.set(key, seconds);
    return 1;
  }
}

/** Every command rejects, standing in for an Upstash outage mid-request. */
class BrokenRedis implements RedisLike {
  private fail(): never {
    throw new Error('upstash unreachable');
  }
  async rpush(): Promise<number> { return this.fail(); }
  async lrange<T = unknown>(): Promise<T[]> { return this.fail(); }
  async llen(): Promise<number> { return this.fail(); }
  async expire(): Promise<number> { return this.fail(); }
}

let redis: FakeRedis;

beforeEach(() => {
  redis = new FakeRedis();
});

describe('conversation history', () => {
  it('returns an empty history for an unknown cid', async () => {
    expect(await readHistory('nobody', redis)).toEqual([]);
    expect(await conversationLength('nobody', redis)).toBe(0);
  });

  it('round-trips appended turns in order under chat:conv:<cid>', async () => {
    await appendTurn('c1', { r: 'u', t: 'first', ts: 1 }, redis);
    await appendTurn('c1', { r: 'a', t: 'second', ts: 2 }, redis);
    await appendTurn('c1', { r: 'u', t: 'third', ts: 3 }, redis);

    expect([...redis.store.keys()]).toEqual(['chat:conv:c1']);
    const turns = await readHistory('c1', redis);
    expect(turns.map(turn => turn.t)).toEqual(['first', 'second', 'third']);
    expect(await conversationLength('c1', redis)).toBe(3);
  });

  it('drops malformed entries and keeps the readable ones', async () => {
    redis.store.set('chat:conv:c1', [
      JSON.stringify({ r: 'u', t: 'good', ts: 1 }),
      'not json at all',
      '42',
      null,
      { r: 'a', t: 'also good', ts: 2 },
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

describe('degradation', () => {
  let errors: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errors.mockRestore();
  });

  it('no-ops safely with no Redis configured', async () => {
    await expect(readHistory('c1', null)).resolves.toEqual([]);
    await expect(appendTurn('c1', { r: 'u', t: 'hi', ts: 1 }, null)).resolves.toBeUndefined();
    await expect(conversationLength('c1', null)).resolves.toBe(0);
  });

  it('swallows a failing Redis and returns the same safe defaults', async () => {
    const broken = new BrokenRedis();
    await expect(readHistory('c1', broken)).resolves.toEqual([]);
    await expect(appendTurn('c1', { r: 'u', t: 'hi', ts: 1 }, broken)).resolves.toBeUndefined();
    await expect(conversationLength('c1', broken)).resolves.toBe(0);
    expect(errors).toHaveBeenCalled();
  });
});

describe('Jody replies', () => {
  const cid = 'a3f1c2d4-0000-4000-8000-000000000000';

  it('stores a reply in the conversation and reads back only replies', async () => {
    const redis = new FakeRedis();
    await appendTurn(cid, { r: 'u', t: 'What did he build?', ts: 1 }, redis);
    await appendTurn(cid, { r: 'a', t: 'A tracker.', ts: 2 }, redis);
    expect(await appendReply(cid, 'Happy to talk.', 'What did he build?', redis)).toBe(true);
    const replies = await readReplies(cid, redis);
    expect(replies).toEqual([{ t: 'Happy to talk.', ts: expect.any(Number), q: 'What did he build?' }]);
    expect(redis.ttls.get(`chat:conv:${cid}`)).toBe(CONV_TTL_S);
  });

  it('keeps replies out of the transcript the model sees', async () => {
    const redis = new FakeRedis();
    await appendTurn(cid, { r: 'u', t: 'Q1', ts: 1 }, redis);
    await appendTurn(cid, { r: 'a', t: 'A1', ts: 2 }, redis);
    await appendReply(cid, 'From Jody', 'Q1', redis);
    const turns = normalizeTurns(await readHistory(cid, redis));
    expect(turns.map(turn => turn.t)).toEqual(['Q1', 'A1']);
  });

  it('reports failure without throwing when Redis is down or absent', async () => {
    expect(await appendReply(cid, 'x', 'q', new BrokenRedis())).toBe(false);
    expect(await appendReply(cid, 'x', 'q', null)).toBe(false);
    expect(await readReplies(cid, null)).toEqual([]);
  });
});

describe('privacy', () => {
  it('redacts visitor and Verso turns before they reach chat:conv', async () => {
    const redis = new FakeRedis();
    await appendTurn('c1', { r: 'u', t: 'I am jane.doe@example.com, +1 415 555 0132', ts: 1 }, redis);
    await appendTurn('c1', { r: 'a', t: 'Noted, jane.doe@example.com.', ts: 2 }, redis);
    const stored = JSON.stringify(redis.store.get('chat:conv:c1'));
    expect(stored).not.toContain('jane.doe');
    expect(stored).not.toContain('555 0132');
    expect(stored).toContain('[email]');
    expect(stored).toContain('[phone]');
  });

  it('keeps Jody\'s own reply exactly as he wrote it', async () => {
    const redis = new FakeRedis();
    await appendReply('c1', 'Call me on +1 415 555 0132 or jody@example.com', 'q', redis);
    expect((await readReplies('c1', redis))[0].t).toBe('Call me on +1 415 555 0132 or jody@example.com');
  });

  it('logs only the error name when Redis fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const redis = new BrokenRedis();
    await appendTurn('c1', { r: 'u', t: 'secret words', ts: 1 }, redis);
    expect(spy.mock.calls.flat().every(arg => typeof arg === 'string')).toBe(true);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('upstash unreachable');
  });
});
