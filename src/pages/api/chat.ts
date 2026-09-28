import type { APIRoute } from 'astro';
import { ApiError, FunctionCallingConfigMode, GoogleGenAI, ThinkingLevel, type Content, type Part } from '@google/genai';
import { searchVectors, getChunkText, type SourceMetadata } from '../../lib/rag';
import { getIpLimiter, getGlobalLimiter, clientIp, isOriginAllowed } from '../../lib/rate-limit';
import { getRedis } from '../../lib/redis';
import { readHistory, appendTurn, conversationLength } from '../../lib/conversation';
import {
  SYSTEM_PROMPT, MAX_QUERY_LEN, MAX_TURNS_PER_CONV, isValidConversationId,
  retrievalQuery, buildMessages, type ConversationTurn,
} from '../../lib/verso';
import { env } from '../../lib/env';
import { flags } from '../../lib/flags';
import { withDeadline } from '../../lib/deadline';
import { VERSO_TOOL_DECLARATIONS, resolveCard, type Card } from '../../lib/verso-tools';
import { buildCardIndex } from '../../lib/cards';
import { notifyTurn } from '../../lib/operator';

export const prerender = false;
/**
 * Tried in order. Google answers 503 "high demand" per model, and one model
 * can be saturated while its neighbour is fine, so a capacity error moves to
 * the next one. Each gets a single attempt: the SDK's own retry backs off for
 * seconds per try and would spend the whole deadline on the first model.
 */
const MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];
/** Capacity and quota errors. Anything else is a real failure and ends the turn. */
const isRetryable = (error: unknown) =>
  error instanceof ApiError && (error.status === 503 || error.status === 429);
const HARD_DEADLINE_MS = 55_000; // Leave five seconds below Vercel's ceiling.
const MODEL_DEADLINE_MS = 40_000; // Covers every round of the tool loop, not each call.
/** Rounds that may call card tools; the round after them must answer in text. */
const MAX_TOOL_ROUNDS = 2;
const MAX_CARDS = 4;
/** Telegram is a notice to Jody. It may not hold the visitor's answer for long. */
const NOTIFY_DEADLINE_MS = 3000;
const TOOLS = [{ functionDeclarations: VERSO_TOOL_DECLARATIONS.map(({ name, description, parameters }) =>
  ({ name, description, parametersJsonSchema: parameters })) }];
