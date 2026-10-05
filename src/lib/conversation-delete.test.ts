import { describe, expect, it, vi } from 'vitest';

vi.mock('./redis', () => ({ getRedis: () => null }));

import { conversationKeys, deleteHoldings, findHoldings, holdsNothing, searchTranscripts, telegramMappings, type DeleteRedis } from './conversation-delete';
import type { Transcript } from './transcripts';

/** Plain keys, one sorted set and a SCAN that pages two keys at a time, as Upstash pages. */
class FakeRedis implements DeleteRedis {
  readonly store = new Map<string, unknown>();
  readonly index = new Map<string, number>();
  async exists(...keys: string[]) { return keys.filter(k => this.store.has(k)).length; }
  async get<T>(key: string) { return (this.store.get(key) ?? null) as T | null; }
  async scan(cursor: string | number, { match }: { match: string; count: number }): Promise<[string, string[]]> {
    const prefix = match.replace(/\*$/, '');
    const all = [...this.store.keys()].filter(k => k.startsWith(prefix));
    const at = Number(cursor);
    const next = at + 2 >= all.length ? '0' : String(at + 2);
    return [next, all.slice(at, at + 2)];
  }
  async zscore(_key: string, member: string) { return this.index.get(member) ?? null; }
  async del(...keys: string[]) { let n = 0; for (const k of keys) if (this.store.delete(k)) n++; return n; }
  async zrem(_key: string, ...members: string[]) { let n = 0; for (const m of members) if (this.index.delete(m)) n++; return n; }
}

const cid = 'a3f1c2d4-0000-4000-8000-000000000000';
const other = 'b7e2d1c0-0000-4000-8000-000000000000';

function seeded(): FakeRedis {
  const redis = new FakeRedis();
  for (const id of [cid, other]) {
    redis.store.set(`chat:conv:${id}`, ['turn']);
    redis.store.set(`chat:log:${id}`, ['entry']);
    redis.index.set(id, 1);
  }
  redis.store.set(`chat:live:${cid}`, 123);
  redis.store.set(`chat:held:${cid}`, { q: 'held', ts: 1 });
  // Upstash hands back objects, but a value written as a JSON string comes back as one.
  redis.store.set('chat:tg:501', { cid, q: 'first' });
  redis.store.set('chat:tg:502', JSON.stringify({ cid, q: 'second' }));
  redis.store.set('chat:tg:503', { cid: other, q: 'not theirs' });
  redis.store.set('chat:tg:504', 'not json');
  redis.store.set('chat:corpus:active', 'ns-1');
  redis.store.set('rl:chat:1.2.3.4', 3);
  return redis;
}

describe('conversationKeys', () => {
  it('names every key built from the conversation id', () => {
    expect(conversationKeys(cid)).toEqual([`chat:conv:${cid}`, `chat:log:${cid}`, `chat:live:${cid}`, `chat:held:${cid}`]);
  });
});

describe('telegramMappings', () => {
  it('finds the mappings that point at the conversation across every SCAN page', async () => {
    expect((await telegramMappings(cid, seeded())).sort()).toEqual(['chat:tg:501', 'chat:tg:502']);
  });
});

describe('findHoldings and deleteHoldings', () => {
  it('finds everything held for one conversation and deletes only that', async () => {
    const redis = seeded();
    const holdings = await findHoldings(cid, redis);
    expect(holdings.keys).toEqual(conversationKeys(cid));
    expect(holdings.indexed).toBe(true);
    expect(holdings.telegram.sort()).toEqual(['chat:tg:501', 'chat:tg:502']);

    expect(await deleteHoldings(holdings, redis)).toBe(7);
    expect(holdsNothing(await findHoldings(cid, redis))).toBe(true);
    // The other conversation and the site's own keys are untouched.
    expect(holdsNothing(await findHoldings(other, redis))).toBe(false);
    expect(redis.store.has('chat:tg:503')).toBe(true);
    expect(redis.store.has('chat:corpus:active')).toBe(true);
    expect(redis.store.has('rl:chat:1.2.3.4')).toBe(true);
  });

  it('reports only what exists, and deleting nothing is a no-op', async () => {
    const redis = new FakeRedis();
    redis.store.set(`chat:log:${cid}`, ['entry']);
    const holdings = await findHoldings(cid, redis);
    expect(holdings).toEqual({ cid, keys: [`chat:log:${cid}`], indexed: false, telegram: [] });
    expect(await deleteHoldings(holdings, redis)).toBe(1);
    const empty = await findHoldings(cid, redis);
    expect(holdsNothing(empty)).toBe(true);
    expect(await deleteHoldings(empty, redis)).toBe(0);
  });
});

describe('searchTranscripts', () => {
  const at = (day: number, hour = 12) => Date.UTC(2026, 8, day, hour);
  const transcripts: Transcript[] = [
    { cid: other, last: at(20), entries: [
      { r: 'u', t: 'What are his hourly rates for a short project?', ts: at(20) },
      { r: 'a', t: 'The site does not list rates.', ts: at(20) },
    ] },
    { cid, last: at(12), entries: [
      { r: 'u', t: 'Hello', ts: at(12) },
      { r: 'a', t: 'Hi. Ask me about rates or projects.', ts: at(12) },
      { r: 'u', t: 'Does Jody take on freelance work? I need someone for a healthcare dashboard and want to know his rates before I reach out to him.', ts: at(12, 13) },
    ] },
  ];

  it('matches every word in the visitor\'s questions, oldest first, with the best question as the excerpt', () => {
    const found = searchTranscripts(transcripts, 'Rates');
    expect(found.map(c => c.cid)).toEqual([cid, other]);
    expect(found[0]).toMatchObject({ first: at(12), questions: 2 });
    expect(found[0].excerpt).toBe('Does Jody take on freelance work? I need someone for a healthcare dashboard and...');
    expect(found[0].excerpt.length).toBeLessThanOrEqual(83);
    expect(found[1].excerpt).toBe('What are his hourly rates for a short project?');
  });

  it('needs all the words, and ignores what Verso said', () => {
    expect(searchTranscripts(transcripts, 'hourly rates').map(c => c.cid)).toEqual([other]);
    expect(searchTranscripts(transcripts, 'projects').map(c => c.cid)).toEqual([]);
    expect(searchTranscripts(transcripts, '   ')).toEqual([]);
  });
});
