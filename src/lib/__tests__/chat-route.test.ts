import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  searchVectors: vi.fn(), getChunkText: vi.fn(), getRedis: vi.fn(),
  check: vi.fn(), spend: vi.fn(), chatOn: true, switchChat: undefined as string | undefined, auditSwitchChanges: vi.fn(),
  readHistory: vi.fn(), conversationLength: vi.fn(), appendTurn: vi.fn(),
  generateContentStream: vi.fn(), buildCardIndex: vi.fn(), notifyTurn: vi.fn(), logEntries: vi.fn(), generateContent: vi.fn(),
  liveUntil: vi.fn(), holdQuestion: vi.fn(), takeHeld: vi.fn(), alertModelFailure: vi.fn(),
}));
vi.mock('../operator', async importOriginal => ({
  describeModelFailure: (await importOriginal<typeof import('../operator')>()).describeModelFailure,
  notifyTurn: dependencies.notifyTurn, liveUntil: dependencies.liveUntil,
  holdQuestion: dependencies.holdQuestion, takeHeld: dependencies.takeHeld,
  alertModelFailure: dependencies.alertModelFailure,
}));
vi.mock('../transcripts', () => ({ logEntries: dependencies.logEntries }));
vi.mock('../cards', () => ({ buildCardIndex: dependencies.buildCardIndex }));
vi.mock('../rag', () => ({ searchVectors: dependencies.searchVectors, getChunkText: dependencies.getChunkText }));
vi.mock('../redis', () => ({ getRedis: dependencies.getRedis }));
vi.mock('../origin', async (importOriginal) => ({ ...(await importOriginal<typeof import('../origin')>()), isOriginAllowed: () => true }));
// isOn reads SWITCH_CHAT as the site does; chatOn = false stands in for a switch that cannot be read.
vi.mock('../switches', async (importOriginal) => {
  const original = await importOriginal<typeof import('../switches')>();
  const { createSwitches } = await import('@jodybrewster/gemini-live/server/switches');
  return {
    ...original,
    isOn: async (name: Parameters<typeof original.isOn>[0]) => dependencies.chatOn && createSwitches({ env: original.switchEnv() }).isOn(name),
  };
});
vi.mock('../audit', async importOriginal => ({ ...(await importOriginal<typeof import('../audit')>()), auditSwitchChanges: dependencies.auditSwitchChanges }));
vi.mock('../limits', () => ({ check: dependencies.check, chatLimiter: () => null, visitor: () => 'test-ip' }));
vi.mock('../conversation', () => ({
  readHistory: dependencies.readHistory, conversationLength: dependencies.conversationLength,
  appendTurn: dependencies.appendTurn,
}));
vi.mock('../env', () => ({
  env: (key: string) => key === 'VERCEL_ENV' ? 'production' : key === 'SWITCH_CHAT' ? dependencies.switchChat : key.startsWith('SWITCH_') ? undefined : 'test-key',
}));
const { ApiError } = vi.hoisted(() => ({
  ApiError: class extends Error { constructor(public status: number) { super(`status ${status}`); } },
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class { models = { generateContentStream: dependencies.generateContentStream, generateContent: dependencies.generateContent }; },
  ThinkingLevel: { LOW: 'LOW' },
  FunctionCallingConfigMode: { AUTO: 'AUTO', NONE: 'NONE' },
  ApiError,
}));

import { POST } from '../../pages/api/chat';
import { CHAT_OFF } from '../switches';

