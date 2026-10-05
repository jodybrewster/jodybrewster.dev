import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  records: [] as Array<Record<string, unknown>>,
  segments: new Map<string, Array<{ seq: number; hash: string }>>(),
  dropped: [] as string[],
  fail: false,
  sendNotice: vi.fn(),
  redis: new Map<string, unknown>(),
}));
vi.mock('./env', () => ({ env: (key: string) => deps.env[key] }));
vi.mock('./telegram', () => ({ sendNotice: deps.sendNotice }));
vi.mock('./redis', () => ({
  getRedis: () => ({
    get: async (k: string) => deps.redis.get(k) ?? null,
    set: async (k: string, v: unknown) => { deps.redis.set(k, v); },
    hincrby: async (k: string, f: string, n: number) => {
      const h = (deps.redis.get(k) as Record<string, number>) ?? {};
      h[f] = (h[f] ?? 0) + n;
      deps.redis.set(k, h);
      return h[f];
    },
    expire: async () => 1,
    hgetall: async (k: string) => deps.redis.get(k) ?? null,
  }),
}));
vi.mock('@jodybrewster/gemini-live/server/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@jodybrewster/gemini-live/server/audit')>()),
  // The real store is tested in gemini-live-nextjs against real Redis; here, what the site writes.
  createUpstashAuditStore: () => ({
    async record(event: Record<string, unknown>) {
      if (deps.fail) throw new Error('store down');
      deps.records.push(event);
      const month = String(event.ts).slice(0, 7);
      deps.segments.set(month, [...(deps.segments.get(month) ?? []), { seq: deps.records.length, hash: 'b'.repeat(64) }]);
    },
    async head() { return deps.records.length ? { seq: deps.records.length, hash: 'a'.repeat(64) } : null; },
    async segments() { return [...deps.segments.keys()].sort(); },
    async entries(segment: string) { return deps.segments.get(segment) ?? []; },
    async dropSegment(segment: string) { deps.dropped.push(segment); deps.segments.delete(segment); },
  }),
}));

const KEY = 'ab'.repeat(32);
async function load() {
  vi.resetModules();
  return import('./audit');
}

