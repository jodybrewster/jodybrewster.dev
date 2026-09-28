import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { searchVectors, getChunkText, type SearchHit, type SourceMetadata } from '../../lib/rag';
import { getIpLimiter, getGlobalLimiter, clientIp, isOriginAllowed } from '../../lib/rate-limit';
import { getRedis } from '../../lib/redis';
import {
  HANDOFF_WINDOW_MS, POLL_INTERVAL_MS, isOperatorOnline, readHistory, appendTurn,
  conversationLength, putPending, claim, getReply, putFinal, mapTelegramMessage,
  setLastQuestion, closeHandoff,
} from '../../lib/handoff';
import { telegramConfigured, formatQuestionMessage, sendQuestion } from '../../lib/telegram';
import { announceLapse } from './telegram';
import {
  SYSTEM_PROMPT, MAX_QUERY_LEN, MAX_TURNS_PER_CONV, isValidConversationId,
  retrievalQuery, buildMessages, chunkForTyping, typingDelayMs, type ConversationTurn,
} from '../../lib/verso';
import { env } from '../../lib/env';
import { flags } from '../../lib/flags';
import { withDeadline } from '../../lib/deadline';

export const prerender = false;
const MODEL = 'claude-sonnet-4-6';
const HARD_DEADLINE_MS = 80_000; // Leave ten seconds below Vercel's ceiling.
const DAILY_CAP_MESSAGE = 'The chat has hit its daily cap. Come back tomorrow, or read the cited writing directly.';
const UNAVAILABLE = 'Chat is temporarily unavailable. Try again shortly.';
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason); return; }
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
  signal.addEventListener('abort', abort, { once: true });
});
interface CitedSource {
  type: SourceMetadata['type']; slug: string; title: string; date: string; url: string; score: number;
}

