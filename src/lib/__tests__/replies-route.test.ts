import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({ readReplies: vi.fn(), liveUntil: vi.fn() }));
vi.mock('../flags', () => ({ flags: { chat: true } }));
vi.mock('../conversation', () => ({ readReplies: deps.readReplies }));
vi.mock('../operator', () => ({ liveUntil: deps.liveUntil }));

import { GET } from '../../pages/api/replies';

const cid = 'a3f1c2d4-0000-4000-8000-000000000000';
const get = (query: string) =>
  GET({ url: new URL(`https://jodybrewster.dev/api/replies${query}`) } as Parameters<typeof GET>[0]) as Promise<Response>;

beforeEach(() => {
  deps.readReplies.mockReset().mockResolvedValue([{ t: 'Hi', ts: 5, q: 'Q' }]);
  deps.liveUntil.mockReset().mockResolvedValue(99);
});

describe('GET /api/replies', () => {
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
