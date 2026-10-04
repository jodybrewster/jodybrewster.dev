import { beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  create: vi.fn(), searchVectors: vi.fn(), getChunkText: vi.fn(), getRedis: vi.fn(),
  mcpIp: vi.fn(), askIp: vi.fn(), askGlobal: vi.fn(), environment: 'production' as string | undefined,
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: dependencies.create }; },
}));
vi.mock('../rag', () => ({ searchVectors: dependencies.searchVectors, getChunkText: dependencies.getChunkText }));
vi.mock('../corpus', () => ({ listCollection: vi.fn(async () => []), readDoc: vi.fn(async () => null), readNowFile: vi.fn(async () => null) }));
vi.mock('../redis', () => ({ getRedis: dependencies.getRedis }));
vi.mock('../env', () => ({ env: (key: string) => (key === 'VERCEL_ENV' ? dependencies.environment : undefined) }));
vi.mock('../rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rate-limit')>();
  return {
    ...actual,
    clientIp: () => 'test-ip',
    getMcpIpLimiter: () => ({ limit: dependencies.mcpIp }),
    getAskIpLimiter: () => ({ limit: dependencies.askIp }),
    getAskGlobalLimiter: () => ({ limit: dependencies.askGlobal }),
  };
});

import { POST } from '../../pages/api/mcp';

const ok = { success: true };
const ask = (id: number, question = 'What does Jody write about?') => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'ask_jody', arguments: { question } } });
async function post(body: unknown, headers: Record<string, string> = {}) {
  const request = new Request('https://jodybrewster.dev/api/mcp', {
    method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers },
  });
  return await POST({ request } as Parameters<typeof POST>[0]) as Response;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  dependencies.environment = 'production';
  dependencies.getRedis.mockReturnValue({});
  dependencies.mcpIp.mockResolvedValue(ok);
  dependencies.askIp.mockResolvedValue(ok);
  dependencies.askGlobal.mockResolvedValue(ok);
  dependencies.searchVectors.mockResolvedValue([]);
  dependencies.create.mockResolvedValue({ content: [{ type: 'text', text: 'answer' }], usage: { input_tokens: 10, output_tokens: 10 } });
});

describe('POST /api/mcp', () => {
  it('never turns one request into many model calls: batches are refused', async () => {
    const response = await post(Array.from({ length: 20 }, (_, i) => ask(i)));
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe('Batching is not supported');
    expect(dependencies.create).not.toHaveBeenCalled();
  });

  it('answers a single ask_jody call after spending it against all three limits', async () => {
    const response = await post(ask(1));
    expect(response.status).toBe(200);
    expect((await response.json()).result.content[0].text).toContain('answer');
    expect(dependencies.mcpIp).toHaveBeenCalledWith('test-ip');
    expect(dependencies.askIp).toHaveBeenCalledWith('test-ip');
    expect(dependencies.askGlobal).toHaveBeenCalledWith('global');
    expect(dependencies.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the per-IP tool limit', 'mcpIp'],
    ['the per-IP ask_jody limit', 'askIp'],
    ['the site-wide ask_jody cap', 'askGlobal'],
  ] as const)('refuses with 429 at %s, before any model call', async (_, which) => {
    dependencies[which].mockResolvedValue({ success: false });
    const response = await post(ask(1));
    expect(response.status).toBe(429);
    expect((await response.json()).error.message).toMatch(/Rate limit/);
    expect(dependencies.create).not.toHaveBeenCalled();
  });

  it('fails closed: no Redis on a deployment, a limiter timeout or a limiter error', async () => {
    dependencies.getRedis.mockReturnValue(null);
    expect((await post(ask(1))).status).toBe(503);
    dependencies.environment = 'preview';
    expect((await post(ask(2))).status).toBe(503);
    dependencies.environment = 'production';
    dependencies.getRedis.mockReturnValue({});
    dependencies.mcpIp.mockResolvedValue({ success: true, reason: 'timeout' });
    expect((await post(ask(3))).status).toBe(503);
    dependencies.mcpIp.mockImplementation(() => { throw new Error('redis down'); });
    expect((await post(ask(4))).status).toBe(503);
    expect(dependencies.create).not.toHaveBeenCalled();
  });

  it('runs without Redis only in local dev', async () => {
    dependencies.environment = undefined;
    dependencies.getRedis.mockReturnValue(null);
    expect((await post(ask(1))).status).toBe(200);
  });

  it('refuses after the deadline when a limiter hangs', async () => {
    vi.useFakeTimers();
    dependencies.mcpIp.mockReturnValue(new Promise(() => {}));
    const pending = post(ask(1));
    await vi.advanceTimersByTimeAsync(4_001);
    expect((await pending).status).toBe(503);
    expect(dependencies.create).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('limits cheap tools per IP too, but not with the ask_jody caps', async () => {
    await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'whats_top_of_mind', arguments: {} } });
    expect(dependencies.mcpIp).toHaveBeenCalledTimes(1);
    expect(dependencies.askIp).not.toHaveBeenCalled();
  });

  it('checks the question before spending any limit, so junk cannot drain the cap', async () => {
    const empty = await (await post(ask(1, '   '))).json();
    expect(empty.result.isError).toBe(true);
    await post(ask(2, 'x'.repeat(601)));
    expect(dependencies.mcpIp).not.toHaveBeenCalled();
    expect(dependencies.askGlobal).not.toHaveBeenCalled();
  });

  it('caps the question and the search query at 600 characters', async () => {
    const long = await (await post(ask(1, 'x'.repeat(601)))).json();
    expect(long.result.isError).toBe(true);
    const search = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_writing', arguments: { query: 'y'.repeat(601) } } })).json();
    expect(search.result.isError).toBe(true);
    expect(dependencies.create).not.toHaveBeenCalled();
    expect(dependencies.searchVectors).not.toHaveBeenCalled();
  });

  it("refuses other sites' pages and non-JSON bodies, which need no CORS preflight", async () => {
    expect((await post(ask(1), { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(ask(2), { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect(dependencies.create).not.toHaveBeenCalled();
    // The site itself and server-side clients (no Origin) are fine.
    expect((await post(ask(3), { Origin: 'https://jodybrewster.dev' })).status).toBe(200);
  });

  it('refuses oversized and malformed bodies', async () => {
    expect((await post({ ...ask(1), pad: 'z'.repeat(20_000) })).status).toBe(413);
    expect((await post('{nope')).status).toBe(400);
    expect((await post({ jsonrpc: '2.0', id: 1 })).status).toBe(400);
  });

  it('does not pass an internal error message to the caller', async () => {
    dependencies.create.mockRejectedValue(new Error('upstream detail: key sk-ant-xyz'));
    const body = await (await post(ask(1))).json();
    expect(body.error.message).toBe('Internal error');
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('sk-ant-xyz');
  });

  it('still serves initialize and tools/list without spending limits', async () => {
    const init = await (await post({ jsonrpc: '2.0', id: 1, method: 'initialize' })).json();
    expect(init.result.protocolVersion).toBe('2025-06-18');
    const list = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toContain('ask_jody');
    expect(dependencies.mcpIp).not.toHaveBeenCalled();
  });
});
