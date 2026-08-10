import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { searchVectors, getChunkText, type SearchHit, type SourceMetadata } from '../../lib/rag';
import { getIpLimiter, getGlobalLimiter, clientIp, isOriginAllowed } from '../../lib/rate-limit';
import { getRedis } from '../../lib/redis';
import {
  HANDOFF_WINDOW_MS,
  POLL_INTERVAL_MS,
  isOperatorOnline,
  readHistory,
  appendTurn,
  conversationLength,
  putPending,
  claim,
  getReply,
  putFinal,
  mapTelegramMessage,
  setLastQuestion,
} from '../../lib/handoff';
import { telegramConfigured, formatQuestionMessage, sendQuestion } from '../../lib/telegram';
import {
  SYSTEM_PROMPT,
  MAX_QUERY_LEN,
  MAX_TURNS_PER_CONV,
  isValidConversationId,
  retrievalQuery,
  buildMessages,
  chunkForTyping,
  typingDelayMs,
  type ConversationTurn,
} from '../../lib/verso';
import { env } from '../../lib/env';
import { flags } from '../../lib/flags';

/**
 * Verso's one endpoint: retrieve, ask the human, and let the model answer when
 * he doesn't.
 *
 * The unusual shape here is that the wait IS the request. When the operator is
 * online the question goes to Telegram and this response stays open, polling
 * Redis, for up to HANDOFF_WINDOW_MS. There are no background workers on
 * Vercel and no second channel back to the browser, so the only thing that can
 * hold a visitor between "asked" and "answered" is the connection they already
 * have. Everything below is arranged around not dropping it.
 *
 * The visitor is never told which side answered. A human reply is played back
 * at the same pace the model streams at, because latency is the only tell that
 * would otherwise give it away.
 */

export const prerender = false;

const MODEL = 'claude-sonnet-4-6';

/** Vercel's maxDuration is 90s (astro.config.mjs). Stopping ten seconds short
 *  means the stream closes itself rather than being cut mid-frame, which would
 *  leave the client reading a body that never ends. */
const HARD_DEADLINE_MS = 80_000;

/** Idle streams get collapsed by proxies and by phones putting the radio to
 *  sleep. Nothing else travels during the handoff window, so a comment frame
 *  does the work. */
const HEARTBEAT_MS = 10_000;

/** How long to keep looking for a reply after losing the claim race at the
 *  deadline. Covers the gap between the webhook claiming and writing. */
const REPLY_GRACE_MS = 3_000;

const DAILY_CAP_MESSAGE =
  'The chat has hit its daily cap. Come back tomorrow, or read the cited writing directly.';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** The citation block the client renders under an answer. */
interface CitedSource {
  type: SourceMetadata['type'];
  slug: string;
  title: string;
  date: string;
  url: string;
  score: number;
}

interface ChatBody {
  query?: string;
  cid?: string;
}

/**
 * The exchange before this one, for the Telegram header. Scans backwards for
 * the last answer and the question that produced it, so a log left ragged by a
 * retry still yields a usable preview instead of a mismatched pair.
 */
function lastExchange(history: ConversationTurn[]): { prevQ?: string; prevA?: string } {
  let prevA: string | undefined;
  let prevQ: string | undefined;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const turn = history[i];
    if (!turn || typeof turn.t !== 'string') continue;
    if (prevA === undefined && turn.r === 'a') prevA = turn.t;
    else if (prevA !== undefined && prevQ === undefined && turn.r === 'u') prevQ = turn.t;
    if (prevA !== undefined && prevQ !== undefined) break;
  }
  return { prevQ, prevA };
}

