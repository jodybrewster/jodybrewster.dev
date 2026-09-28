/** Bound an operation even if its upstream ignores cancellation. */
export async function withDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>, ms: number, parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let rejectAbort: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const cancel = (reason: unknown) => { rejectAbort(reason); controller.abort(reason); };
  const onAbort = () => cancel(parent?.reason ?? new DOMException('Cancelled', 'AbortError'));
  parent?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => cancel(new DOMException('Service timed out', 'TimeoutError')), ms);
  try {
    if (parent?.aborted) onAbort();
    return await Promise.race([aborted, Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return run(controller.signal);
    })]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', onAbort);
    controller.abort();
  }
}