beforeEach(() => {
  deps.env = { AUDIT_CHAIN_KEY: KEY, UPSTASH_REDIS_REST_URL: 'https://example.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't', VERCEL_ENV: 'production' };
  deps.records = [];
  deps.segments = new Map();
  deps.dropped = [];
  deps.fail = false;
  deps.redis = new Map();
  deps.sendNotice.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('site audit', () => {
  it('records an entry with a timestamp and reports that it did', async () => {
    const { audit } = await load();
    expect(await audit({ action: 'chat.answer', outcome: 'allow' })).toBe(true);
    expect(deps.records[0]).toMatchObject({ action: 'chat.answer', outcome: 'allow' });
    expect(typeof deps.records[0].ts).toBe('string');
  });

  it('runs only in Production, so previews and astro dev never sign with the key', async () => {
    for (const environment of ['preview', 'development', undefined]) {
      deps.env.VERCEL_ENV = environment;
      const { audit } = await load();
      expect(await audit({ action: 'x', outcome: 'allow' })).toBe(false);
    }
    expect(deps.records).toHaveLength(0);
  });

  it('never throws on a failed write, and tells Jody once an hour', async () => {
    deps.fail = true;
    const { audit } = await load();
    expect(await audit({ action: 'x', outcome: 'allow' })).toBe(false);
    expect(await audit({ action: 'y', outcome: 'allow' })).toBe(false);
    expect(deps.sendNotice).toHaveBeenCalledTimes(1);
    expect(deps.sendNotice.mock.calls[0][0]).toMatch(/write failed/);
  });

  it('sends the anchor of a high-value entry to Telegram at once', async () => {
    const { audit } = await load();
    await audit({ action: 'operator.reply', outcome: 'allow' }, { anchor: true });
    expect(deps.sendNotice).toHaveBeenCalledWith(expect.stringMatching(/^Audit anchor \(operator\.reply\): 1:a{64}@\d{4}-\d{2}-\d{2}$/));
  });

  it('counts refusals per day without chaining them, so a flood cannot fill the log', async () => {
    const { auditRefusal } = await load();
    for (let i = 0; i < 500; i++) await auditRefusal('chat', 'rate_limited');
    await auditRefusal('voice.token', '403');
    expect(deps.records).toHaveLength(0);
    const day = new Date().toISOString().slice(0, 10);
    expect(deps.redis.get(`audit:production:refusals:${day}`)).toEqual({ 'chat:rate_limited': 500, 'voice.token:403': 1 });
  });

  it("writes yesterday's refusal summary and the daily anchor with the month's count", async () => {
    const { dailyAudit } = await load();
    const now = new Date('2026-10-05T08:00:00Z');
    deps.redis.set('audit:production:refusals:2026-10-04', { 'chat:rate_limited': 42 });
    expect(await dailyAudit(now)).toBe('Anchor sent');
    expect(deps.records[0]).toMatchObject({ action: 'audit.refusals', details: { day: '2026-10-04', counts: { 'chat:rate_limited': 42 } } });
    expect(deps.sendNotice).toHaveBeenLastCalledWith(expect.stringMatching(/^Audit anchor \(daily\): 1:a{64}@.*\nEntries this month: 1\./s));
  });

  it('drops months past retention, recording and anchoring where each ended first', async () => {
    deps.segments.set('2025-08', [{ seq: 1, hash: 'c'.repeat(64) }]);
    deps.segments.set('2025-10', [{ seq: 2, hash: 'd'.repeat(64) }]);
    const { dailyAudit } = await load();
    await dailyAudit(new Date('2026-10-05T08:00:00Z'));
    expect(deps.dropped).toEqual(['2025-08']);
    expect(deps.records[0]).toMatchObject({ action: 'audit.segment.dropped', details: { segment: '2025-08', lastSeq: 1, lastHash: 'c'.repeat(64) } });
  });

  it('warns Jody when there is no head at all', async () => {
    const { dailyAudit } = await load();
    expect(await dailyAudit()).toBe('No head');
    expect(deps.sendNotice).toHaveBeenCalledWith(expect.stringMatching(/no entries and no head/));
  });

  it('keys references to ids, so a conversation id is never stored', async () => {
    const { ref } = await load();
    const id = 'a3f1c2d4-0000-4000-8000-000000000000';
    expect(ref(id)).toMatch(/^[0-9a-f]{16}$/);
    expect(ref(id)).toBe(ref(id));
    expect(ref(id)).not.toContain('a3f1c2d4');
  });

  it('records switch changes, anchored, and retries a change whose entry was not written', async () => {
    let mod = await load();
    await mod.auditSwitchChanges();
    expect(deps.records).toHaveLength(1); // first sighting
    expect(deps.sendNotice).not.toHaveBeenCalled();

    deps.env.SWITCH_VOICE = 'off';
    deps.fail = true; // the write fails: the state must not move on
    mod = await load();
    await mod.auditSwitchChanges();
    expect(deps.records).toHaveLength(1);
    deps.fail = false;
    await mod.auditSwitchChanges(); // the same instance tries again
    expect(deps.records).toHaveLength(2);
    expect(deps.records[1]).toMatchObject({ action: 'switch.changed', details: { before: { voice: true }, after: { voice: false } } });

    mod = await load(); // the same state again: nothing new
    await mod.auditSwitchChanges();
    expect(deps.records).toHaveLength(2);
  });
});

describe('anchor status', () => {
  it('reports whether the anchor reached Telegram, and audit() still answers only whether it wrote', async () => {
    const { audit, auditAnchored } = await load();
    deps.sendNotice.mockResolvedValue(true);
    expect(await auditAnchored({ action: 'conversation.deleted', outcome: 'allow' })).toEqual({ written: true, anchored: true });
    deps.sendNotice.mockResolvedValue(false);
    expect(await auditAnchored({ action: 'conversation.deleted', outcome: 'allow' })).toEqual({ written: true, anchored: false });
    deps.sendNotice.mockRejectedValue(new Error('down'));
    expect(await auditAnchored({ action: 'conversation.deleted', outcome: 'allow' })).toEqual({ written: true, anchored: false });
    expect(await audit({ action: 'operator.reply', outcome: 'allow' }, { anchor: true })).toBe(true);
    deps.fail = true;
    expect(await auditAnchored({ action: 'conversation.deleted', outcome: 'allow' })).toEqual({ written: false, anchored: false });
  });
});

describe('checkChainKey', async () => {
  const { GENESIS_HASH, chainKeyFromEnv, chainLink } = await import('@jodybrewster/gemini-live/server/audit');
  const right = chainKeyFromEnv({ AUDIT_CHAIN_KEY: KEY });
  // Any sentence of 43+ characters decodes as base64 to 32 bytes: the clipboard mistake this guards against.
  const wrong = chainKeyFromEnv({ AUDIT_CHAIN_KEY: 'this is a sentence that happens to be on the clipboard right now' });

  type Stored = { seq: number; prevHash: string; hash: string; keyId: string; event: { ts: string; action: string; outcome: 'allow' } };
  function chain(count: number, key = right): Stored[] {
    const out: Stored[] = [];
    let prevHash = GENESIS_HASH;
    for (let seq = 1; seq <= count; seq++) {
      const event = { ts: `2026-10-0${seq}T00:00:00Z`, action: 'chat.answer', outcome: 'allow' as const };
      const hash = chainLink(key, prevHash, seq, { keyId: key.id, event });
      out.push({ seq, prevHash, hash, keyId: key.id, event });
      prevHash = hash;
    }
    return out;
  }
  const store = (segments: Record<string, Stored[]>, head = Object.values(segments).flat().at(-1)) => ({
    head: async () => (head ? { seq: head.seq, hash: head.hash } : null),
    segments: async () => Object.keys(segments).sort(),
    entries: async (segment: string) => segments[segment] ?? [],
  });

  it('passes the key that signed the newest entry', async () => {
    const { checkChainKey } = await load();
    expect(await checkChainKey(store({ '2026-10': chain(3) }), right)).toEqual({ ok: true, seq: 3 });
  });

  it('refuses any other key, before anything is written with it', async () => {
    const { checkChainKey } = await load();
    expect(await checkChainKey(store({ '2026-10': chain(3) }), wrong)).toMatchObject({ ok: false, reason: 'mismatch' });
    expect(deps.records).toHaveLength(0);
  });

  it('finds the newest entry in an earlier month when the current one is still empty', async () => {
    const { checkChainKey } = await load();
    expect(await checkChainKey(store({ '2026-09': chain(2), '2026-10': [] }), right)).toEqual({ ok: true, seq: 2 });
  });

  it('refuses an empty chain, which cannot prove a key either way', async () => {
    const { checkChainKey } = await load();
    expect(await checkChainKey(store({}), right)).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('refuses when the head is not the newest entry, or the entry names another key id', async () => {
    const { checkChainKey } = await load();
    const entries = chain(3);
    expect(await checkChainKey(store({ '2026-10': entries }, entries[1]), right)).toMatchObject({ ok: false, reason: 'head' });
    const rotated = chainKeyFromEnv({ AUDIT_CHAIN_KEY: KEY, AUDIT_CHAIN_KEY_ID: 'k2' });
    expect(await checkChainKey(store({ '2026-10': entries }), rotated)).toMatchObject({ ok: false, reason: 'key-id' });
  });

  it('uses the configured key and store by default, and says so when the log is off', async () => {
    deps.env.VERCEL_ENV = 'preview';
    const { checkChainKey } = await load();
    expect(await checkChainKey()).toMatchObject({ ok: false, reason: 'off' });
  });
});
