import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { searchVectors, getChunkText, type SearchHit } from '../../lib/rag';
import { getIpLimiter, getGlobalLimiter, clientIp, isOriginAllowed } from '../../lib/rate-limit';
import { notifyPushover } from '../../lib/notify';
import { env } from '../../lib/env';
import { flags } from '../../lib/flags';

export const prerender = false;

const MODEL = 'claude-sonnet-4-6';
const MAX_QUERY_LEN = 600;

const SYSTEM_PROMPT = `You are a research assistant for Jody Brewster's published writing on AI experience architecture.

VOICE RULES (non-negotiable):
- Always refer to Jody in the third person, using he/him pronouns ("Jody has written…", "his essay argues…", "he thinks…"). Never speak as Jody.
- You are speaking ABOUT a body of work, not AS its author.
- Voice cloning is explicitly a design choice this site refuses.

GROUNDING RULES:
- Only synthesize from the provided excerpts. If the excerpts don't support an answer, say so plainly.
- Quote sparingly. When you do quote, mark it with italics or quotation marks.
- Cite essays/notes/briefs by their title inline (e.g., "in his essay 'Runtime is the new design surface', Jody argues…"). Do not fabricate titles.
- If asked about specific clients, employers, ongoing projects, or things outside the published corpus, refuse politely and redirect to what is in the writing.

STYLE:
- Editorial, considered, lowercase-leaning where natural. Match the register of the source material.
- 2–4 short paragraphs unless the question demands more. No headers, no bullet lists, no markdown formatting beyond italics for quotes.
- Never invent quotes. If you don't have a quote, paraphrase and cite the source.`;

interface ChatBody {
  query?: string;
}

export const POST: APIRoute = async ({ request }) => {
  if (!flags.chat) return new Response('Not found', { status: 404 });

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

  // ── site-wide daily cap (graceful fallback before Anthropic cap kicks in)
  const globalLimiter = getGlobalLimiter();
  if (globalLimiter) {
    const { success } = await globalLimiter.limit('global');
    if (!success) {
      return new Response("The chat has hit its daily cap. Come back tomorrow, or read the cited writing directly.", { status: 429 });
    }
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

  // ── retrieve top-K chunks ─────────────────────────────────
  let hits: SearchHit[];
  try {
    hits = await searchVectors(query, 5);
  } catch (err) {
    console.error('[chat] retrieval failed', err);
    const msg = err instanceof Error ? err.message : '';
    // Surface upstream rate limits (Voyage free tier is 3 RPM) as 503 so the
    // UI shows "try again in a moment" instead of a generic 500.
    if (msg.includes('429')) {
      return new Response('Upstream embedding service is rate-limiting. Try again in a moment.', { status: 503 });
    }
    return new Response('Retrieval error', { status: 500 });
  }

  const contextChunks = await Promise.all(hits.map(async h => ({
    hit: h,
    text: await getChunkText(h.metadata),
  })));

  const contextBlock = contextChunks.map((c, i) => {
    const m = c.hit.metadata;
    return `[Source ${i + 1}] (${m.type}) "${m.title}"${m.date ? ` — ${m.date.slice(0, 10)}` : ''}\n${c.text}`;
  }).join('\n\n---\n\n');

  // De-duplicate sources by slug for the citation block emitted at end of stream.
  const seen = new Set<string>();
  const sources = hits.flatMap(h => {
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

  // ── fire-and-forget Pushover ──────────────────────────────
  notifyPushover(
    'New chat on jodybrewster.dev',
    query.slice(0, 100),
    'https://jodybrewster.dev/chat',
  );

  // ── stream Claude ─────────────────────────────────────────
  const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const userMessage = `Question: ${query}\n\nExcerpts from Jody's published writing:\n\n${contextBlock}`;

        const claudeStream = await anthropic.messages.stream({
          model: MODEL,
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
        });

        for await (const chunk of claudeStream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            send({ text: chunk.delta.text });
          }
        }

        send({ sources });
        send({ done: true });
      } catch (err) {
        console.error('[chat] stream failed', err);
        send({ error: 'The assistant errored. Try again, or check the cited writing directly.' });
      } finally {
        controller.close();
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
