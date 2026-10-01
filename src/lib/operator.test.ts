import { beforeEach, describe, expect, it, vi } from 'vitest';

const telegram = vi.hoisted(() => ({ configured: true, sendTurn: vi.fn(), sendNotice: vi.fn() }));
vi.mock('./telegram', async importOriginal => ({
  ...await importOriginal<typeof import('./telegram')>(),
  telegramConfigured: () => telegram.configured,
  sendTurn: telegram.sendTurn,
  sendNotice: telegram.sendNotice,
}));
vi.mock('./redis', () => ({ getRedis: () => null }));

import { ALERT_QUIET_S, LIVE_WINDOW_MS, alertModelFailure, describeModelFailure, formatModelAlert, goLive, holdQuestion, liveUntil, notifyTurn, resolveTelegramMessage, takeHeld, type OperatorRedis } from './operator';
import { CONV_TTL_S } from './conversation';

class FakeRedis implements OperatorRedis {
  readonly store = new Map<string, unknown>();
  readonly ttls = new Map<string, number>();
  async set(key: string, value: unknown, opts: { ex: number } | { ex: number; nx: true }) {
    if ('nx' in opts && this.store.has(key)) return null;
    this.store.set(key, value); this.ttls.set(key, opts.ex); return 'OK';
  }
  async get<T>(key: string) { return (this.store.get(key) ?? null) as T | null; }
  async del(...keys: string[]) { let n = 0; for (const key of keys) if (this.store.delete(key)) n++; return n; }
}

const cid = 'a3f1c2d4-0000-4000-8000-000000000000';
const turn = { cid, index: 1, question: 'What did he build?', answer: 'A tracker.' };

