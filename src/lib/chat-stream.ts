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
      if (res.status === 429 || res.status === 403) {
        throw new Error((await res.text()) || 'Chat is unavailable. Please try again.');
      }
      throw new Error('Chat is temporarily unavailable. Please try again.');
    }
    if (!res.body) throw new Error('Nothing came back. Please try again.');
    reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!stopped) {
      const { done, value } = await reader.read();
      if (stopped) return;
      if (done) throw new Error('The answer was interrupted. Please try again.');
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (!frame.startsWith('data: ')) continue;
        let event: ChatEvent;
        try { event = JSON.parse(frame.slice(6)); } catch { continue; }
        if (!event || typeof event !== 'object') continue;
        if (typeof event.error === 'string') throw new Error(event.error);
        options.onEvent(event);
        if (event.done) return;
      }
    }
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