const never = () => new Promise<never>(() => {});
const chunk = (...parts: Record<string, unknown>[]) => ({ candidates: [{ content: { role: 'model', parts } }] });
/** A Gemini stream: resolves to an async iterator of chunks with text parts. */
function model(chunks: string[] = ['An answer.'], stall = false) {
  return async () => (async function* () {
    for (const text of chunks) yield chunk({ text });
    if (stall) await never();
  })();
}
/** A round that ends in tool calls, as Gemini streams them. */
function calls(...functionCalls: { name: string; args?: Record<string, unknown> }[]) {
  return async () => (async function* () {
    yield chunk(...functionCalls.map((call, i) => ({ functionCall: { id: `call-${i}`, ...call }, thoughtSignature: 'sig' })));
  })();
}
const WORK_CARD = {
  kind: 'work', slug: 'agentic-analytics-platform', title: 'Brand Impact Tracker', url: '/work/agentic-analytics-platform',
  sector: 'Manufacturing', role: 'Lead Developer / Architect', duration: '2026',
};
const CARD_INDEX = { work: { 'agentic-analytics-platform': WORK_CARD }, articles: {}, notes: {}, now: null, pages: {}, parts: {} };
/** The SSE frames of a finished response, parsed. */
const frames = (text: string) => text.split('\n\n').filter(frame => frame.startsWith('data: ')).map(frame => JSON.parse(frame.slice(6)));
/** The abort signal the route handed the SDK on its most recent call. */
const modelSignal = (): AbortSignal =>
  dependencies.generateContentStream.mock.lastCall![0].config.abortSignal;
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
  dependencies.chatOn = true;
  dependencies.switchChat = undefined;
  dependencies.spend.mockResolvedValue(null);
  dependencies.check.mockResolvedValue({ ok: true, spend: dependencies.spend, refund: vi.fn(), charge: vi.fn(), release: vi.fn() });
  dependencies.searchVectors.mockResolvedValue([]);
  dependencies.getChunkText.mockResolvedValue('source');
  dependencies.readHistory.mockResolvedValue([]);
  dependencies.conversationLength.mockResolvedValue(0);
  dependencies.generateContentStream.mockImplementation(model());
  dependencies.buildCardIndex.mockResolvedValue(CARD_INDEX);
  dependencies.notifyTurn.mockResolvedValue(undefined);
  dependencies.logEntries.mockResolvedValue(undefined);
  dependencies.generateContent.mockResolvedValue({ text: 'hiring' });
  dependencies.liveUntil.mockResolvedValue(null);
  dependencies.holdQuestion.mockResolvedValue(undefined);
  dependencies.takeHeld.mockResolvedValue(null);
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
    expect(dependencies.generateContentStream).not.toHaveBeenCalled();
    expect(dependencies.searchVectors.mock.calls[0][3].aborted).toBe(true);
  });

  it('aborts a model that never produces its first event', async () => {
    dependencies.generateContentStream.mockImplementation(model([], true));
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.settled).toBe(true);
    expect(state.text).toMatch(/"error":.*[Tt]ry again/);
    expect(modelSignal().aborted).toBe(true);
  });

  it('aborts model generation and closes promptly when the request disconnects', async () => {
    const disconnect = new AbortController();
    dependencies.generateContentStream.mockImplementation(model([], true));
    const state = consume(await post(undefined, disconnect.signal));
    await vi.advanceTimersByTimeAsync(0);
    disconnect.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.settled).toBe(true);
    expect(modelSignal().aborted).toBe(true);
    expect(dependencies.appendTurn).not.toHaveBeenCalled();
  });

  it('cancels upstream work when the response reader is cancelled', async () => {
    dependencies.generateContentStream.mockImplementation(model([], true));
    const response = await post();
    await vi.advanceTimersByTimeAsync(0);
    void response.body!.cancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(modelSignal().aborted).toBe(true);
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
    expect(dependencies.generateContentStream).not.toHaveBeenCalled();
  });

  it('closes a complete answer even when persistence hangs', async () => {
    dependencies.appendTurn.mockImplementation(never);
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(6_000);
    expect(state.settled).toBe(true);
    expect(state.text).toContain('An answer.');
    expect(state.text).toContain('"done":true');
  });

  it('sends Jody the finished turn before the done frame', async () => {
    dependencies.readHistory.mockResolvedValue([{ r: 'u', t: 'Earlier', ts: 1 }, { r: 'a', t: 'Reply', ts: 1 }]);
    const cid = '0a1b2c3d-0000-4000-8000-000000000000';
    const state = consume(await post({ query: 'PRIVATE QUESTION', cid }));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.text).toContain('"done":true');
    expect(dependencies.notifyTurn).toHaveBeenCalledWith(
      { cid, index: 2, question: 'PRIVATE QUESTION', answer: 'An answer.', topic: 'hiring' }, expect.any(AbortSignal));
  });

  it('tags the topic, sends it before done and logs the turn with its page', async () => {
    const state = consume(await post({ query: 'PRIVATE QUESTION', page: '/work/tracker' }));
    await vi.advanceTimersByTimeAsync(0);
    const events = frames(state.text);
    expect(events.findIndex(e => e.topic === 'hiring')).toBeLessThan(events.findIndex(e => e.done));
    expect(dependencies.logEntries.mock.calls[0][1]).toEqual([
      { r: 'u', t: 'PRIVATE QUESTION', ts: expect.any(Number), topic: 'hiring', page: '/work/tracker' },
      { r: 'a', t: 'An answer.', ts: expect.any(Number) },
    ]);
    expect(dependencies.notifyTurn.mock.calls[0][0].topic).toBe('hiring');
  });

  it('keeps anything but a site path out of the transcript', async () => {
    const state = consume(await post({ query: 'Q', page: 'https://evil.example/' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.text).toContain('"done":true');
    expect(dependencies.logEntries.mock.calls[0][1][0].page).toBeUndefined();
  });

  it('answers without a topic when tagging fails or hangs', async () => {
    dependencies.generateContent.mockImplementation(never);
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(7_000);
    expect(state.text).toContain('"done":true');
    expect(state.text).not.toContain('"topic"');
    expect(dependencies.logEntries.mock.calls[0][1][0].topic).toBeUndefined();
  });

  it('logs a question Verso could not answer', async () => {
    dependencies.generateContentStream.mockRejectedValue(new Error('boom'));
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(state.settled).toBe(true);
    expect(dependencies.logEntries.mock.calls[0][1][0]).toMatchObject({ r: 'u', t: 'PRIVATE QUESTION', failed: true, topic: 'hiring' });
  });

  it('holds a question for Jody while he is live, without calling the model', async () => {
    const until = Date.now() + 100_000;
    dependencies.liveUntil.mockResolvedValue(until);
    const cid = '0a1b2c3d-0000-4000-8000-000000000000';
    const state = consume(await post({ query: 'And rates?', cid, page: '/about' }));
    await vi.advanceTimersByTimeAsync(0);
    const events = frames(state.text);
    expect(events).toContainEqual({ hold: { until } });
    expect(events.at(-1)).toEqual({ done: true });
    expect(dependencies.generateContentStream).not.toHaveBeenCalled();
    expect(dependencies.searchVectors).not.toHaveBeenCalled();
    expect(dependencies.holdQuestion).toHaveBeenCalledWith(cid, 'And rates?');
    expect(dependencies.notifyTurn.mock.calls[0][0]).toMatchObject({ cid, question: 'And rates?', waitSeconds: 100 });
    expect(dependencies.logEntries.mock.calls[0][1]).toEqual([{ r: 'u', t: 'And rates?', ts: expect.any(Number), page: '/about', held: true }]);
  });

  it('never holds a new conversation', async () => {
    dependencies.liveUntil.mockResolvedValue(Date.now() + 100_000);
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(0);
    expect(dependencies.liveUntil).not.toHaveBeenCalled();
    expect(state.text).toContain('An answer.');
  });

  it('answers a held question on fallback, clears it and logs only the answer', async () => {
    dependencies.liveUntil.mockResolvedValue(Date.now() + 100_000);
    const cid = '0a1b2c3d-0000-4000-8000-000000000000';
    const state = consume(await post({ query: 'And rates?', cid, fallback: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.text).toContain('An answer.');
    expect(dependencies.takeHeld).toHaveBeenCalledWith(cid);
    expect(dependencies.logEntries.mock.calls[0][1]).toEqual([{ r: 'a', t: 'An answer.', ts: expect.any(Number) }]);
  });

  it('clears the held question on fallback even when Verso then cannot answer', async () => {
    dependencies.generateContentStream.mockRejectedValue(new Error('boom'));
    const cid = '0a1b2c3d-0000-4000-8000-000000000000';
    const state = consume(await post({ query: 'And rates?', cid, fallback: true }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(state.text).toContain('"error":');
    expect(dependencies.takeHeld).toHaveBeenCalledWith(cid);
  });

  it('answers normally when the live check fails', async () => {
    dependencies.liveUntil.mockImplementation(never);
    const pending = post({ query: 'Q', cid: '0a1b2c3d-0000-4000-8000-000000000000' });
    await vi.advanceTimersByTimeAsync(2_500);
    const state = consume(await pending);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.text).toContain('An answer.');
  });

  it('confirms which links in the answer are real pages before done', async () => {
    dependencies.buildCardIndex.mockResolvedValue({ ...CARD_INDEX, pages: { '/work/agentic-analytics-platform': { title: 'x', text: '' } } });
    dependencies.generateContentStream.mockImplementation(model(['See [the tracker](/work/agentic-analytics-platform) and [this](/work/invented).']));
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(0);
    const events = frames(state.text);
    expect(events).toContainEqual({ links: ['/work/agentic-analytics-platform'] });
    expect(events.findIndex(e => e.links)).toBeLessThan(events.findIndex(e => e.done));
  });

  it('still finishes the answer when Telegram hangs', async () => {
    dependencies.notifyTurn.mockImplementation(never);
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(4_000);
    expect(state.settled).toBe(true);
    expect(state.text).toContain('"done":true');
  });

  it('tells Jody about a question Verso could not answer', async () => {
    dependencies.generateContentStream.mockRejectedValue(new Error('boom'));
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(0);
    expect(state.text).toContain('"error":');
    expect(dependencies.notifyTurn).toHaveBeenCalledWith(
      expect.objectContaining({ question: 'PRIVATE QUESTION', failed: true }), expect.any(AbortSignal));
  });

  it('does not notify when the visitor disconnects', async () => {
    const disconnect = new AbortController();
    dependencies.generateContentStream.mockImplementation(model([], true));
    const state = consume(await post(undefined, disconnect.signal));
    await vi.advanceTimersByTimeAsync(0);
    disconnect.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.settled).toBe(true);
    expect(dependencies.notifyTurn).not.toHaveBeenCalled();
  });

  it("is dead on an old deployment's URL in production, which would ignore a switch set since", async () => {
    const request = new Request('https://jodybrewster-abc123-jody.vercel.app/api/chat', {
      method: 'POST', body: JSON.stringify({ query: 'hi' }), headers: { 'Content-Type': 'application/json' },
    });
    expect(((await POST({ request } as Parameters<typeof POST>[0])) as Response).status).toBe(404);
    expect(dependencies.check).not.toHaveBeenCalled();
  });

  it('answers with the paused copy when chat is switched off, before any work', async () => {
    dependencies.chatOn = false;
    const response = await post();
    expect(response.status).toBe(503);
    expect(response.headers.get('x-switched-off')).toBe('chat');
    expect(await response.text()).toMatch(/paused/);
    expect(dependencies.check).not.toHaveBeenCalled();
    expect(dependencies.generateContentStream).not.toHaveBeenCalled();
  });

  it('answers 404 when SWITCH_CHAT is force-off, after recording the switch change', async () => {
    dependencies.switchChat = 'force-off';
    expect((await post()).status).toBe(404);
    expect(dependencies.auditSwitchChanges).toHaveBeenCalledOnce();
    expect(dependencies.check).not.toHaveBeenCalled();
  });

  it.each(['off', 'disabled'])('answers with the paused copy when SWITCH_CHAT is %s, after recording it', async value => {
    dependencies.switchChat = value;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await post();
    expect(response.status).toBe(503);
    expect(response.headers.get('x-switched-off')).toBe('chat');
    expect(await response.text()).toBe(CHAT_OFF);
    expect(dependencies.auditSwitchChanges).toHaveBeenCalledOnce();
    expect(dependencies.check).not.toHaveBeenCalled();
  });

  it.each([undefined, 'on'])('answers when SWITCH_CHAT is %s', async value => {
    dependencies.switchChat = value;
    expect([404, 503]).not.toContain((await post()).status);
    expect(dependencies.auditSwitchChanges).toHaveBeenCalledOnce();
  });

  it('refuses past the per-IP rate and once the daily quota is gone, before any model call', async () => {
    dependencies.check.mockResolvedValueOnce({ ok: false, code: 'rate_limited', rule: 'ip', retryAfterSeconds: 60 });
    const rate = await post();
    expect(rate.status).toBe(429);
    expect(await rate.text()).toMatch(/Try again in a minute/);
    dependencies.check.mockResolvedValueOnce({ ok: false, code: 'quota_exhausted', rule: 'global', retryAfterSeconds: 3600 });
    const daily = await post();
    expect(daily.status).toBe(429);
    expect(await daily.text()).not.toMatch(/Try again in a minute/);
    dependencies.check.mockResolvedValueOnce({ ok: false, code: 'unavailable', rule: 'store', retryAfterSeconds: 30 });
    expect((await post()).status).toBe(503);
    expect(dependencies.generateContentStream).not.toHaveBeenCalled();
  });

  it('spends one answer from the daily quota just before the model call', async () => {
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(0);
    expect(state.settled).toBe(true);
    expect(dependencies.spend).toHaveBeenCalledWith('global');
    expect(dependencies.spend.mock.invocationCallOrder[0]).toBeLessThan(dependencies.generateContentStream.mock.invocationCallOrder[0]);
  });

  it('fails closed before model billing if the daily-budget guard fails', async () => {
    dependencies.spend.mockResolvedValue({ ok: false, code: 'unavailable', rule: 'store', retryAfterSeconds: 30 });
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(0);
    expect(state.settled).toBe(true);
    expect(state.text).toContain('"error":');
    expect(dependencies.generateContentStream).not.toHaveBeenCalled();
  });

  it('bounds a hanging pre-stream rate limit with a 503 response', async () => {
    dependencies.check.mockImplementation(never);
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
    const logs = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(logs).toContain('retrieval');
    expect(logs).toContain('elapsedMs');
    expect(logs).toContain('mid');
    expect(logs).not.toContain('PRIVATE QUESTION');
  });

  it('sends the system prompt and the grounded question to the text model', async () => {
    dependencies.searchVectors.mockResolvedValue([{ score: 0.9, metadata: {
      type: 'writing', slug: 'runtime', title: 'Runtime', date: '2026-01-01', url: '/writing/runtime',
    } }]);
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(0);
    expect(state.settled).toBe(true);
    const request = dependencies.generateContentStream.mock.lastCall![0];
    expect(request.model).toMatch(/^gemini-/);
    expect(request.config.systemInstruction).toContain('Verso');
    const last = request.contents[request.contents.length - 1];
    expect(last.role).toBe('user');
    expect(last.parts[0].text).toContain('Question: PRIVATE QUESTION');
    expect(last.parts[0].text).toContain('"Runtime"');
    expect(state.text).toContain('"url":"/writing/runtime"');
  });

  it('moves to the next model when one is over capacity', async () => {
    dependencies.generateContentStream
      .mockRejectedValueOnce(new ApiError(503))
      .mockRejectedValueOnce(new ApiError(429))
      .mockImplementationOnce(model(['From the third.']));
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(0);
    expect(state.text).toContain('From the third.');
    expect(state.text).toContain('"done":true');
    const models = dependencies.generateContentStream.mock.calls.map(([request]) => request.model);
    expect(new Set(models).size).toBe(3);
    // A turn another model rescued is not an outage.
    expect(dependencies.alertModelFailure).not.toHaveBeenCalled();
  });

  it('reports failure when every model is over capacity', async () => {
    dependencies.generateContentStream.mockRejectedValue(new ApiError(503));
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(0);
    expect(state.text).toMatch(/"error":.*[Tt]ry again/);
    expect(dependencies.generateContentStream).toHaveBeenCalledTimes(3);
    expect(dependencies.alertModelFailure).toHaveBeenCalledTimes(1);
    expect(dependencies.alertModelFailure.mock.calls[0][0]).toEqual({ model: 'gemini-3.5-flash-lite', status: '503', spendCap: false });
  });

  it('does not fall back on an error that is not about capacity', async () => {
    dependencies.generateContentStream.mockRejectedValue(new ApiError(400));
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(0);
    expect(state.text).toContain('"error":');
    expect(dependencies.generateContentStream).toHaveBeenCalledTimes(1);
  });

  it('never splices a second model onto an answer that already started', async () => {
    dependencies.generateContentStream.mockImplementationOnce(async () => (async function* () {
      yield chunk({ text: 'Half an answer' });
      throw new ApiError(503);
    })());
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(0);
    expect(state.text).toContain('Half an answer');
    expect(state.text).toContain('"error":');
    expect(dependencies.generateContentStream).toHaveBeenCalledTimes(1);
    expect(dependencies.appendTurn).not.toHaveBeenCalled();
  });

  it('offers the card tools and names slugs and urls in the excerpts', async () => {
    dependencies.searchVectors.mockResolvedValue([{ score: 0.9, metadata: {
      type: 'work', slug: 'agentic-analytics-platform', title: 'Brand Impact Tracker', date: '', url: '/work/agentic-analytics-platform',
    } }]);
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(0);
    expect(state.settled).toBe(true);
    const request = dependencies.generateContentStream.mock.lastCall![0];
    const names = request.config.tools[0].functionDeclarations.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(['show_case_study', 'show_screens', 'go_to_page', 'show_work', 'show_writing', 'show_note', 'show_now', 'open_page']);
    expect(request.config.tools[0].functionDeclarations[0].parametersJsonSchema.type).toBe('object');
    expect(request.config.toolConfig.functionCallingConfig.mode).toBe('AUTO');
    expect(request.contents.at(-1).parts[0].text).toContain('slug: agentic-analytics-platform url: /work/agentic-analytics-platform');
  });

  it('emits a card frame for a valid slug, then the answer, and persists only the prose', async () => {
    dependencies.generateContentStream
      .mockImplementationOnce(calls({ name: 'show_work', args: { slug: 'agentic-analytics-platform' } }))
      .mockImplementationOnce(model(['It tracks brand ', 'performance.']));
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(0);
    const events = frames(state.text);
    const cardAt = events.findIndex(event => event.card);
    expect(events[cardAt].card).toEqual(WORK_CARD);
    expect(cardAt).toBeLessThan(events.findIndex(event => event.text));
    expect(events.at(-1)).toEqual({ done: true });
    const second = dependencies.generateContentStream.mock.calls[1][0];
    expect(second.model).toBe(dependencies.generateContentStream.mock.calls[0][0].model);
    const [modelTurn, toolTurn] = second.contents.slice(-2);
    expect(modelTurn).toMatchObject({ role: 'model', parts: [{ functionCall: { name: 'show_work' }, thoughtSignature: 'sig' }] });
    expect(toolTurn).toMatchObject({ role: 'user', parts: [{ functionResponse: { id: 'call-0', name: 'show_work', response: { shown: true, card: WORK_CARD } } }] });
    expect(dependencies.appendTurn.mock.calls[1][1].t).toBe('It tracks brand performance.');
  });

  it('shows no card for an unknown slug and still answers', async () => {
    dependencies.generateContentStream
      .mockImplementationOnce(calls({ name: 'show_work', args: { slug: 'invented-project' } }, { name: 'drop_tables' }))
      .mockImplementationOnce(model(['Nothing like that is documented.']));
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(0);
    const events = frames(state.text);
    expect(events.some(event => event.card)).toBe(false);
    expect(state.text).toContain('Nothing like that is documented.');
    expect(state.text).toContain('"done":true');
    const responses = dependencies.generateContentStream.mock.calls[1][0].contents.at(-1).parts;
    expect(responses.map((part: { functionResponse: { response: { shown: boolean } } }) => part.functionResponse.response.shown)).toEqual([false, false]);
  });

  it('bounds the tool loop and forces a text answer on the last round', async () => {
    dependencies.generateContentStream
      .mockImplementationOnce(calls({ name: 'show_work', args: { slug: 'agentic-analytics-platform' } }))
      .mockImplementationOnce(calls({ name: 'show_work', args: { slug: 'agentic-analytics-platform' } }))
      .mockImplementationOnce(model(['Final words.']))
      .mockImplementation(calls({ name: 'show_now' }));
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(0);
    expect(dependencies.generateContentStream).toHaveBeenCalledTimes(3);
    const modes = dependencies.generateContentStream.mock.calls.map(([request]) => request.config.toolConfig.functionCallingConfig.mode);
    expect(modes).toEqual(['AUTO', 'AUTO', 'NONE']);
    expect(frames(state.text).filter(event => event.card)).toHaveLength(1);
    expect(state.text).toContain('Final words.');
  });

  it('never puts more than four things on screen in one answer', async () => {
    const card = (slug: string) => ({ ...WORK_CARD, slug, url: `/work/${slug}` });
    const slugs = ['a', 'b', 'c', 'd', 'e'];
    dependencies.buildCardIndex.mockResolvedValue({ ...CARD_INDEX, work: Object.fromEntries(slugs.map(slug => [slug, card(slug)])) });
    dependencies.generateContentStream
      .mockImplementationOnce(calls(...slugs.map(slug => ({ name: 'show_work', args: { slug } }))))
      .mockImplementationOnce(model(['Five projects.']));
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(0);
    expect(frames(state.text).filter(event => event.card).map(event => event.card.slug)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not fall back to another model once a card has been sent', async () => {
    dependencies.generateContentStream
      .mockImplementationOnce(calls({ name: 'show_work', args: { slug: 'agentic-analytics-platform' } }))
      .mockRejectedValueOnce(new ApiError(503))
      .mockImplementation(model(['From another model.']));
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(0);
    expect(state.text).toContain('"card":');
    expect(state.text).toContain('"error":');
    expect(state.text).not.toContain('From another model.');
    expect(dependencies.generateContentStream).toHaveBeenCalledTimes(2);
    expect(dependencies.appendTurn).not.toHaveBeenCalled();
  });

  it('still answers when the card index cannot be built', async () => {
    dependencies.buildCardIndex.mockRejectedValue(new Error('disk'));
    dependencies.generateContentStream
      .mockImplementationOnce(calls({ name: 'show_work', args: { slug: 'agentic-analytics-platform' } }))
      .mockImplementationOnce(model(['Prose only.']));
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(0);
    expect(state.text).not.toContain('"card":');
    expect(state.text).toContain('Prose only.');
    expect(state.text).toContain('"done":true');
  });

  it('separates prose written before and after a tool call', async () => {
    dependencies.generateContentStream
      .mockImplementationOnce(async () => (async function* () {
        yield chunk({ text: 'Here is the project.' });
        yield chunk({ functionCall: { name: 'show_work', args: { slug: 'agentic-analytics-platform' } } });
      })())
      .mockImplementationOnce(model(['It tracks brands.']));
    const state = consume(await post());
    await vi.advanceTimersByTimeAsync(0);
    expect(state.text).toContain('"done":true');
    expect(dependencies.appendTurn.mock.calls[1][1].t).toBe('Here is the project.\n\nIt tracks brands.');
  });

  it('refuses without a Gemini key rather than failing mid-stream', async () => {
    vi.resetModules();
    vi.doMock('../env', () => ({ env: (key: string) => key === 'VERCEL_ENV' ? 'production' : undefined }));
    const { POST: keyless } = await import('../../pages/api/chat');
    const response = await keyless({ request: new Request('https://jodybrewster.dev/api/chat', {
      method: 'POST', body: JSON.stringify({ query: 'hi' }), headers: { 'Content-Type': 'application/json' },
    }) } as Parameters<typeof keyless>[0]) as Response;
    expect(response.status).toBe(503);
    expect(dependencies.generateContentStream).not.toHaveBeenCalled();
    vi.doUnmock('../env');
  });
});
