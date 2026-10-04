import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({ secret: 'a-long-cron-secret-value' as string | undefined, head: vi.fn(), sendAnchor: vi.fn() }));
vi.mock('../env', () => ({ env: (key: string) => (key === 'CRON_SECRET' ? deps.secret : undefined) }));
vi.mock('../audit', () => ({ auditHead: deps.head, sendAnchor: deps.sendAnchor }));

import { GET } from '../../pages/api/cron/audit-anchor';

const call = (auth?: string) =>
  GET({ request: new Request('https://jodybrewster.dev/api/cron/audit-anchor', { headers: auth ? { authorization: auth } : {} }) } as Parameters<typeof GET>[0]) as Promise<Response>;

beforeEach(() => {
  deps.secret = 'a-long-cron-secret-value';
  deps.head.mockReset().mockResolvedValue({ seq: 7, hash: 'f'.repeat(64) });
  deps.sendAnchor.mockReset().mockResolvedValue(undefined);
});

describe('GET /api/cron/audit-anchor', () => {
  it("sends the newest entry's anchor with Vercel's bearer secret", async () => {
    expect((await call('Bearer a-long-cron-secret-value')).status).toBe(200);
    expect(deps.sendAnchor).toHaveBeenCalledWith({ seq: 7, hash: 'f'.repeat(64) }, 'daily');
  });

  it('refuses a missing or wrong secret, and any secret under 16 characters', async () => {
    expect((await call()).status).toBe(401);
    expect((await call('Bearer wrong-secret-value-xxxx')).status).toBe(401);
    deps.secret = 'short';
    expect((await call('Bearer short')).status).toBe(401);
    deps.secret = undefined;
    expect((await call('Bearer ')).status).toBe(401);
    expect(deps.sendAnchor).not.toHaveBeenCalled();
  });
});
