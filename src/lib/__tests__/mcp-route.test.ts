import { beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => {
  const MCP = () => null;
  const ASK = () => null;
  return {
    MCP, ASK, create: vi.fn(), searchVectors: vi.fn(), getChunkText: vi.fn(), check: vi.fn(),
    mcp: null as unknown, ask: null as unknown, environment: 'production' as string | undefined, askOn: true,
  };
});
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: dependencies.create }; },
}));
vi.mock('../rag', () => ({ searchVectors: dependencies.searchVectors, getChunkText: dependencies.getChunkText }));
vi.mock('../corpus', () => ({ listCollection: vi.fn(async () => []), readDoc: vi.fn(async () => null), readNowFile: vi.fn(async () => null) }));
vi.mock('../env', () => ({ env: (key: string) => (key === 'VERCEL_ENV' ? dependencies.environment : undefined) }));
vi.mock('../switches', async (importOriginal) => ({ ...(await importOriginal<typeof import('../switches')>()), isOn: async () => dependencies.askOn }));
vi.mock('../limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../limits')>()),
  check: dependencies.check,
  visitor: () => 'test-ip',
  mcpLimiter: dependencies.MCP,
  askLimiter: dependencies.ASK,
}));

import { POST } from '../../pages/api/mcp';

const allowed = () => ({ ok: true, spend: vi.fn().mockResolvedValue(null), refund: vi.fn(), charge: vi.fn(), release: vi.fn() });
const refused = (code: string, rule = 'ip') => ({ ok: false, code, rule, retryAfterSeconds: 60 });
type Fake = ReturnType<typeof allowed>;
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
  dependencies.askOn = true;
  dependencies.mcp = allowed();
  dependencies.ask = allowed();
  dependencies.check.mockImplementation(async (limiter: unknown) => (limiter === dependencies.MCP ? dependencies.mcp : dependencies.ask));
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

  it('answers ask_jody after spending a call and reserving its worst case, then settles from usage', async () => {
    const response = await post(ask(1));
    expect(response.status).toBe(200);
    expect((await response.json()).result.content[0].text).toContain('answer');
    expect(dependencies.check).toHaveBeenNthCalledWith(1, dependencies.MCP, 'test-ip');
    expect(dependencies.check).toHaveBeenNthCalledWith(2, dependencies.ASK, 'test-ip');
    const a = dependencies.ask as Fake;
    expect(a.spend).toHaveBeenNthCalledWith(1, 'calls');
    const [rules, reserved] = a.spend.mock.calls[1];
    expect(rules).toEqual(['tokens']);
    expect(reserved).toBeGreaterThan(1024);
    // 20 tokens used, so the rest of the reservation goes back.
    expect(a.refund).toHaveBeenCalledWith(['tokens'], reserved - 20);
    expect(a.spend.mock.invocationCallOrder[1]).toBeLessThan(dependencies.create.mock.invocationCallOrder[0]);
  });

  it('refuses with 429 at the per-IP tool rate or the ask_jody rate, before any model call', async () => {
    dependencies.mcp = refused('rate_limited');
    expect((await post(ask(1))).status).toBe(429);
    dependencies.mcp = allowed();
    dependencies.ask = refused('rate_limited');
    expect((await post(ask(2))).status).toBe(429);
    expect(dependencies.create).not.toHaveBeenCalled();
  });

  it("stops when the day's calls or tokens are gone, giving the call back if the tokens refuse", async () => {
    const a = dependencies.ask as Fake;
    a.spend.mockResolvedValueOnce(refused('quota_exhausted', 'calls'));
    expect((await (await post(ask(1))).json()).result.isError).toBe(true);
    a.spend.mockResolvedValueOnce(null).mockResolvedValueOnce(refused('quota_exhausted', 'tokens'));
    expect((await (await post(ask(2))).json()).result.isError).toBe(true);
    expect(a.refund).toHaveBeenCalledWith('calls');
    expect(dependencies.create).not.toHaveBeenCalled();
  });

  it('keeps the reservation when the model call fails, since it may have been billed', async () => {
    dependencies.create.mockRejectedValue(new Error('upstream detail: key sk-ant-xyz'));
    const body = await (await post(ask(1))).json();
    expect(body.error.message).toBe('Internal error');
    expect((dependencies.ask as Fake).refund).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('sk-ant-xyz');
  });

  it('answers ask_jody with the paused copy when its switch is off, spending nothing', async () => {
    dependencies.askOn = false;
    const body = await (await post(ask(1))).json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/paused/);
    expect(dependencies.check).not.toHaveBeenCalled();
    expect(dependencies.create).not.toHaveBeenCalled();
  });

  it('fails closed with 503 when the limits are unavailable', async () => {
    dependencies.mcp = refused('unavailable', 'store');
    expect((await post(ask(1))).status).toBe(503);
    expect(dependencies.create).not.toHaveBeenCalled();
  });

  it('limits cheap tools per IP too, but not with the ask_jody limits', async () => {
    await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'whats_top_of_mind', arguments: {} } });
    expect(dependencies.check).toHaveBeenCalledTimes(1);
    expect(dependencies.check).toHaveBeenCalledWith(dependencies.MCP, 'test-ip');
  });

  it('checks the question before spending any limit, so junk cannot drain the cap', async () => {
    expect((await (await post(ask(1, '   '))).json()).result.isError).toBe(true);
    expect((await (await post(ask(2, 'x'.repeat(601)))).json()).result.isError).toBe(true);
    const search = await (await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_writing', arguments: { query: 'y'.repeat(601) } } })).json();
    expect(search.result.isError).toBe(true);
    expect(dependencies.check).not.toHaveBeenCalled();
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

  it('still serves initialize and tools/list without spending limits', async () => {
    const init = await (await post({ jsonrpc: '2.0', id: 1, method: 'initialize' })).json();
    expect(init.result.protocolVersion).toBe('2025-06-18');
    const list = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toContain('ask_jody');
    expect(dependencies.check).not.toHaveBeenCalled();
  });
});