const DAILY_CAP_MESSAGE = 'The chat has hit its daily cap. Come back tomorrow, or read the cited writing directly.';
const UNAVAILABLE = 'Chat is temporarily unavailable. Try again shortly.';
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
  const data = body as { query: string; cid?: unknown };
  const query = data.query.trim();
  if (!query) return new Response('query required', { status: 400 });
  if (query.length > MAX_QUERY_LEN) return new Response(`query too long (max ${MAX_QUERY_LEN} chars)`, { status: 413 });
  if (!isOriginAllowed(request)) return new Response('Forbidden', { status: 403 });
  if (!getRedis() && env('VERCEL_ENV') === 'production') return new Response(UNAVAILABLE, { status: 503 });
  const posted = isValidConversationId(data.cid) ? data.cid : null;
  const cid = posted ?? crypto.randomUUID();
  const mid = crypto.randomUUID();
  const log = (stage: string, status: string) => console.info('[chat]', { mid, stage, status, elapsedMs: Date.now() - started });
  const globalLimiter = getGlobalLimiter();
  let history: ConversationTurn[] = [];
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
      if (globalLimiter) {
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
  if (!env('GEMINI_API_KEY')) return new Response(UNAVAILABLE, { status: 503 });
  const ai = new GoogleGenAI({ apiKey: env('GEMINI_API_KEY'), httpOptions: { retryOptions: { attempts: 1 } } });
  const lifetime = new AbortController();
  let completed = false;
  const disconnect = () => { if (!completed) lifetime.abort(new DOMException('Disconnected', 'AbortError')); };
  request.signal.addEventListener('abort', disconnect, { once: true });
  if (request.signal.aborted) disconnect();
  const hardTimer = setTimeout(() => lifetime.abort(new DOMException('Request timed out', 'TimeoutError')),
    Math.max(1, HARD_DEADLINE_MS - (Date.now() - started)));
  const turnIndex = history.filter(turn => turn.r === 'u').length + 1;
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
      let sources: CitedSource[] = [];
      try {
        lifetime.signal.throwIfAborted();
        send({ cid, mid });
        log('retrieval', 'start');
        const hits = await withDeadline(signal => searchVectors(retrievalQuery(history, query), 5, undefined, signal), 12_000, lifetime.signal);
        lifetime.signal.throwIfAborted();
        const context = await withDeadline(async signal => {
          const chunks = await Promise.all(hits.map(async hit => ({ hit, text: await getChunkText(hit.metadata) })));
          signal.throwIfAborted();
          return chunks.map(({ hit: { metadata: m }, text }, i) =>
            `[Source ${i + 1}] (${m.type}) "${m.title}" slug: ${m.slug} url: ${m.url}\n${text}`).join('\n\n---\n\n');
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
        const contents: Content[] = buildMessages(history, query, context);
        const shown = new Set<string>();
        let cardIndex: ReturnType<typeof buildCardIndex> | null = null;
        await withDeadline(async signal => {
          /** One model call: streams its text out, returns every part for the transcript. */
          const round = async (model: string, final: boolean): Promise<Part[]> => {
            const modelStream = await ai.models.generateContentStream({
              model, contents,
              config: {
                systemInstruction: SYSTEM_PROMPT,
                maxOutputTokens: 1024,
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                tools: TOOLS,
                toolConfig: { functionCallingConfig: { mode: final ? FunctionCallingConfigMode.NONE : FunctionCallingConfigMode.AUTO } },
                abortSignal: signal,
              },
            });
            const parts: Part[] = [];
            let opened = false;
            for await (const chunk of modelStream) {
              signal.throwIfAborted();
              const chunkParts = chunk.candidates?.[0]?.content?.parts ?? [];
              parts.push(...chunkParts);
              let text = chunkParts.filter(part => typeof part.text === 'string' && !part.thought).map(part => part.text).join('');
              if (!text) continue;
              if (!answerText) log('model', `first-text:${model}`);
              // Text before and after a tool call is one answer in two rounds.
              else if (!opened && !/\s$/.test(answerText)) text = `\n\n${text.trimStart()}`;
              opened = true; answerText += text; send({ text });
            }
            return parts;
          };
          /** A card for each call that names something real, and what to tell the model. */
          const answerCalls = async (parts: Part[]): Promise<Part[]> => {
            cardIndex ??= buildCardIndex();
            const index = await cardIndex.catch(() => null);
            signal.throwIfAborted();
            return parts.flatMap(part => part.functionCall ? [part.functionCall] : []).map(({ id, name = '', args = {} }) => {
              let response: Record<string, unknown>;
              const card: Card | null = index && resolveCard(index, name, args);
              if (!card) response = { shown: false, reason: index ? 'Nothing on the site matches that. Do not mention a card.' : 'Cards are unavailable.' };
              else if (shown.has(card.url)) response = { shown: false, reason: 'That card is already shown.' };
              else if (shown.size >= MAX_CARDS) response = { shown: false, reason: 'That is enough on screen for one answer. Answer in prose.' };
              else { shown.add(card.url); send({ card }); response = { shown: true, card }; }
              log('card', `${response.shown ? 'shown' : 'refused'}:${name}`);
              return { functionResponse: { ...(id ? { id } : {}), name, response } };
            });
          };
          let committed: string | null = null;
          for (let step = 0; step <= MAX_TOOL_ROUNDS; step++) {
            const final = step === MAX_TOOL_ROUNDS;
            let parts: Part[] = [];
            // Once a model has answered a round, the rest of the loop stays on it.
            const models: string[] = committed ? [committed] : MODELS;
            for (const [attempt, model] of models.entries()) {
              try { parts = await round(model, final); committed = model; break; } catch (error) {
                // Status only: an SDK message can quote the prompt back.
                const status = error instanceof ApiError ? error.status : error instanceof Error ? error.name : 'unknown';
                log('model', `failed:${model}:${status}`);
                // Once text or a card has gone out, switching models would
                // splice two answers together. Only a clean failure moves on.
                if (committed || answerText || shown.size || !isRetryable(error) || attempt === models.length - 1) throw error;
                signal.throwIfAborted();
              }
            }
            if (final || !parts.some(part => part.functionCall)) return;
            contents.push({ role: 'model', parts }, { role: 'user', parts: await answerCalls(parts) });
          }
        }, MODEL_DEADLINE_MS, lifetime.signal);
        log('model', 'complete');
        lifetime.signal.throwIfAborted();
        if (!answerText.trim()) throw new Error('Nothing came back. Try again.');
        // Both before the done frame: once the response closes the function
        // can be frozen, and a notice sent after it would be lost.
        await Promise.all([
          withDeadline(async signal => {
            const ts = Date.now();
            await appendTurn(cid, { r: 'u', t: query, ts }); signal.throwIfAborted();
            await appendTurn(cid, { r: 'a', t: answerText, ts });
          }, 4000, lifetime.signal).then(() => log('persistence', 'complete'), () => log('persistence', 'failed')),
          withDeadline(signal => notifyTurn({ cid, index: turnIndex, question: query, answer: answerText }, signal),
            NOTIFY_DEADLINE_MS, lifetime.signal).catch(() => log('notify', 'failed')),
        ]);
        lifetime.signal.throwIfAborted();
        completed = true;
        send({ sources }); send({ done: true }); log('response', 'complete');
      } catch (error) {
        const disconnected = lifetime.signal.aborted && lifetime.signal.reason?.name === 'AbortError';
        log('response', disconnected ? 'disconnected' : 'failed');
        // Jody hears about the questions Verso could not answer, too. Not
        // bound to the lifetime, which a timeout has already aborted.
        if (!disconnected) await withDeadline(signal => notifyTurn({ cid, index: turnIndex, question: query, failed: true }, signal),
          NOTIFY_DEADLINE_MS).catch(() => log('notify', 'failed'));
        if (!disconnected) send({ error: error instanceof Error && error.message === DAILY_CAP_MESSAGE
          ? DAILY_CAP_MESSAGE : 'The response could not finish. Try again in a moment.' });
      } finally {
        clearInterval(heartbeat); clearTimeout(hardTimer);
        request.signal.removeEventListener('abort', disconnect);
        lifetime.abort();
        try { controller.close(); } catch { /* Reader already cancelled. */ }
      }
    },
    cancel() { disconnect(); },
  });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive',
  } });
};
