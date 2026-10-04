import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({ secret: 'a-long-cron-secret-value' as string | undefined, daily: vi.fn(), sendNotice: vi.fn() }));
vi.mock('../env', () => ({ env: (key: string) => (key === 'CRON_SECRET' ? deps.secret : undefined) }));
vi.mock('../audit', () => ({ dailyAudit: deps.daily }));
vi.mock('../telegram', () => ({ sendNotice: deps.sendNotice }));

import { GET } from '../../pages/api/cron/audit-anchor';

const call = (auth?: string) =>
  GET({ request: new Request('https://jodybrewster.dev/api/cron/audit-anchor', { headers: auth ? { authorization: auth } : {} }) } as Parameters<typeof GET>[0]) as Promise<Response>;

beforeEach(() => {
  deps.secret = 'a-long-cron-secret-value';
  deps.daily.mockReset().mockResolvedValue('Anchor sent');
  deps.sendNotice.mockReset().mockResolvedValue(undefined);
});

describe('GET /api/cron/audit-anchor', () => {
  it("runs the daily audit with Vercel's bearer secret", async () => {
    const response = await call('Bearer a-long-cron-secret-value');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Anchor sent');
  });

  it('refuses a missing or wrong secret, and any secret under 16 characters', async () => {
    expect((await call()).status).toBe(401);
    expect((await call('Bearer wrong-secret-value-xxxx')).status).toBe(401);
    deps.secret = 'short';
    expect((await call('Bearer short')).status).toBe(401);
    deps.secret = undefined;
    expect((await call('Bearer ')).status).toBe(401);
    expect(deps.daily).not.toHaveBeenCalled();
  });

  it('tells Jody when the heartbeat fails, so silence never looks like a quiet day', async () => {
    deps.daily.mockRejectedValue(new Error('store down'));
    expect((await call('Bearer a-long-cron-secret-value')).status).toBe(500);
    expect(deps.sendNotice).toHaveBeenCalledWith(expect.stringMatching(/heartbeat failed: store down/));
  });
});
