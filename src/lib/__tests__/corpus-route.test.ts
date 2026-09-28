import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  searchVectors: vi.fn(), getChunkText: vi.fn(), getRedis: vi.fn(), getIpLimiter: vi.fn(),
  isOriginAllowed: vi.fn(), environment: 'production' as string | undefined, chat: true,
}));
vi.mock('../rag', () => ({ searchVectors: dependencies.searchVectors, getChunkText: dependencies.getChunkText }));
vi.mock('../redis', () => ({ getRedis: dependencies.getRedis }));
vi.mock('../rate-limit', () => ({
  getIpLimiter: dependencies.getIpLimiter, clientIp: () => 'test-ip', isOriginAllowed: dependencies.isOriginAllowed,
}));
vi.mock('../flags', () => ({ flags: { get chat() { return dependencies.chat; } } }));
vi.mock('../env', () => ({ env: (key: string) => key === 'VERCEL_ENV' ? dependencies.environment : undefined }));

import { POST } from '../../pages/api/corpus';

const never = () => new Promise<never>(() => {});
const hit = (type: string, slug: string, chunk = 0) => ({
  id: `${type}:${slug}#${chunk}`, score: 0.9,
  metadata: { type, slug, chunk, title: slug.toUpperCase(), date: '2026-01-01', url: `/${type}/${slug}` },
});
async function post(body: unknown = { query: 'PRIVATE QUERY' }) {
  const request = new Request('https://jodybrewster.dev/api/corpus', {
    method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Origin: 'https://jodybrewster.dev' },
  });
  return await POST({ request } as Parameters<typeof POST>[0]) as Response;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  dependencies.environment = 'production';
  dependencies.chat = true;
  dependencies.getRedis.mockReturnValue({});
  dependencies.getIpLimiter.mockReturnValue(null);
  dependencies.isOriginAllowed.mockReturnValue(true);
  dependencies.searchVectors.mockResolvedValue([]);
  dependencies.getChunkText.mockResolvedValue('chunk text');
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('POST /api/corpus', () => {
  it('returns deduplicated top results with slugs, urls and capped text', async () => {
    dependencies.searchVectors.mockResolvedValue([
      hit('work', 'lennar-interactive-maps'), hit('work', 'lennar-interactive-maps', 1),
      hit('research', 'a'), hit('writing', 'b'), hit('notes', 'c'), hit('portfolio', 'd'), hit('research', 'e'),
    ]);
    dependencies.getChunkText.mockImplementation(async (meta: { slug: string }) => meta.slug === 'a' ? 'word '.repeat(600) : `text for ${meta.slug}`);
    const response = await post();
    expect(response.status).toBe(200);
    const { results } = await response.json();
    expect(results).toHaveLength(5);
    expect(results[0]).toEqual({ type: 'work', slug: 'lennar-interactive-maps', title: 'LENNAR-INTERACTIVE-MAPS', url: '/work/lennar-interactive-maps', text: 'text for lennar-interactive-maps' });
    expect(results.map((r: { slug: string }) => r.slug)).toEqual(['lennar-interactive-maps', 'a', 'b', 'c', 'd']);
    expect(results[1].text.length).toBeLessThanOrEqual(1203);
    expect(dependencies.searchVectors.mock.calls[0][0]).toBe('PRIVATE QUERY');
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain('PRIVATE QUERY');
  });

  it('skips a result whose text is no longer published', async () => {
    dependencies.searchVectors.mockResolvedValue([hit('work', 'gone'), hit('notes', 'kept')]);
    dependencies.getChunkText.mockImplementation(async (meta: { slug: string }) => {
      if (meta.slug === 'gone') throw new Error('unpublished'); return 'kept text';
    });
    const { results } = await (await post()).json();
    expect(results.map((r: { slug: string }) => r.slug)).toEqual(['kept']);
  });

  it.each([null, [], 'hello', { query: 42 }, { query: '   ' }])('rejects malformed body %j', async body => {
    expect((await post(body)).status).toBe(400);
    expect(dependencies.searchVectors).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON and overlong queries', async () => {
    expect((await post('{not json')).status).toBe(400);
    expect((await post({ query: 'x'.repeat(601) })).status).toBe(413);
  });

  it('is gated by the chat flag and the origin check', async () => {
    dependencies.isOriginAllowed.mockReturnValue(false);
    expect((await post()).status).toBe(403);
    dependencies.chat = false;
    expect((await post()).status).toBe(404);
    expect(dependencies.searchVectors).not.toHaveBeenCalled();
  });

  it('refuses in production without Redis, but runs locally without it', async () => {
    dependencies.getRedis.mockReturnValue(null);
    expect((await post()).status).toBe(503);
    dependencies.environment = undefined;
    expect((await post()).status).toBe(200);
  });

  it('rate limits per IP', async () => {
    dependencies.getIpLimiter.mockReturnValue({ limit: vi.fn().mockResolvedValue({ success: false }) });
    expect((await post()).status).toBe(429);
    dependencies.getIpLimiter.mockReturnValue({ limit: vi.fn().mockResolvedValue({ success: false, reason: 'timeout' }) });
    expect((await post()).status).toBe(503);
    expect(dependencies.searchVectors).not.toHaveBeenCalled();
  });

  it('bounds a hanging limiter and a hanging search with 503s', async () => {
    vi.useFakeTimers();
    dependencies.getIpLimiter.mockReturnValue({ limit: never });
    const limited: { response?: Response } = {};
    void post().then(value => { limited.response = value; });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(limited.response?.status).toBe(503);
    dependencies.getIpLimiter.mockReturnValue(null);
    dependencies.searchVectors.mockImplementation(never);
    const searched: { response?: Response } = {};
    void post().then(value => { searched.response = value; });
    await vi.advanceTimersByTimeAsync(16_000);
    expect(searched.response?.status).toBe(503);
    expect(dependencies.searchVectors.mock.calls[0][3].aborted).toBe(true);
  });
});
