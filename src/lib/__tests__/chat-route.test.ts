import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  searchVectors: vi.fn(), getChunkText: vi.fn(), getRedis: vi.fn(),
  getIpLimiter: vi.fn(), getGlobalLimiter: vi.fn(),
  isOperatorOnline: vi.fn(), readHistory: vi.fn(), conversationLength: vi.fn(),
  appendTurn: vi.fn(), putFinal: vi.fn(), putPending: vi.fn(), claim: vi.fn(),
  getReply: vi.fn(), closeHandoff: vi.fn(), mapTelegramMessage: vi.fn(), setLastQuestion: vi.fn(),
  sendQuestion: vi.fn(), announceLapse: vi.fn(), modelStream: vi.fn(),
}));
vi.mock('../rag', () => ({ searchVectors: dependencies.searchVectors, getChunkText: dependencies.getChunkText }));
vi.mock('../redis', () => ({ getRedis: dependencies.getRedis }));
vi.mock('../rate-limit', () => ({
  getIpLimiter: dependencies.getIpLimiter, getGlobalLimiter: dependencies.getGlobalLimiter,
  clientIp: () => 'test-ip', isOriginAllowed: () => true,
}));
vi.mock('../handoff', () => ({
  ...dependencies, HANDOFF_WINDOW_MS: 20_000, POLL_INTERVAL_MS: 1200,
}));
vi.mock('../telegram', () => ({
  telegramConfigured: () => true, formatQuestionMessage: () => 'question', sendQuestion: dependencies.sendQuestion,
}));
vi.mock('../../pages/api/telegram', () => ({ announceLapse: dependencies.announceLapse }));
vi.mock('../flags', () => ({ flags: { chat: true } }));
vi.mock('../env', () => ({ env: (key: string) => key === 'VERCEL_ENV' ? 'production' : 'test-key' }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { stream: dependencies.modelStream }; },
}));

import { POST } from '../../pages/api/chat';

