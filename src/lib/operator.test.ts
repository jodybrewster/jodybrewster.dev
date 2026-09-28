import { beforeEach, describe, expect, it, vi } from 'vitest';

const telegram = vi.hoisted(() => ({ configured: true, sendTurn: vi.fn() }));
vi.mock('./telegram', async importOriginal => ({
  ...await importOriginal<typeof import('./telegram')>(),
  telegramConfigured: () => telegram.configured,
  sendTurn: telegram.sendTurn,
}));
vi.mock('./redis', () => ({ getRedis: () => null }));

import { notifyTurn, resolveTelegramMessage, type OperatorRedis } from './operator';
import { CONV_TTL_S } from './conversation';

class FakeRedis implements OperatorRedis {
  readonly store = new Map<string, unknown>();
  readonly ttls = new Map<string, number>();
  async set(key: string, value: unknown, opts: { ex: number }) { this.store.set(key, value); this.ttls.set(key, opts.ex); return 'OK'; }
  async get<T>(key: string) { return (this.store.get(key) ?? null) as T | null; }
}

const cid = 'a3f1c2d4-0000-4000-8000-000000000000';
const turn = { cid, index: 1, question: 'What did he build?', answer: 'A tracker.' };

beforeEach(() => {
  telegram.configured = true;
  telegram.sendTurn.mockReset().mockResolvedValue(501);
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
    const redis = { set: vi.fn().mockRejectedValue(new Error('down')), get: vi.fn() };
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
    expect(await resolveTelegramMessage(1, { set: vi.fn(), get: vi.fn().mockRejectedValue(new Error('down')) })).toBeNull();
  });
});
