import { describe, expect, it, vi } from 'vitest';
import {
  TRANSCRIPT_TTL_S, formatTranscripts, logEntries, readTranscripts, summarize, type TranscriptRedis, type TranscriptTransaction,
} from './transcripts';

vi.mock('./redis', () => ({ getRedis: () => null }));

/** Records every command and applies a transaction's commands together, or not at all. */
class FakeRedis implements TranscriptRedis {
  lists = new Map<string, unknown[]>();
  zset = new Map<string, number>();
  ttls = new Map<string, number>();
  execs = 0;
  failExec = false;
  expireCalls: Array<{ key: string; seconds: number; option: string }> = [];
  multi() {
    const ops: Array<() => void> = [];
    const tx: TranscriptTransaction = {
      rpush: (key, ...values) => { ops.push(() => { const l = this.lists.get(key) ?? []; l.push(...values); this.lists.set(key, l); }); return tx; },
      expire: (key, seconds, option) => { ops.push(() => {
        this.expireCalls.push({ key, seconds, option });
        if (option === 'NX' && this.ttls.has(key)) return;
        if (this.lists.has(key)) this.ttls.set(key, seconds);
      }); return tx; },
      zadd: (_key, _opts, { score, member }) => { ops.push(() => { if (!this.zset.has(member)) this.zset.set(member, score); }); return tx; },
      zremrangebyscore: (key, min, max) => { ops.push(() => { void this.zremrangebyscore(key, min, max); }); return tx; },
      exec: async () => {
        this.execs++;
        if (this.failExec) throw new Error('down');
        ops.forEach(op => op());
        return [];
      },
    };
    return tx;
  }
  async lrange<T>(key: string) { return (this.lists.get(key) ?? []) as T[]; }
  async del(...keys: string[]) { let n = 0; for (const k of keys) { if (this.lists.delete(k)) n++; this.ttls.delete(k); } return n; }
  async zrem(_key: string, ...members: string[]) { let n = 0; for (const m of members) if (this.zset.delete(m)) n++; return n; }
  async zremrangebyscore(_key: string, min: number, max: number) {
    let n = 0; for (const [m, s] of this.zset) if (s >= min && s <= max) { this.zset.delete(m); n++; } return n;
  }
  async zrange<T>(_key: string, min: number, max: number) {
    return [...this.zset].filter(([, s]) => s >= min && s <= max).sort((a, b) => a[1] - b[1]).map(([m]) => m) as T;
  }
}

const cid = 'a3f1c2d4-0000-4000-8000-000000000000';

describe('logEntries and readTranscripts', () => {
  it('writes redacted entries for 30 days and finds them through the index', async () => {
    const redis = new FakeRedis();
    await logEntries(cid, [
      { r: 'u', t: 'Hire? me@x.io', ts: Date.now(), topic: 'hiring', page: '/about' },
      { r: 'a', t: 'He is open to it.', ts: Date.now() },
    ], redis);
    expect(redis.ttls.get(`chat:log:${cid}`)).toBe(TRANSCRIPT_TTL_S);
    expect(redis.expireCalls).toEqual([{ key: `chat:log:${cid}`, seconds: TRANSCRIPT_TTL_S, option: 'NX' }]);
    const [transcript] = await readTranscripts(Date.now() - 1000, redis);
    expect(transcript.cid).toBe(cid);
    expect(transcript.entries.map(e => e.t)).toEqual(['Hire? [email]', 'He is open to it.']);
    expect(transcript.entries[0]).toMatchObject({ topic: 'hiring', page: '/about' });
  });

  it('drops conversations older than the window from the index', async () => {
    const redis = new FakeRedis();
    redis.zset.set('old', Date.now() - (TRANSCRIPT_TTL_S + 60) * 1000);
    await logEntries(cid, [{ r: 'u', t: 'Hi', ts: 1 }], redis);
    expect([...redis.zset.keys()]).toEqual([cid]);
  });

  it('skips unreadable rows', async () => {
    const redis = new FakeRedis();
    redis.zset.set(cid, Date.now());
    redis.lists.set(`chat:log:${cid}`, ['not json', JSON.stringify({ r: 'x', t: 'bad', ts: 1 }), { r: 'u', t: 'ok', ts: Date.now() }]);
    const [transcript] = await readTranscripts(0, redis);
    expect(transcript.entries).toEqual([{ r: 'u', t: 'ok', ts: expect.any(Number) }]);
  });

  it('never throws on a write failure', async () => {
    const redis = new FakeRedis();
    redis.failExec = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(logEntries(cid, [{ r: 'u', t: 'Hi', ts: 1 }], redis)).resolves.toBeUndefined();
  });
});

