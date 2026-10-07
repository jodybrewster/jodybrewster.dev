import { readSseFrames } from '@jodybrewster/gemini-live/core';
import type { Card } from './verso-tools';

export interface ChatSource { type: string; url: string; title: string; date?: string }
export interface ChatEvent {
  text?: string; cid?: string; mid?: string; sources?: ChatSource[]; card?: Card; topic?: string; links?: string[]; hold?: { until?: number }; error?: string; done?: boolean;
}
interface ChatOptions {
  onEvent: (event: ChatEvent) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}
export async function requestChat(
  body: { query: string; cid?: string; page?: string; fallback?: boolean }, options: ChatOptions,
): Promise<void> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let stopped = false;
  let rejectAbort: (reason: Error) => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const stop = (message: string) => {
    stopped = true;
    rejectAbort(new Error(message));
    controller.abort();
  };
  const onAbort = () => stop('Stopped. You can try again when you’re ready.');
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => stop('That took too long. Please try again.'), options.timeoutMs ?? 60_000);

  async function receive(): Promise<void> {
    if (options.signal?.aborted) { onAbort(); return; }
    const res = await (options.fetcher ?? fetch)('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: controller.signal,
    });
    if (stopped) { void res.body?.cancel().catch(() => {}); return; }
    if (!res.ok) {
      if (res.status === 429 || res.status === 403 || res.headers.get('x-switched-off')) {
        throw new Error((await res.text()) || 'Chat is unavailable. Please try again.');
      }
      throw new Error('Chat is temporarily unavailable. Please try again.');
    }
    if (!res.body) throw new Error('Nothing came back. Please try again.');
    const source = res.body.getReader();
    reader = source;
    // readSseFrames takes the stream and locks it, so it reads through this
    // pass-through while the site keeps the real reader: stop and timeout
    // cancel that one directly, without waiting on the parser.
    const frames = readSseFrames(new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await source.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
    }, { highWaterMark: 0 }));
    for await (const frame of frames) {
      if (stopped) return;
      const event = frame as ChatEvent | null;
      if (!event || typeof event !== 'object') continue;
      if (typeof event.error === 'string') throw new Error(event.error);
      options.onEvent(event);
      if (event.done) return;
    }
    if (stopped) return;
    throw new Error('The answer was interrupted. Please try again.');
  }

  try {
    await Promise.race([receive(), aborted]);
  } finally {
    stopped = true;
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    // A done frame is terminal even if server persistence has not closed HTTP.
    // Cancel without awaiting an upstream that may itself be unresponsive.
    void reader?.cancel().catch(() => {});
    controller.abort();
  }
}