export const POST: APIRoute = async ({ request }) => {
  if (!flags.chat) return new Response('Not found', { status: 404 });
  const started = Date.now();
  let body: unknown;
  try { body = await withDeadline(() => request.json(), 4000, request.signal); }
  catch { return new Response('Invalid JSON', { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      typeof (body as { query?: unknown }).query !== 'string') {
    return new Response('query must be a string', { status: 400 });
  }
  const data = body as { query: string; cid?: unknown; name?: unknown };
  const query = data.query.trim();
  if (!query) return new Response('query required', { status: 400 });
  if (query.length > MAX_QUERY_LEN) return new Response(`query too long (max ${MAX_QUERY_LEN} chars)`, { status: 413 });
  if (!isOriginAllowed(request)) return new Response('Forbidden', { status: 403 });
  if (!getRedis() && env('VERCEL_ENV') === 'production') return new Response(UNAVAILABLE, { status: 503 });
  const name = typeof data.name === 'string' ? data.name.trim().slice(0, 40) || undefined : undefined;
  const posted = isValidConversationId(data.cid) ? data.cid : null;
  const cid = posted ?? crypto.randomUUID();
  const mid = crypto.randomUUID();
  const log = (stage: string, status: string) => console.info('[chat]', { mid, stage, status, elapsedMs: Date.now() - started });
  const globalLimiter = getGlobalLimiter();
  let history: ConversationTurn[] = [];
  let operatorOnline = false;
  try {
    const denied = await withDeadline(async signal => {
      const ipLimiter = getIpLimiter();
      if (ipLimiter) {
        const result = await ipLimiter.limit(clientIp(request));
        signal.throwIfAborted();
        if (result.reason === 'timeout') return new Response(UNAVAILABLE, { status: 503 });
        if (!result.success) return new Response('Rate limit exceeded. Try again in a minute.', { status: 429 });
      }
      history = posted ? await readHistory(cid) : [];
      signal.throwIfAborted();
      if (posted && await conversationLength(cid) >= MAX_TURNS_PER_CONV * 2) {
        return new Response('This conversation has run long. Start a new chat to continue.', { status: 429 });
      }
      signal.throwIfAborted();
      operatorOnline = await isOperatorOnline();
      signal.throwIfAborted();
      if (globalLimiter && !operatorOnline) {
        const { remaining } = await globalLimiter.getRemaining('global');
        signal.throwIfAborted();
        if (remaining <= 0) return new Response(DAILY_CAP_MESSAGE, { status: 429 });
      }
      return null;
    }, 4000, request.signal);
    if (denied) return denied;
    log('setup', 'complete');
  } catch {
    log('setup', 'unavailable');
    return new Response(UNAVAILABLE, { status: 503 });
  }
  // Notification failure cannot hold the answer open, and never logs its payload.
  if (!operatorOnline) void withDeadline(() => announceLapse(), 5000).catch(() => log('presence-notice', 'failed'));
  if (!env('ANTHROPIC_API_KEY')) return new Response(UNAVAILABLE, { status: 503 });
  const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), maxRetries: 0, timeout: 50_000 });
  const lifetime = new AbortController();
  let completed = false;
  const disconnect = () => { if (!completed) lifetime.abort(new DOMException('Disconnected', 'AbortError')); };
  request.signal.addEventListener('abort', disconnect, { once: true });
  if (request.signal.aborted) disconnect();
  const hardTimer = setTimeout(() => lifetime.abort(new DOMException('Request timed out', 'TimeoutError')),
    Math.max(1, HARD_DEADLINE_MS - (Date.now() - started)));
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { disconnect(); }
      };
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(': ping\n\n')); } catch { disconnect(); }
      }, 10_000);
      let answerText = '';
      let answeredBy: 'human' | 'llm' = 'llm';
      let sources: CitedSource[] = [];
      let retrieval: Promise<SearchHit[]> | undefined;
      let handoffStarted = false;
      const retrieve = () => {
        if (!retrieval) {
          log('retrieval', 'start');
          retrieval = withDeadline(signal => searchVectors(retrievalQuery(history, query), 5, undefined, signal), 12_000, lifetime.signal);
          void retrieval.catch(() => {}); // A human answer can abandon retrieval.
        }
        return retrieval;
      };
      try {
        lifetime.signal.throwIfAborted();
        send({ cid, mid });
        let humanReply: string | null = null;
        if (operatorOnline && telegramConfigured()) {
          handoffStarted = true;
          log('handoff', 'start');
          retrieve();
          humanReply = await withDeadline(async signal => {
            const questionStart = Date.now();
            await putPending(mid, { cid, q: query, ts: questionStart, index: Math.floor(history.length / 2) + 1, name });
            signal.throwIfAborted();
            const previousAnswer = history.findLast(t => t.r === 'a')?.t;
            const previousQuestion = history.findLast(t => t.r === 'u')?.t;
            const tgId = await sendQuestion(formatQuestionMessage({ cid, question: query,
              index: Math.floor(history.length / 2) + 1, name, prevA: previousAnswer, prevQ: previousQuestion,
              windowSeconds: HANDOFF_WINDOW_MS / 1000 }));
            signal.throwIfAborted();
            if (tgId === null) { await closeHandoff(mid); return null; }
            await mapTelegramMessage(tgId, mid);
            signal.throwIfAborted();
            await setLastQuestion(mid);
            signal.throwIfAborted();
            while (Date.now() < questionStart + HANDOFF_WINDOW_MS) {
              const reply = await getReply(mid);
              signal.throwIfAborted();
              if (reply) return reply;
              await sleep(Math.min(POLL_INTERVAL_MS, Math.max(1, questionStart + HANDOFF_WINDOW_MS - Date.now())), signal);
            }
            if (await claim(mid, 'llm')) return null;
            signal.throwIfAborted();
            // Human claim + reply are atomic; a failed claim is never permission
            // to overwrite an answer. Read once, or report a retryable failure.
            const reply = await getReply(mid);
            signal.throwIfAborted();
            if (!reply) throw new Error('Handoff could not be settled. Try again.');
            return reply;
          }, HANDOFF_WINDOW_MS + 8000, lifetime.signal);
          log('handoff', humanReply ? 'human' : 'model');
        }
        lifetime.signal.throwIfAborted();
        if (humanReply) {
          answeredBy = 'human'; answerText = humanReply;
          const chunks = chunkForTyping(humanReply);
          for (let i = 0; i < chunks.length; i++) {
            lifetime.signal.throwIfAborted(); send({ text: chunks[i] });
            if (i < chunks.length - 1) await sleep(typingDelayMs(chunks.length), lifetime.signal);
          }
        } else {
          const hits = await retrieve();
          lifetime.signal.throwIfAborted();
          const context = await withDeadline(async signal => {
            const chunks = await Promise.all(hits.map(async hit => ({ hit, text: await getChunkText(hit.metadata) })));
            signal.throwIfAborted();
            return chunks.map(({ hit, text }, i) => `[Source ${i + 1}] (${hit.metadata.type}) "${hit.metadata.title}"\n${text}`).join('\n\n---\n\n');
          }, 3000, lifetime.signal);
          log('retrieval', 'complete');
          const seen = new Set<string>();
          sources = hits.flatMap(hit => {
            const m = hit.metadata; const key = `${m.type}:${m.slug}`;
            if (seen.has(key)) return []; seen.add(key);
            return [{ type: m.type, slug: m.slug, title: m.title, date: m.date?.slice(0, 10) ?? '', url: m.url, score: Number(hit.score.toFixed(3)) }];
          });
          if (globalLimiter) {
            const result = await withDeadline(() => globalLimiter.limit('global'), 3000, lifetime.signal);
            if (result.reason === 'timeout') throw new Error(UNAVAILABLE);
            if (!result.success) throw new Error(DAILY_CAP_MESSAGE);
          }
          lifetime.signal.throwIfAborted();
          log('model', 'start');
          await withDeadline(async signal => {
            const modelStream = anthropic.messages.stream({ model: MODEL, max_tokens: 1024,
              system: SYSTEM_PROMPT, messages: buildMessages(history, query, context) }, { signal });
            modelStream.on('abort', () => {});
            const abort = () => modelStream.abort();
            signal.addEventListener('abort', abort, { once: true });
            try {
              for await (const chunk of modelStream) {
                signal.throwIfAborted();
                if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                  if (!answerText) log('model', 'first-text');
                  answerText += chunk.delta.text; send({ text: chunk.delta.text });
                }
              }
            } finally { signal.removeEventListener('abort', abort); }
          }, 50_000, lifetime.signal);
          log('model', 'complete');
        }
        lifetime.signal.throwIfAborted();
        if (!answerText.trim()) throw new Error('Nothing came back. Try again.');
        try {
          await withDeadline(async signal => {
            const ts = Date.now();
            await appendTurn(cid, { r: 'u', t: query, ts }); signal.throwIfAborted();
            await appendTurn(cid, { r: 'a', t: answerText, ts, by: answeredBy }); signal.throwIfAborted();
            await putFinal(mid, { by: answeredBy, text: answerText, sources, ts });
          }, 4000, lifetime.signal);
          log('persistence', 'complete');
        } catch { log('persistence', 'failed'); }
        lifetime.signal.throwIfAborted();
        completed = true;
        send({ sources }); send({ done: true }); log('response', 'complete');
      } catch (error) {
        const disconnected = lifetime.signal.aborted && lifetime.signal.reason?.name === 'AbortError';
        log('response', disconnected ? 'disconnected' : 'failed');
        if (!disconnected) send({ error: error instanceof Error && error.message === DAILY_CAP_MESSAGE
          ? DAILY_CAP_MESSAGE : 'The response could not finish. Try again in a moment.' });
      } finally {
        clearInterval(heartbeat); clearTimeout(hardTimer);
        request.signal.removeEventListener('abort', disconnect);
        // Signal abandoned speculative retrieval too, including a human win.
        lifetime.abort();
        if (handoffStarted) await withDeadline(() => closeHandoff(mid), 2500).catch(() => log('handoff-close', 'failed'));
        try { controller.close(); } catch { /* Reader already cancelled. */ }
      }
    },
    cancel() { disconnect(); },
  });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive',
  } });
};
