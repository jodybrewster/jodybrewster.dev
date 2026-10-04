import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real limiters on the memory store (astro dev), so the numbers, the
// shared counter and the token budget are the ones the site runs.
const environment = vi.hoisted(() => ({ values: { NODE_ENV: 'development' } as Record<string, string | undefined> }));
vi.mock('./env', () => ({ env: (key: string) => environment.values[key] }));

async function load() {
  vi.resetModules();
  return import('./limits');
}

beforeEach(() => {
  environment.values = { NODE_ENV: 'development' };
});

describe('site limits', () => {
  it('allows 5 chats a minute per visitor, then refuses on the ip rule', async () => {
    const { check, chatLimiter } = await load();
    for (let i = 0; i < 5; i++) expect((await check(chatLimiter, 'v1')).ok).toBe(true);
    expect(await check(chatLimiter, 'v1')).toMatchObject({ ok: false, code: 'rate_limited', rule: 'ip' });
    expect((await check(chatLimiter, 'v2')).ok).toBe(true);
  });

  it('refuses everyone once the 75 daily answers are spent', async () => {
    const { check, chatLimiter } = await load();
    for (let i = 0; i < 75; i++) {
      const decision = await check(chatLimiter, `visitor-${i}`);
      if (!decision.ok) throw new Error(`refused at ${i}`);
      expect(await decision.spend('global')).toBeNull();
    }
    expect(await check(chatLimiter, 'someone-new')).toMatchObject({ ok: false, code: 'quota_exhausted', rule: 'global' });
  });

  it("shares the chat's per-visitor counter with voice search", async () => {
    const { check, chatLimiter, corpusLimiter } = await load();
    for (let i = 0; i < 3; i++) expect((await check(chatLimiter, 'v1')).ok).toBe(true);
    for (let i = 0; i < 2; i++) expect((await check(corpusLimiter, 'v1')).ok).toBe(true);
    expect((await check(corpusLimiter, 'v1')).ok).toBe(false);
  });

  it('caps ask_jody at 5 an hour per visitor, 50 calls a day and a daily token budget', async () => {
    const { ASK_TOKENS_PER_DAY, askLimiter, check } = await load();
    for (let i = 0; i < 5; i++) expect((await check(askLimiter, 'v1')).ok).toBe(true);
    expect(await check(askLimiter, 'v1')).toMatchObject({ ok: false, rule: 'ip' });
    const decision = await check(askLimiter, 'v2');
    if (!decision.ok) throw new Error('refused');
    expect(await decision.spend('tokens', ASK_TOKENS_PER_DAY + 1)).toMatchObject({ ok: false, rule: 'tokens' });
    expect(await decision.spend('tokens', ASK_TOKENS_PER_DAY)).toBeNull();
    expect(await check(askLimiter, 'v3')).toMatchObject({ ok: false, code: 'quota_exhausted', rule: 'tokens' });
  });

  it('caps MCP tool calls at 20 a minute per visitor and 2,000 a day across everyone', async () => {
    const { check, mcpLimiter } = await load();
    for (let i = 0; i < 20; i++) expect((await check(mcpLimiter, 'v1')).ok).toBe(true);
    expect(await check(mcpLimiter, 'v1')).toMatchObject({ ok: false, rule: 'ip' });
    for (let i = 0; i < 1980; i++) await check(mcpLimiter, `visitor-${i % 99}-${Math.floor(i / 99)}`);
    expect(await check(mcpLimiter, 'someone-new')).toMatchObject({ ok: false, rule: 'day' });
  });

  it('allows 60 reply polls a minute per visitor', async () => {
    const { check, repliesLimiter } = await load();
    for (let i = 0; i < 60; i++) expect((await check(repliesLimiter, 'v1')).ok).toBe(true);
    expect((await check(repliesLimiter, 'v1')).ok).toBe(false);
  });

  it('refuses as unavailable on Vercel without Redis, never as allowed', async () => {
    environment.values = { NODE_ENV: 'production', VERCEL: '1' };
    const { check, chatLimiter, limitEnv } = await load();
    expect(limitEnv().RATE_LIMIT_STORE).toBe('upstash');
    expect(await check(chatLimiter, 'v1')).toMatchObject({ ok: false, code: 'unavailable' });
  });

  it("keys visitors by Vercel's client IP, IPv6 by /64, and by one bucket in dev", async () => {
    const { visitor } = await load();
    const request = (ip: string) => new Request('https://jodybrewster.dev/', { headers: { 'x-forwarded-for': ip } });
    expect(visitor(request('203.0.113.9'))).toBe('local');
    environment.values = { NODE_ENV: 'production', VERCEL: '1' };
    expect(visitor(request('203.0.113.9, 10.0.0.1'))).toBe('203.0.113.9');
    expect(visitor(request('2001:db8:1:2:3:4:5:6'))).toBe(visitor(request('2001:db8:1:2:ffff:4:5:6')));
  });
});
