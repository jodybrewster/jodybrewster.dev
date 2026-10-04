import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestChat } from './chat-stream';

const encode = (text: string) => new TextEncoder().encode(text);
afterEach(() => vi.useRealTimers());

describe('chat response lifecycle', () => {
  it('shows the server\'s words when chat is switched off', async () => {
    const response = new Response('Chat is paused right now. Please try again later.', { status: 503, headers: { 'X-Switched-Off': 'chat' } });
    await expect(requestChat({ query: 'Hello' }, { fetcher: async () => response, onEvent: () => {} })).rejects.toThrow('Chat is paused right now');
    const unavailable = new Response('internal detail', { status: 503 });
    await expect(requestChat({ query: 'Hello' }, { fetcher: async () => unavailable, onEvent: () => {} })).rejects.toThrow('temporarily unavailable');
  });

  it('handles split frames and finishes on done even while the connection stays open', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encode(': ping\n\ndata: {"text":"Hel'));
        controller.enqueue(encode('lo"}\n\ndata: {"done":true}\n\n'));
      }, cancel,
    }));
    const events: unknown[] = [];
    await requestChat({ query: 'Hello' }, { fetcher: async () => response, onEvent: event => events.push(event) });
    expect(events).toEqual([{ text: 'Hello' }, { done: true }]);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('times out before headers arrive and aborts the network request', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const result = requestChat({ query: 'Hello' }, {
      timeoutMs: 100,
      fetcher: async (_url, init) => { signal = init?.signal as AbortSignal; return new Promise(() => {}); },
      onEvent: () => {},
    });
    const check = expect(result).rejects.toThrow('took too long');
    await vi.advanceTimersByTimeAsync(101);
    await check;
    expect(signal?.aborted).toBe(true);
  });

  it('times out a silent stream and releases its reader', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }));
    const result = requestChat({ query: 'Hello' }, {
      timeoutMs: 100, fetcher: async () => response, onEvent: () => {},
    });
    const check = expect(result).rejects.toThrow('took too long');
    await vi.advanceTimersByTimeAsync(101);
    await check;
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('reports a truncated answer rather than treating an early close as success', async () => {
    const response = new Response('data: {"text":"Part of an answer"}\n\n');
    await expect(requestChat({ query: 'Hello' }, {
      fetcher: async () => response, onEvent: () => {},
    })).rejects.toThrow('interrupted');
  });

  it('lets the visitor stop a pending request', async () => {
    const controller = new AbortController();
    const result = requestChat({ query: 'Hello' }, {
      signal: controller.signal, fetcher: async () => new Response(new ReadableStream()), onEvent: () => {},
    });
    const check = expect(result).rejects.toThrow('Stopped');
    controller.abort();
    await check;
  });

  it('surfaces an SSE error even when the HTTP status is successful', async () => {
    await expect(requestChat({ query: 'Hello' }, {
      fetcher: async () => new Response('data: {"error":"Please try again."}\n\n'), onEvent: () => {},
    })).rejects.toThrow('Please try again.');
  });
});
