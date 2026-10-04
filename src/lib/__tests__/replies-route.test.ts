import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({ readReplies: vi.fn(), liveUntil: vi.fn(), check: vi.fn() }));
vi.mock('../flags', () => ({ flags: { chat: true } }));
vi.mock('../conversation', () => ({ readReplies: deps.readReplies }));
vi.mock('../operator', () => ({ liveUntil: deps.liveUntil }));
vi.mock('../limits', () => ({ check: deps.check, repliesLimiter: () => null, visitor: () => 'test-ip' }));

import { GET } from '../../pages/api/replies';

const cid = 'a3f1c2d4-0000-4000-8000-000000000000';
const get = (query: string) =>
  GET({ url: new URL(`https://jodybrewster.dev/api/replies${query}`), request: new Request(`https://jodybrewster.dev/api/replies${query}`) } as Parameters<typeof GET>[0]) as Promise<Response>;

beforeEach(() => {
  deps.readReplies.mockReset().mockResolvedValue([{ t: 'Hi', ts: 5, q: 'Q' }]);
  deps.liveUntil.mockReset().mockResolvedValue(99);
  deps.check.mockReset().mockResolvedValue({ ok: true });
});

describe('GET /api/replies', () => {
  it('limits polling per visitor, refusing before touching Redis', async () => {
    deps.check.mockResolvedValue({ ok: false, code: 'rate_limited', rule: 'ip', retryAfterSeconds: 42 });
    const limited = await get(`?cid=${cid}`);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('42');
    deps.check.mockResolvedValue({ ok: false, code: 'unavailable', rule: 'store', retryAfterSeconds: 30 });
    expect((await get(`?cid=${cid}`)).status).toBe(503);
    expect(deps.readReplies).not.toHaveBeenCalled();
  });

  it('returns the replies in a conversation, uncached', async () => {
    const response = await get(`?cid=${cid}`);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ replies: [{ t: 'Hi', ts: 5, q: 'Q' }], liveUntil: 99 });
    expect(deps.readReplies).toHaveBeenCalledWith(cid);
  });

  it.each(['', '?cid=', '?cid=chat:conv:*', '?cid=not-a-uuid'])('rejects %j before touching Redis', async query => {
    expect((await get(query)).status).toBe(400);
    expect(deps.readReplies).not.toHaveBeenCalled();
  });
});