describe('retention', () => {
  const key = `chat:log:${cid}`;

  it('sets the TTL once, on creation, and later writes do not refresh it', async () => {
    const redis = new FakeRedis();
    await logEntries(cid, [{ r: 'u', t: 'First', ts: Date.now() }], redis);
    redis.ttls.set(key, 123); // time has passed: what remains of the first window
    await logEntries(cid, [{ r: 'a', t: 'Second', ts: Date.now() }], redis);
    expect(redis.ttls.get(key)).toBe(123);
    expect(redis.expireCalls.map(c => c.option)).toEqual(['NX', 'NX']);
  });

  it('sends the push, the TTL and the index write in one transaction', async () => {
    const redis = new FakeRedis();
    await logEntries(cid, [{ r: 'u', t: 'Hi', ts: Date.now() }], redis);
    expect(redis.execs).toBe(1);
  });

  it('leaves no list behind without a TTL when the transaction fails', async () => {
    const redis = new FakeRedis();
    redis.failExec = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await logEntries(cid, [{ r: 'u', t: 'Hi', ts: Date.now() }], redis);
    expect(redis.lists.size).toBe(0);
    expect(redis.ttls.size).toBe(0);
  });

  it('scores the index by the first message and keeps that score', async () => {
    const redis = new FakeRedis();
    const spy = vi.spyOn(Date, 'now');
    spy.mockReturnValue(1_000_000);
    await logEntries(cid, [{ r: 'u', t: 'First', ts: 1 }], redis);
    spy.mockReturnValue(2_000_000);
    await logEntries(cid, [{ r: 'a', t: 'Later', ts: 2 }], redis);
    spy.mockRestore();
    expect(redis.zset.get(cid)).toBe(1_000_000);
  });

  it('deletes a log whose first entry is older than 30 days when it is read, and trims the index', async () => {
    const redis = new FakeRedis();
    const old = Date.now() - (TRANSCRIPT_TTL_S + 60) * 1000;
    redis.lists.set(key, [JSON.stringify({ r: 'u', t: 'ancient', ts: old }), JSON.stringify({ r: 'a', t: 'recent', ts: Date.now() })]);
    redis.zset.set(cid, Date.now() - 1000); // a legacy last-activity score
    redis.zset.set('stale', old);
    expect(await readTranscripts(0, redis)).toEqual([]);
    expect(redis.lists.has(key)).toBe(false);
    expect(redis.zset.size).toBe(0);
  });

  it('still finds a conversation that started before the range but was active inside it', async () => {
    const redis = new FakeRedis();
    const started = Date.now() - 10 * 86400_000;
    redis.zset.set(cid, started);
    redis.lists.set(key, [JSON.stringify({ r: 'u', t: 'a', ts: started }), JSON.stringify({ r: 'u', t: 'b', ts: Date.now() })]);
    expect(await readTranscripts(Date.now() - 86400_000, redis)).toHaveLength(1);
    expect(await readTranscripts(Date.now() + 1000, redis)).toHaveLength(0);
  });
});

describe('redaction in the log', () => {
  it('redacts an email, a phone, a card and a key before they are written', async () => {
    const redis = new FakeRedis();
    await logEntries(cid, [{ r: 'u', t: 'Mail jane.doe@example.com, call +1 415 555 0132, card 4111 1111 1111 1111, key sk-proj-abcdefghijklmnopqrstuvwx123', ts: Date.now() }], redis);
    const stored = JSON.stringify(redis.lists.get(`chat:log:${cid}`));
    for (const leak of ['jane.doe', '555 0132', '4111', 'sk-proj']) expect(stored).not.toContain(leak);
  });
  it('redacts Jody\'s replies in the log too', async () => {
    const redis = new FakeRedis();
    await logEntries(cid, [{ r: 'j', t: 'Call +1 415 555 0132', ts: Date.now() }], redis);
    expect(JSON.stringify(redis.lists.get(`chat:log:${cid}`))).not.toContain('555 0132');
  });
});

describe('formatTranscripts', () => {
  const transcripts = [{ cid, last: 3, entries: [
    { r: 'u' as const, t: 'Is he available?', ts: Date.UTC(2026, 8, 28, 14, 2), topic: 'hiring', page: '/about' },
    { r: 'a' as const, t: 'The site does not say.', ts: 2 },
    { r: 'u' as const, t: 'What stack?', ts: 3, topic: 'experience', failed: true },
    { r: 'u' as const, t: 'And rates?', ts: 3, held: true },
    { r: 'j' as const, t: 'Yes, email me.', ts: 4 },
  ] }];

  it('counts what matters', () => {
    expect(summarize(transcripts)).toMatchObject({ conversations: 1, questions: 3, failed: 1, replies: 1 });
  });

  it('writes a readable transcript with its summary', () => {
    const md = formatTranscripts(transcripts, { since: Date.UTC(2026, 8, 21), until: Date.UTC(2026, 8, 28), digest: '### Themes' });
    expect(md).toContain('# Verso conversations, 2026-09-21 to 2026-09-28');
    expect(md).toContain('1 conversation, 3 questions, 1 unanswered, 1 reply from Jody. Times are UTC.');
    expect(md).toContain('Visitor (held for Jody):');
    expect(md).toContain('## Digest\n\n### Themes');
    expect(md).toContain('## 2026-09-28 14:02 · a3f1 · from /about');
    expect(md).toContain('Visitor (hiring):\n\nIs he available?');
    expect(md).toContain('Visitor (experience, no answer):');
    expect(md).toContain('Jody:\n\nYes, email me.');
  });
});