export const POST: APIRoute = async ({ request }) => {
  if (!flags.chat) return new Response('Not found', { status: 404 });

  const hardDeadline = Date.now() + HARD_DEADLINE_MS;

  let body: ChatBody;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const query = (body.query ?? '').trim();
  if (!query) return new Response('query required', { status: 400 });
  if (query.length > MAX_QUERY_LEN) {
    return new Response(`query too long (max ${MAX_QUERY_LEN} chars)`, { status: 413 });
  }

  // ── origin check (prod only) ──────────────────────────────
  if (!isOriginAllowed(request)) {
    return new Response('Forbidden', { status: 403 });
  }

  // ── fail closed without Redis, in production only ─────────
  // Both limiters are built on the Redis client, and a null client makes them
  // null too - which is to say no rate limiting whatsoever, on a route that
  // spends the Anthropic key. That is a worse outcome than being down. Dev
  // still fails open so `astro dev` runs without an Upstash account.
  if (!getRedis() && env('VERCEL_ENV') === 'production') {
    return new Response('Chat is temporarily unavailable. Try again shortly.', { status: 503 });
  }

  // ── per-IP rate limit ─────────────────────────────────────
  const ipLimiter = getIpLimiter();
  if (ipLimiter) {
    const ip = clientIp(request);
    const { success } = await ipLimiter.limit(ip);
    if (!success) {
      return new Response('Rate limit exceeded. Try again in a minute.', { status: 429 });
    }
  }

  // ── conversation ──────────────────────────────────────────
  // A posted id that isn't a canonical UUID is replaced rather than repaired:
  // it goes into Redis key names, and a fresh conversation is a cheaper
  // failure than a poisoned key. A minted id has nothing stored under it, so
  // both reads below are skipped for one.
  const posted = isValidConversationId(body.cid) ? body.cid : null;
  const cid = posted ?? crypto.randomUUID();
  const mid = crypto.randomUUID();

  const history = posted ? await readHistory(cid) : [];
  if (posted && (await conversationLength(cid)) >= MAX_TURNS_PER_CONV * 2) {
    return new Response(
      'This conversation has run long. Reload the page to start a fresh one.',
      { status: 429 },
    );
  }

  // ── site-wide daily budget, checked but not yet spent ─────
  // Only the model spends this budget; a question Jody answers himself costs
  // nothing, so an exhausted budget must not turn away a visitor he is
  // standing by to answer. `getRemaining` reads the window without consuming
  // from it, and the token is taken in runModel() at the moment it is earned.
  // Presence is read once here and reused for the handoff below - the two
  // decisions are a few milliseconds apart and share one answer.
  const operatorOnline = await isOperatorOnline();
  const globalLimiter = getGlobalLimiter();
  if (globalLimiter && !operatorOnline) {
    const { remaining } = await globalLimiter.getRemaining('global');
    if (remaining <= 0) {
      return new Response(DAILY_CAP_MESSAGE, { status: 429 });
    }
  }

  const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // A visitor who closes the tab cancels the stream, but not this handler.
      // Enqueueing into a dead controller throws, and that throw would skip
      // the persist in the finally block - so writes degrade to no-ops and
      // the answer still lands in the transcript.
      let live = true;
      const write = (raw: string) => {
        if (!live) return;
        try {
          controller.enqueue(encoder.encode(raw));
        } catch {
          live = false;
        }
      };
      const send = (event: Record<string, unknown>) => write(`data: ${JSON.stringify(event)}\n\n`);
      // An SSE comment. The client skips anything that isn't a `data: ` frame.
      const ping = () => write(': ping\n\n');

      let answerText = '';
      let answeredBy: 'human' | 'llm' = 'llm';
      let sources: CitedSource[] = [];
      let retrieval: Promise<SearchHit[]> | null = null;

      /**
       * Push the question to Telegram and park on it. Returns his reply, or
       * null if the window closed without one and the model should answer.
       */
      async function askOperator(): Promise<string | null> {
        const index = Math.floor(history.length / 2) + 1;
        await putPending(mid, { cid, q: query, ts: Date.now(), index });

        // Retrieval runs about a second, and it is a second of dead air if it
        // waits for the window to close. Started now, thrown away if he
        // answers. The catch marks the rejection handled at birth: an
        // abandoned promise that rejects later takes the process down with it,
        // and the model path re-awaits this and handles the failure properly.
        retrieval = searchVectors(retrievalQuery(history, query), 5);
        retrieval.catch(() => {});

        const { prevQ, prevA } = lastExchange(history);
        const tgMessageId = await sendQuestion(formatQuestionMessage({
          cid,
          question: query,
          index,
          prevQ,
          prevA,
          windowSeconds: Math.round(HANDOFF_WINDOW_MS / 1000),
        }));

        // Telegram is down, or the owner never sent the bot /start. Either way
        // the question is on nobody's phone, so waiting on it is 40 seconds of
        // the visitor watching nothing happen.
        if (tgMessageId === null) return null;

        await mapTelegramMessage(tgMessageId, mid);
        await setLastQuestion(mid);

        const deadline = Date.now() + HANDOFF_WINDOW_MS;
        let nextPing = Date.now() + HEARTBEAT_MS;

        while (Date.now() < deadline) {
          await sleep(POLL_INTERVAL_MS);

          // The webhook takes the claim before it writes the reply, so text
          // being readable here means the human side has already won.
          const reply = await getReply(mid);
          if (reply) return reply;

          if (Date.now() >= nextPing) {
            ping();
            nextPing = Date.now() + HEARTBEAT_MS;
          }
        }

        // The window is up. Both racers call claim; Redis picks one. Losing
        // means his reply landed in the same instant, and it wins.
        if (await claim(mid, 'llm')) return null;

        // The claim is taken before the reply is written, so the text can be a
        // beat behind the claim we just lost. Reading once and finding nothing
        // would answer over the top of him, which is the one outcome the claim
        // exists to prevent.
        const graceUntil = Date.now() + REPLY_GRACE_MS;
        while (Date.now() < graceUntil) {
          const late = await getReply(mid);
          if (late) return late;
          await sleep(POLL_INTERVAL_MS);
        }
        return null;
      }

      /** Replay a human answer at the model's typing pace. */
      async function playBack(text: string): Promise<void> {
        const chunks = chunkForTyping(text);
        const delay = typingDelayMs(chunks.length);
        for (let i = 0; i < chunks.length; i += 1) {
          send({ text: chunks[i] });
          // No trailing sleep: the last chunk is followed by the close, and
          // pausing before it is a pause the reader can only read as lag.
          if (delay > 0 && i < chunks.length - 1) await sleep(delay);
        }
        // The client's renderer treats an empty array as no citation block. A
        // human answer cites nothing, and saying so keeps the frame sequence
        // identical to the model's.
        send({ sources: [] });
        send({ done: true });
      }

      async function runModel(): Promise<void> {
        let hits: SearchHit[];
        let contextBlock: string;
        try {
          hits = await (retrieval ?? searchVectors(retrievalQuery(history, query), 5));
          const contextChunks = await Promise.all(hits.map(async h => ({
            hit: h,
            text: await getChunkText(h.metadata),
          })));
          contextBlock = contextChunks.map((c, i) => {
            const m = c.hit.metadata;
            return `[Source ${i + 1}] (${m.type}) "${m.title}"${m.date ? ` - ${m.date.slice(0, 10)}` : ''}\n${c.text}`;
          }).join('\n\n---\n\n');
        } catch (err) {
          console.error('[chat] retrieval failed', err);
          // Headers went out with the opening frame, so there is no status
          // code left to say this with. Voyage's free tier is 3 RPM and 429s
          // are the common failure, worth naming as transient.
          const msg = err instanceof Error ? err.message : '';
          send({
            error: msg.includes('429')
              ? 'Upstream embedding service is rate-limiting. Try again in a moment.'
              : 'Retrieval failed. Try again, or read the cited writing directly.',
          });
          return;
        }

        // De-duplicate sources by slug for the citation block emitted at end of stream.
        const seen = new Set<string>();
        sources = hits.flatMap(h => {
          const key = `${h.metadata.type}:${h.metadata.slug}`;
          if (seen.has(key)) return [];
          seen.add(key);
          return [{
            type: h.metadata.type,
            slug: h.metadata.slug,
            title: h.metadata.title,
            date: h.metadata.date ? h.metadata.date.slice(0, 10) : '',
            url: h.metadata.url,
            score: Number(h.score.toFixed(3)),
          }];
        });

        // Spent here and nowhere else, immediately before the only call the
        // budget exists to cap. Everything above this line is free.
        if (globalLimiter) {
          const { success } = await globalLimiter.limit('global');
          if (!success) {
            send({ error: DAILY_CAP_MESSAGE });
            return;
          }
        }

        // Not awaited: `stream()` hands back the MessageStream itself, and
        // errors surface through the iterator below rather than here.
        const claudeStream = anthropic.messages.stream({
          model: MODEL,
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: buildMessages(history, query, contextBlock),
        });

        for await (const chunk of claudeStream) {
          if (Date.now() > hardDeadline) {
            console.warn('[chat] hard deadline reached, truncating model stream');
            // Nobody will read the rest of this answer, so stop generating it.
            // The listener is required: abort() with no handler attached
            // rejects globally and takes the process with it.
            claudeStream.on('abort', () => {});
            claudeStream.abort();
            break;
          }
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            answerText += chunk.delta.text;
            send({ text: chunk.delta.text });
          }
        }

        send({ sources });
        send({ done: true });
      }

      try {
        // Opening frame. Carries the ids a client needs to resume, and flushes
        // the headers so the browser has committed to the connection before
        // the handoff window starts holding it open. The current client
        // ignores frames it has no field for.
        send({ cid, mid });

        const humanReply = operatorOnline && telegramConfigured() ? await askOperator() : null;

        if (humanReply) {
          answeredBy = 'human';
          answerText = humanReply;
          await playBack(humanReply);
        } else {
          await runModel();
        }
      } catch (err) {
        console.error('[chat] stream failed', err);
        send({ error: 'The assistant errored. Try again, or check the cited writing directly.' });
      } finally {
        // Written before the close, not after: once the body ends the platform
        // is free to freeze the function, and a persist racing that would
        // silently lose the turn. It costs the reader a few tens of
        // milliseconds before the citation block paints.
        if (answerText.trim()) {
          const ts = Date.now();
          await appendTurn(cid, { r: 'u', t: query, ts });
          await appendTurn(cid, { r: 'a', t: answerText, ts, by: answeredBy });
          await putFinal(mid, { by: answeredBy, text: answerText, sources, ts });
        }
        try {
          controller.close();
        } catch {
          // Already torn down by a client disconnect.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
};