beforeEach(() => {
  telegram.configured = true;
  telegram.sendTurn.mockReset().mockResolvedValue(501);
  telegram.sendNotice.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('notifyTurn', () => {
  it('maps the sent message back to the conversation for as long as the conversation lives', async () => {
    const redis = new FakeRedis();
    await notifyTurn(turn, undefined, redis);
    expect(telegram.sendTurn.mock.calls[0][0]).toContain('What did he build?');
    expect(redis.store.get('chat:tg:501')).toEqual({ cid, q: 'What did he build?' });
    expect(redis.ttls.get('chat:tg:501')).toBe(CONV_TTL_S);
  });

  it('sends nothing when the bot is not configured', async () => {
    telegram.configured = false;
    await notifyTurn(turn, undefined, new FakeRedis());
    expect(telegram.sendTurn).not.toHaveBeenCalled();
  });

  it('writes no mapping when the send failed', async () => {
    telegram.sendTurn.mockResolvedValue(null);
    const redis = new FakeRedis();
    await notifyTurn(turn, undefined, redis);
    expect(redis.store.size).toBe(0);
  });

  it('survives a Redis failure', async () => {
    const redis = { set: vi.fn().mockRejectedValue(new Error('down')), get: vi.fn(), del: vi.fn() };
    await expect(notifyTurn(turn, undefined, redis)).resolves.toBeUndefined();
  });
});

describe('resolveTelegramMessage', () => {
  it('reads a stored mapping, object or JSON string', async () => {
    const redis = new FakeRedis();
    redis.store.set('chat:tg:1', { cid, q: 'Q' });
    redis.store.set('chat:tg:2', JSON.stringify({ cid, q: 'Q' }));
    expect(await resolveTelegramMessage(1, redis)).toEqual({ cid, q: 'Q' });
    expect(await resolveTelegramMessage(2, redis)).toEqual({ cid, q: 'Q' });
  });

  it('returns null for an unknown, corrupt or unreachable mapping', async () => {
    const redis = new FakeRedis();
    redis.store.set('chat:tg:3', 'not json');
    expect(await resolveTelegramMessage(9, redis)).toBeNull();
    expect(await resolveTelegramMessage(3, redis)).toBeNull();
    expect(await resolveTelegramMessage(1, { set: vi.fn(), get: vi.fn().mockRejectedValue(new Error('down')), del: vi.fn() })).toBeNull();
  });
});

describe('Jody live in a conversation', () => {
  it('opens a window that ends LIVE_WINDOW_MS from now and expires with it', async () => {
    const redis = new FakeRedis();
    const until = await goLive(cid, redis);
    expect(until).toBeGreaterThan(Date.now() + LIVE_WINDOW_MS - 1000);
    expect(redis.ttls.get(`chat:live:${cid}`)).toBe(LIVE_WINDOW_MS / 1000);
    expect(await liveUntil(cid, redis)).toBe(until);
  });

  it('is not live without a window, after it ends or when Redis fails', async () => {
    const redis = new FakeRedis();
    expect(await liveUntil(cid, redis)).toBeNull();
    redis.store.set(`chat:live:${cid}`, Date.now() - 1);
    expect(await liveUntil(cid, redis)).toBeNull();
    expect(await liveUntil(cid, { set: vi.fn(), get: vi.fn().mockRejectedValue(new Error('down')), del: vi.fn() })).toBeNull();
  });

  it('holds one question and hands it over once', async () => {
    const redis = new FakeRedis();
    await holdQuestion(cid, 'First', redis);
    await holdQuestion(cid, 'Second', redis);
    expect(await takeHeld(cid, redis)).toEqual({ q: 'Second', ts: expect.any(Number) });
    expect(await takeHeld(cid, redis)).toBeNull();
  });
});

describe('model failure alerts', () => {
  const capMessage = '{"error":{"code":429,"message":"Your project has exceeded its monthly spending cap."}}';

  it('recognizes the spending cap from the 429 message, and nothing else as one', () => {
    expect(describeModelFailure('gemini-3.8-flash', '429', capMessage).spendCap).toBe(true);
    expect(describeModelFailure('gemini-3.8-flash', '429', 'Resource exhausted').spendCap).toBe(false);
    expect(describeModelFailure('gemini-3.8-flash', '500', 'spending cap').spendCap).toBe(false);
  });

  it('says what to do about each cause', () => {
    expect(formatModelAlert(describeModelFailure('gemini-3.8-flash', '429', capMessage))).toContain('https://ai.studio/spend');
    expect(formatModelAlert(describeModelFailure('gemini-3.8-flash', '403', ''))).toContain('GEMINI_API_KEY');
    expect(formatModelAlert(describeModelFailure('gemini-3.8-flash', '503', ''))).toContain('503 on gemini-3.8-flash');
  });

  it('sends one alert per cause however many turns fail, then goes quiet for the window', async () => {
    const redis = new FakeRedis();
    const cap = describeModelFailure('gemini-3.8-flash', '429', capMessage);
    await alertModelFailure(cap, undefined, redis);
    await alertModelFailure(cap, undefined, redis);
    await alertModelFailure(describeModelFailure('gemini-3.6-flash', '429', capMessage), undefined, redis);
    expect(telegram.sendNotice).toHaveBeenCalledTimes(1);
    expect(redis.ttls.get('alert:model:spend-cap')).toBe(ALERT_QUIET_S);
    await alertModelFailure(describeModelFailure('gemini-3.8-flash', '503', ''), undefined, redis);
    expect(telegram.sendNotice).toHaveBeenCalledTimes(2);
  });

  it('still alerts when Redis is unavailable, and not at all without a bot', async () => {
    await alertModelFailure(describeModelFailure('gemini-3.8-flash', '500', ''), undefined, null);
    expect(telegram.sendNotice).toHaveBeenCalledTimes(1);
    telegram.configured = false;
    await alertModelFailure(describeModelFailure('gemini-3.8-flash', '500', ''), undefined, null);
    expect(telegram.sendNotice).toHaveBeenCalledTimes(1);
  });
});