const never = () => new Promise<never>(() => {});
function model(chunks: string[] = ['An answer.'], stall = false) {
  const abort = vi.fn();
  const iterator = (async function* () {
    for (const text of chunks) yield { type: 'content_block_delta', delta: { type: 'text_delta', text } };
    if (stall) await never();
  })();
  return Object.assign(iterator, { abort, on: vi.fn() });
}
async function post(body: unknown = { query: 'PRIVATE QUESTION' }, signal?: AbortSignal) {
  const request = new Request('https://jodybrewster.dev/api/chat', {
    method: 'POST', body: JSON.stringify(body), signal,
    headers: { 'Content-Type': 'application/json', Origin: 'https://jodybrewster.dev' },
  });
  return await POST({ request } as Parameters<typeof POST>[0]) as Response;
}
function consume(response: Response) {
  const state = { settled: false, text: '' };
  void response.text().then(text => { state.text = text; state.settled = true; });
  return state;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  dependencies.getRedis.mockReturnValue({});
  dependencies.getIpLimiter.mockReturnValue(null);
  dependencies.getGlobalLimiter.mockReturnValue(null);
  dependencies.searchVectors.mockResolvedValue([]);
  dependencies.getChunkText.mockResolvedValue('source');
  dependencies.isOperatorOnline.mockResolvedValue(false);
  dependencies.readHistory.mockResolvedValue([]);
  dependencies.conversationLength.mockResolvedValue(0);
  dependencies.claim.mockResolvedValue(true);
  dependencies.getReply.mockResolvedValue(null);
  dependencies.sendQuestion.mockResolvedValue(42);
  dependencies.announceLapse.mockResolvedValue(undefined);
  dependencies.modelStream.mockImplementation(() => model());
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('POST /api/chat reliability', () => {
  it.each([null, [], 'hello', { query: 42 }, { query: {} }])('rejects malformed JSON shape %j without throwing', async body => {
    const response = await post(body);
    expect(response.status).toBe(400);
  });

  it('ends a stalled retrieval with a retryable error before the platform timeout', async () => {
    dependencies.searchVectors.mockImplementation(never);
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(20_000);
    expect(state.settled).toBe(true);
    expect(state.text).toMatch(/"error":.*[Tt]ry again/);
    expect(state.text).not.toContain('"done":true');
    expect(dependencies.modelStream).not.toHaveBeenCalled();
    expect(dependencies.searchVectors.mock.calls[0][3].aborted).toBe(true);
  });

  it('aborts a model that never produces its first event', async () => {
    const stalled = model([], true);
    dependencies.modelStream.mockReturnValue(stalled);
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.settled).toBe(true);
    expect(state.text).toMatch(/"error":.*[Tt]ry again/);
    expect(stalled.abort).toHaveBeenCalled();
  });

  it('aborts model generation and closes promptly when the request disconnects', async () => {
    const disconnect = new AbortController();
    const stalled = model([], true);
    dependencies.modelStream.mockReturnValue(stalled);
    const state = consume(await post(undefined, disconnect.signal));
    await vi.advanceTimersByTimeAsync(0);
    disconnect.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.settled).toBe(true);
    expect(stalled.abort).toHaveBeenCalled();
    expect(dependencies.putFinal).not.toHaveBeenCalled();
  });

  it('cancels upstream work when the response reader is cancelled', async () => {
    const stalled = model([], true);
    dependencies.modelStream.mockReturnValue(stalled);
    const response = await post();
    await vi.advanceTimersByTimeAsync(0);
    void response.body!.cancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(stalled.abort).toHaveBeenCalled();
  });

  it('does not start the model after disconnected retrieval eventually resolves', async () => {
    let finish!: (hits: []) => void;
    dependencies.searchVectors.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const disconnect = new AbortController();
    const state = consume(await post(undefined, disconnect.signal));
    await vi.advanceTimersByTimeAsync(0);
    disconnect.abort();
    finish([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.settled).toBe(true);
    expect(dependencies.modelStream).not.toHaveBeenCalled();
  });

  it('closes a complete answer even when persistence hangs', async () => {
    dependencies.appendTurn.mockImplementation(never);
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(6_000);
    expect(state.settled).toBe(true);
    expect(state.text).toContain('An answer.');
    expect(state.text).toContain('"done":true');
    expect(dependencies.putFinal).not.toHaveBeenCalled();
  });

  it('fails closed before model billing if the daily-budget guard fails', async () => {
    dependencies.getGlobalLimiter.mockReturnValue({
      getRemaining: vi.fn().mockResolvedValue({ remaining: 10 }),
      limit: vi.fn().mockRejectedValue(new Error('redis unavailable')),
    });
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(0);
    expect(state.settled).toBe(true);
    expect(state.text).toContain('"error":');
    expect(dependencies.modelStream).not.toHaveBeenCalled();
  });

  it('bounds a hanging pre-stream rate limit with a 503 response', async () => {
    dependencies.getIpLimiter.mockReturnValue({ limit: never });
    let response: Response | undefined;
    void post().then(value => { response = value; });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(response?.status).toBe(503);
    expect(dependencies.searchVectors).not.toHaveBeenCalled();
  });

  it('emits successful completion, persists the conversation, and logs metadata without question text', async () => {
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(0);
    expect(state.settled).toBe(true);
    expect(state.text).toContain('"done":true');
    expect(dependencies.appendTurn).toHaveBeenCalledTimes(2);
    expect(dependencies.putFinal).toHaveBeenCalledTimes(1);
    const logs = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(logs).toContain('retrieval');
    expect(logs).toContain('elapsedMs');
    expect(logs).toContain('mid');
    expect(logs).not.toContain('PRIVATE QUESTION');
  });

  it('plays a human reply and abandons speculative retrieval without model billing', async () => {
    dependencies.isOperatorOnline.mockResolvedValue(true);
    dependencies.searchVectors.mockImplementation(never);
    dependencies.getReply.mockResolvedValue('A human reply.');
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.settled).toBe(true);
    expect(state.text).toContain('A human reply.');
    expect(state.text).toContain('"done":true');
    expect(dependencies.modelStream).not.toHaveBeenCalled();
    expect(dependencies.closeHandoff).toHaveBeenCalledOnce();
  });

  it('falls back after the human window closes', async () => {
    dependencies.isOperatorOnline.mockResolvedValue(true);
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(21_000);
    expect(state.settled).toBe(true);
    expect(state.text).toContain('An answer.');
    expect(dependencies.claim).toHaveBeenCalledWith(expect.any(String), 'llm');
  });

  it('does not overwrite an unsettled human claim with a model answer', async () => {
    dependencies.isOperatorOnline.mockResolvedValue(true);
    dependencies.claim.mockResolvedValue(false);
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(21_000);
    expect(state.settled).toBe(true);
    expect(state.text).toContain('"error":');
    expect(dependencies.modelStream).not.toHaveBeenCalled();
  });
});
