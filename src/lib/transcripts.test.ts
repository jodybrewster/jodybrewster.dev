import { describe, expect, it, vi } from 'vitest';
import {
  TRANSCRIPT_TTL_S, formatTranscripts, logEntries, readTranscripts, redact, summarize, type TranscriptRedis,
} from './transcripts';

vi.mock('./redis', () => ({ getRedis: () => null }));

class FakeRedis implements TranscriptRedis {
  lists = new Map<string, unknown[]>();
  zset = new Map<string, number>();
  ttls = new Map<string, number>();
  async rpush(key: string, ...values: unknown[]) { const l = this.lists.get(key) ?? []; l.push(...values); this.lists.set(key, l); return l.length; }
  async expire(key: string, seconds: number) { this.ttls.set(key, seconds); return 1; }
  async lrange<T>(key: string) { return (this.lists.get(key) ?? []) as T[]; }
  async zadd(_key: string, { score, member }: { score: number; member: string }) { this.zset.set(member, score); return 1; }
  async zremrangebyscore(_key: string, min: number, max: number) {
    let n = 0; for (const [m, s] of this.zset) if (s >= min && s <= max) { this.zset.delete(m); n++; } return n;
  }
  async zrange<T>(_key: string, min: number, max: number) {
    return [...this.zset].filter(([, s]) => s >= min && s <= max).sort((a, b) => a[1] - b[1]).map(([m]) => m) as T;
  }
}

const cid = 'a3f1c2d4-0000-4000-8000-000000000000';

describe('redact', () => {
  it('removes emails and phone numbers', () => {
    expect(redact('Reach me at sam.lee+jobs@example.co.uk or +1 (415) 555-0132.')).toBe('Reach me at [email] or [phone].');
  });
  it('keeps years, ranges and money', () => {
    const text = 'From 2019-2024 at $120,000, 3 roles.';
    expect(redact(text)).toBe(text);
  });
});

describe('logEntries and readTranscripts', () => {
  it('writes redacted entries for 30 days and finds them through the index', async () => {
    const redis = new FakeRedis();
    await logEntries(cid, [
      { r: 'u', t: 'Hire? me@x.io', ts: 1, topic: 'hiring', page: '/about' },
      { r: 'a', t: 'He is open to it.', ts: 2 },
    ], redis);
    expect(redis.ttls.get(`chat:log:${cid}`)).toBe(TRANSCRIPT_TTL_S);
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
    redis.lists.set(`chat:log:${cid}`, ['not json', JSON.stringify({ r: 'x', t: 'bad', ts: 1 }), { r: 'u', t: 'ok', ts: 1 }]);
    const [transcript] = await readTranscripts(0, redis);
    expect(transcript.entries).toEqual([{ r: 'u', t: 'ok', ts: 1 }]);
  });

  it('never throws on a write failure', async () => {
    const redis = new FakeRedis();
    redis.rpush = vi.fn().mockRejectedValue(new Error('down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(logEntries(cid, [{ r: 'u', t: 'Hi', ts: 1 }], redis)).resolves.toBeUndefined();
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
