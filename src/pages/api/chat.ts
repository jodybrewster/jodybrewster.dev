import type { APIRoute } from 'astro';
import { ApiError, FunctionCallingConfigMode, GoogleGenAI, ThinkingLevel, type Content, type Part } from '@google/genai';
import { searchVectors, getChunkText, type SourceMetadata } from '../../lib/rag';
import { isOriginAllowed } from '../../lib/origin';
import { chatLimiter, check, visitor } from '../../lib/limits';
import type { Allowed } from '@jodybrewster/gemini-live/server/limits';
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
import { linkedPaths, sitePaths } from '../../lib/verso-links';
import { alertModelFailure, describeModelFailure, holdQuestion, liveUntil, notifyTurn, takeHeld, type ModelFailure } from '../../lib/operator';
import { logEntries } from '../../lib/transcripts';
import { TOPIC_PROMPT, parseTopic, type Topic } from '../../lib/topics';

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
/** Tagging runs beside retrieval and is dropped if it is not back in time. */
const TOPIC_MODEL = 'gemini-3.5-flash-lite';
const TOPIC_DEADLINE_MS = 6000;
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
  const data = body as { query: string; cid?: unknown; page?: unknown; fallback?: unknown };
  // Sent by the dock when Jody's window ran out, or the visitor chose not to wait.
  const fallback = data.fallback === true;
  // Where the question was asked, for the transcript. A path on this site or nothing.
  const page = typeof data.page === 'string' && /^\/[\w\-./]{0,199}$/.test(data.page) ? data.page : undefined;
  const query = data.query.trim();
  if (!query) return new Response('query required', { status: 400 });
  if (query.length > MAX_QUERY_LEN) return new Response(`query too long (max ${MAX_QUERY_LEN} chars)`, { status: 413 });
  if (!isOriginAllowed(request)) return new Response('Forbidden', { status: 403 });
  if (!getRedis() && env('VERCEL_ENV') === 'production') return new Response(UNAVAILABLE, { status: 503 });
  const posted = isValidConversationId(data.cid) ? data.cid : null;
  const cid = posted ?? crypto.randomUUID();
  const mid = crypto.randomUUID();
  const log = (stage: string, status: string) => console.info('[chat]', { mid, stage, status, elapsedMs: Date.now() - started });
  let history: ConversationTurn[] = [];
  // Spends the per-IP rate now; the site-wide quota is only checked here
  // (refused when nothing is left) and spent just before the model call.
  let allowed: Allowed<'ip' | 'global'> | null = null;
  try {
    const denied = await withDeadline(async signal => {
      const decision = await check(chatLimiter, visitor(request));
      signal.throwIfAborted();
      if (!decision.ok) {
        if (decision.code === 'unavailable') return new Response(UNAVAILABLE, { status: 503 });
        if (decision.rule === 'global') return new Response(DAILY_CAP_MESSAGE, { status: 429 });
        return new Response('Rate limit exceeded. Try again in a minute.', { status: 429 });
      }
      allowed = decision;
      history = posted ? await readHistory(cid) : [];
      signal.throwIfAborted();
      if (posted && await conversationLength(cid) >= MAX_TURNS_PER_CONV * 2) {
        return new Response('This conversation has run long. Start a new chat to continue.', { status: 429 });
      }
      return null;
    }, 4000, request.signal);
    if (denied) return denied;
    log('setup', 'complete');
  } catch {
    log('setup', 'unavailable');
    return new Response(UNAVAILABLE, { status: 503 });
  }
  const turnIndex = history.filter(turn => turn.r === 'u').length + 1;
  // Jody replied a moment ago, so this question waits for him rather than Verso.
  const holdUntil = posted && !fallback ? await withDeadline(() => liveUntil(cid), 2000, request.signal).catch(() => null) : null;
  if (holdUntil) {
    log('hold', 'jody');
    return holdForJody({ cid, mid, query, page, index: turnIndex, until: holdUntil });
  }
  // The visitor stopped waiting for Jody. Clear the held question now, before
  // anything can fail, or a later reply of his would be filed against it.
  if (posted && fallback) await withDeadline(() => takeHeld(cid), 2000, request.signal).catch(() => null);
  if (!env('GEMINI_API_KEY')) return new Response(UNAVAILABLE, { status: 503 });
  const ai = new GoogleGenAI({ apiKey: env('GEMINI_API_KEY'), httpOptions: { retryOptions: { attempts: 1 } } });
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
      /** The last model error, reported to Jody if the turn fails. */
      let modelFailure: ModelFailure | null = null;
      let sources: CitedSource[] = [];
      let topicTag: Promise<Topic | null> = Promise.resolve(null);
      try {
        lifetime.signal.throwIfAborted();
        send({ cid, mid });
        // Never awaited on its own: a slow or failed tag costs the topic, not the answer.
        topicTag = withDeadline(async signal => {
          const result = await ai.models.generateContent({
            model: TOPIC_MODEL, contents: query,
            config: { systemInstruction: TOPIC_PROMPT, maxOutputTokens: 64, abortSignal: signal },
          });
          return parseTopic(result.text);
        }, TOPIC_DEADLINE_MS, lifetime.signal).catch(() => null);
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
        const spent = await withDeadline(() => allowed!.spend('global'), 3000, lifetime.signal);
        if (spent) throw new Error(spent.code === 'unavailable' ? UNAVAILABLE : DAILY_CAP_MESSAGE);
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
                modelFailure = describeModelFailure(model, String(status), error instanceof Error ? error.message : '');
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
        const topic = await topicTag ?? undefined;
        if (topic) send({ topic });
        // Which of the answer's links point at real pages. The dock draws only those.
        const links = await withDeadline(async () => linkedPaths(answerText, sitePaths((await buildCardIndex()).pages)),
          2000, lifetime.signal).catch(() => [] as string[]);
        if (links.length) send({ links });
        const ts = Date.now();
        // All before the done frame: once the response closes the function
        // can be frozen, and anything sent after it would be lost.
        await Promise.all([
          withDeadline(async signal => {
            await appendTurn(cid, { r: 'u', t: query, ts }); signal.throwIfAborted();
            await appendTurn(cid, { r: 'a', t: answerText, ts });
          }, 4000, lifetime.signal).then(() => log('persistence', 'complete'), () => log('persistence', 'failed')),
          withDeadline(signal => notifyTurn({ cid, index: turnIndex, question: query, answer: answerText, topic }, signal),
            NOTIFY_DEADLINE_MS, lifetime.signal).catch(() => log('notify', 'failed')),
          // A held question was logged when it was held; only the answer is new.
          withDeadline(() => logEntries(cid, fallback ? [{ r: 'a', t: answerText, ts }] : [{ r: 'u', t: query, ts, topic, page }, { r: 'a', t: answerText, ts }]),
            4000, lifetime.signal).catch(() => log('transcript', 'failed')),
        ]);
        lifetime.signal.throwIfAborted();
        completed = true;
        send({ sources }); send({ done: true }); log('response', 'complete');
      } catch (error) {
        const disconnected = lifetime.signal.aborted && lifetime.signal.reason?.name === 'AbortError';
        log('response', disconnected ? 'disconnected' : 'failed');
        // Jody hears about the questions Verso could not answer, too. Not
        // bound to the lifetime, which a timeout has already aborted.
        if (!disconnected) {
          const topic = await Promise.race([topicTag, new Promise<null>(resolve => setTimeout(resolve, 1000, null))]) ?? undefined;
          const failure = modelFailure;
          await Promise.all([
            withDeadline(signal => notifyTurn({ cid, index: turnIndex, question: query, failed: true, topic }, signal),
              NOTIFY_DEADLINE_MS).catch(() => log('notify', 'failed')),
            failure ? withDeadline(signal => alertModelFailure(failure, signal), NOTIFY_DEADLINE_MS).catch(() => log('alert', 'failed')) : Promise.resolve(),
            fallback ? Promise.resolve() : withDeadline(() => logEntries(cid, [{ r: 'u', t: query, ts: Date.now(), topic, page, failed: true }]),
              NOTIFY_DEADLINE_MS).catch(() => log('transcript', 'failed')),
          ]);
        }
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

/**
 * A question asked while Jody is live in the conversation. Verso does not
 * answer: the question goes to his phone and the dock is told how long to
 * wait. Everything is sent before `done` so it survives the function
 * freezing, and none of it can fail the response.
 */
function holdForJody(turn: { cid: string; mid: string; query: string; page?: string; index: number; until: number }): Response {
  const { cid, mid, query, page, index, until } = turn;
  const encoder = new TextEncoder();
  const frame = (event: Record<string, unknown>) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(frame({ cid, mid }));
      controller.enqueue(frame({ hold: { until } }));
      const waitSeconds = Math.max(1, Math.round((until - Date.now()) / 1000));
      await Promise.all([
        withDeadline(signal => notifyTurn({ cid, index, question: query, waitSeconds }, signal), NOTIFY_DEADLINE_MS).catch(() => {}),
        withDeadline(() => holdQuestion(cid, query), NOTIFY_DEADLINE_MS).catch(() => {}),
        withDeadline(() => logEntries(cid, [{ r: 'u', t: query, ts: Date.now(), page, held: true }]), NOTIFY_DEADLINE_MS).catch(() => {}),
      ]);
      controller.enqueue(frame({ done: true }));
      controller.close();
    },
  });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive',
  } });
}
