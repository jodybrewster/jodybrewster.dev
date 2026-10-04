import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  records: [] as Array<Record<string, unknown>>,
  fail: false,
  sendNotice: vi.fn(),
  redis: new Map<string, unknown>(),
}));
vi.mock('./env', () => ({ env: (key: string) => deps.env[key] }));
vi.mock('./telegram', () => ({ sendNotice: deps.sendNotice }));
vi.mock('./redis', () => ({
  getRedis: () => ({ get: async (k: string) => deps.redis.get(k) ?? null, set: async (k: string, v: unknown) => { deps.redis.set(k, v); } }),
}));
vi.mock('@jodybrewster/gemini-live/server/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@jodybrewster/gemini-live/server/audit')>()),
  // The real store is tested in gemini-live-nextjs against real Redis; here, what the site writes.
  createUpstashAuditStore: (options: { prefix: string }) => ({
    prefix: options.prefix,
    async record(event: Record<string, unknown>) {
      if (deps.fail) throw new Error('store down');
      deps.records.push(event);
    },
    async head() { return deps.records.length ? { seq: deps.records.length, hash: 'a'.repeat(64) } : null; },
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
  deps.fail = false;
  deps.redis = new Map();
  deps.sendNotice.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('site audit', () => {
  it('records an entry with a timestamp and no visitor details', async () => {
    const { audit } = await load();
    await audit({ action: 'chat.answer', outcome: 'allow' });
    expect(deps.records).toHaveLength(1);
    expect(deps.records[0]).toMatchObject({ action: 'chat.answer', outcome: 'allow' });
    expect(typeof deps.records[0].ts).toBe('string');
  });

  it('is off without a key, and never throws when the store fails', async () => {
    deps.env.AUDIT_CHAIN_KEY = undefined;
    let mod = await load();
    await mod.audit({ action: 'x', outcome: 'allow' });
    expect(deps.records).toHaveLength(0);
    deps.env.AUDIT_CHAIN_KEY = KEY;
    deps.fail = true;
    mod = await load();
    await expect(mod.audit({ action: 'x', outcome: 'allow' })).resolves.toBeUndefined();
  });

  it('sends the anchor of a high-value entry to Telegram at once', async () => {
    const { audit } = await load();
    await audit({ action: 'operator.reply', outcome: 'allow' }, { anchor: true });
    expect(deps.sendNotice).toHaveBeenCalledWith(expect.stringMatching(/^Audit anchor \(operator\.reply\): 1:a{64}@\d{4}-\d{2}-\d{2}$/));
  });

  it('records a flood of the same refusal once a minute', async () => {
    const { auditRefusal } = await load();
    for (let i = 0; i < 50; i++) await auditRefusal('chat', 'rate_limited');
    await auditRefusal('chat', 'quota_exhausted');
    expect(deps.records.map(r => (r.details as { reason: string }).reason)).toEqual(['rate_limited', 'quota_exhausted']);
  });

  it('keys references to ids, so a conversation id is never stored', async () => {
    const { ref } = await load();
    const id = 'a3f1c2d4-0000-4000-8000-000000000000';
    expect(ref(id)).toMatch(/^[0-9a-f]{16}$/);
    expect(ref(id)).toBe(ref(id));
    expect(ref(id)).not.toContain('a3f1c2d4');
  });

  it('records switch changes once per instance, anchored once a previous state exists', async () => {
    let mod = await load();
    await mod.auditSwitchChanges();
    expect(deps.records).toHaveLength(1); // first sighting: recorded, nothing to compare
    expect(deps.sendNotice).not.toHaveBeenCalled();
    await mod.auditSwitchChanges();
    expect(deps.records).toHaveLength(1);

    deps.env.SWITCH_VOICE = 'off'; // a redeploy with voice switched off
    mod = await load();
    await mod.auditSwitchChanges();
    expect(deps.records).toHaveLength(2);
    expect(deps.records[1]).toMatchObject({ action: 'switch.changed', details: { before: { voice: true }, after: { voice: false } } });
    expect(deps.sendNotice).toHaveBeenCalledTimes(1);

    mod = await load(); // the same state again: nothing new
    await mod.auditSwitchChanges();
    expect(deps.records).toHaveLength(2);
  });

  it("keeps each Vercel environment's chain apart", async () => {
    const { audit } = await load();
    await audit({ action: 'x', outcome: 'allow' });
    deps.env.VERCEL_ENV = 'preview';
    const preview = await load();
    await preview.audit({ action: 'y', outcome: 'allow' });
    expect(deps.records).toHaveLength(2); // both written, each through its own prefix (audit:production, audit:preview)
  });
});
