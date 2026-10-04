/**
 * MCP server (Streamable HTTP transport, stateless mode).
 *
 * Speaks JSON-RPC 2.0 over POST. Six read-only tools over the published
 * corpus. No auth — this is a public read surface, and OAuth on a read-only
 * endpoint would be theater. Responds with application/json since all tools
 * return synchronously and no server-initiated messages are emitted.
 *
 * Spec ref: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http
 *
 * Public, so limits are its protection: one JSON-RPC message per request
 * (batching was dropped in 2025-06-18, and it turned one request into many
 * model calls), JSON only, no other site's pages (a present, foreign Origin
 * is refused), bounded bodies and queries, and every tool call limited per
 * IP, with ask_jody capped per IP, in calls a day and in tokens a day
 * (lib/limits.ts).
 */
import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { listCollection, readDoc, readNowFile } from '../../lib/corpus';
import { searchVectors, getChunkText } from '../../lib/rag';
import { env } from '../../lib/env';
import { MAX_QUERY_LEN } from '../../lib/verso';
import { isForeignOrigin } from '../../lib/origin';
import { ASK_MAX_OUTPUT_TOKENS, askLimiter, check, mcpLimiter, visitor } from '../../lib/limits';
import { createTokenBudget, estimateTokens, type Allowed } from '@jodybrewster/gemini-live/server/limits';

export const prerender = false;

const PROTOCOL_VERSION = '2025-06-18';
const MAX_BODY = 16_384;
const BUSY = 'Rate limit exceeded. Try again later.';
const UNAVAILABLE = 'Temporarily unavailable. Try again shortly.';
const SERVER_INFO = { name: 'jodybrewster-dev', version: '0.1.0' };

const ASK_JODY_SYSTEM = `You are a research assistant for Jody Brewster's published writing. Always refer to Jody in the third person using he/him pronouns. Only synthesize from the provided excerpts; refuse questions outside the corpus. Cite essays/notes/briefs by title. 2–4 short paragraphs.`;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const TOOLS = [
  {
    name: 'search_writing',
    description: "Semantic search over Jody's essays and notes. Returns titles, dates, and short snippets for the top matches.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for.' },
        limit: { type: 'number', description: 'Max results (default 5, max 10).', default: 5 },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_essay',
    description: 'Return the full markdown of an essay by slug.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string', description: "Essay slug, e.g. 'runtime-is-the-new-design-surface'." } },
      required: ['slug'],
    },
  },
  {
    name: 'list_notes',
    description: "List Jody's published notes, optionally filtered by status (seedling, budding, evergreen).",
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['seedling', 'budding', 'evergreen'] },
        limit: { type: 'number', default: 20 },
      },
    },
  },
  {
    name: 'get_case_brief',
    description: 'Return a full case brief by slug, including sector/role/duration metadata.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string' } },
      required: ['slug'],
    },
  },
  {
    name: 'whats_top_of_mind',
    description: "Return what Jody is currently focused on (the /now page).",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ask_jody',
    description: "Ask a natural-language question. Answers in third person, grounded in published writing, with citations. Use for synthesis questions; use search_writing for retrieval.",
    inputSchema: {
      type: 'object',
      properties: { question: { type: 'string' } },
      required: ['question'],
    },
  },
];

function ok(id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function err(id: JsonRpcRequest['id'], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function textContent(text: string) {
  return { content: [{ type: 'text', text }] };
}

async function callTool(name: string, args: Record<string, unknown>, ask?: Allowed<'ip' | 'calls' | 'tokens'>): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  switch (name) {
    case 'search_writing': {
      const query = String(args.query ?? '').trim();
      const limit = Math.min(10, Math.max(1, Number(args.limit ?? 5)));
      if (!query) return { ...textContent('query is required'), isError: true };
      if (query.length > MAX_QUERY_LEN) return { ...textContent(`query too long (max ${MAX_QUERY_LEN} characters)`), isError: true };
      const hits = await searchVectors(query, limit);
      if (hits.length === 0) return textContent('No matches.');
      const lines = await Promise.all(hits.map(async (h, i) => {
        const snippet = (await getChunkText(h.metadata)).slice(0, 280).replace(/\s+/g, ' ');
        return `${i + 1}. ${h.metadata.title} (${h.metadata.type}${h.metadata.date ? `, ${h.metadata.date.slice(0, 10)}` : ''}) — score ${h.score.toFixed(3)}\n   ${snippet}…\n   https://jodybrewster.dev${h.metadata.url}`;
      }));
      return textContent(lines.join('\n\n'));
    }

    case 'get_essay': {
      const slug = String(args.slug ?? '');
      const doc = await readDoc('writing', slug);
      if (!doc) return { ...textContent(`No essay found with slug "${slug}"`), isError: true };
      return textContent(doc.raw);
    }

    case 'list_notes': {
      const status = args.status ? String(args.status) : null;
      const limit = Math.min(50, Math.max(1, Number(args.limit ?? 20)));
      const notes = (await listCollection('notes'))
        .filter(n => !status || n.fm.status === status)
        .sort((a, b) => (b.fm.date ?? '').localeCompare(a.fm.date ?? ''))
        .slice(0, limit);
      if (notes.length === 0) return textContent('No notes matched.');
      const lines = notes.map(n => `- ${n.fm.title ?? n.slug} [${n.fm.status ?? '—'}] ${n.fm.date ? `(${String(n.fm.date).slice(0, 10)})` : ''}\n  https://jodybrewster.dev${n.url}`);
      return textContent(lines.join('\n'));
    }

    case 'get_case_brief': {
      const slug = String(args.slug ?? '');
      const doc = await readDoc('work', slug);
      if (!doc) return { ...textContent(`No brief found with slug "${slug}"`), isError: true };
      return textContent(doc.raw);
    }

    case 'whats_top_of_mind': {
      const now = await readNowFile();
      if (!now) return textContent('No /now content yet.');
      return textContent(now.body);
    }

    case 'ask_jody': {
      const question = String(args.question ?? '').trim();
      if (!question) return { ...textContent('question is required'), isError: true };
      if (question.length > MAX_QUERY_LEN) return { ...textContent(`question too long (max ${MAX_QUERY_LEN} characters)`), isError: true };
      const hits = await searchVectors(question, 5);
      const context = await Promise.all(hits.map(async (h, i) => {
        const text = await getChunkText(h.metadata);
        return `[Source ${i + 1}] (${h.metadata.type}) "${h.metadata.title}"\n${text}`;
      }));
      const content = `Question: ${question}\n\nExcerpts:\n\n${context.join('\n\n---\n\n')}`;
      // Spend one of the day's calls and reserve the worst case from the
      // token budget before calling Anthropic; settle from the usage after.
      if (!ask) throw new Error('ask_jody needs its limit decision');
      const noCall = await ask.spend('calls');
      if (noCall) return { ...textContent(noCall.code === 'unavailable' ? UNAVAILABLE : BUSY), isError: true };
      const budget = createTokenBudget(ask, ['tokens']);
      const noTokens = await budget.reserve(estimateTokens(ASK_JODY_SYSTEM + content) + ASK_MAX_OUTPUT_TOKENS);
      if (noTokens) {
        await ask.refund('calls');
        return { ...textContent(noTokens.code === 'unavailable' ? UNAVAILABLE : BUSY), isError: true };
      }
      const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') });
      // A failed call keeps its reservation: Anthropic may already have billed it.
      const resp = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: ASK_MAX_OUTPUT_TOKENS,
        system: ASK_JODY_SYSTEM,
        messages: [{ role: 'user', content }],
      });
      await budget.settle((resp.usage?.input_tokens ?? 0) + (resp.usage?.output_tokens ?? 0));
      const text = resp.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('');
      const citations = hits.map((h, i) => `[${i + 1}] ${h.metadata.title} — https://jodybrewster.dev${h.metadata.url}`).join('\n');
      return textContent(`${text}\n\nSources:\n${citations}`);
    }

    default:
      return { ...textContent(`Unknown tool: ${name}`), isError: true };
  }
}

/**
 * The free checks, before anything is spent: a missing or overlong query
 * must not use up a limit, or junk could drain the daily cap.
 */
function invalidArgs(name: string, args: Record<string, unknown>): string | null {
  const field = name === 'ask_jody' ? 'question' : name === 'search_writing' ? 'query' : null;
  if (!field) return null;
  const value = String(args[field] ?? '').trim();
  if (!value) return `${field} is required`;
  if (value.length > MAX_QUERY_LEN) return `${field} too long (max ${MAX_QUERY_LEN} characters)`;
  return null;
}

/**
 * Spends this tool call against its limits: every tool counts per IP, and
 * ask_jody also against its own per-IP rate (its daily calls and tokens are
 * spent just before the model call). Fails closed: a store that cannot be
 * built (no Redis on a deployment), a store error or a missed deadline
 * refuses. Local dev counts in memory.
 */
async function admit(name: string, request: Request): Promise<{ refused: { status: number; message: string } } | { ask?: Allowed<'ip' | 'calls' | 'tokens'> }> {
  const who = visitor(request);
  const refuse = (code: string) => ({ refused: code === 'unavailable' ? { status: 503, message: UNAVAILABLE } : { status: 429, message: BUSY } });
  const tool = await check(mcpLimiter, who);
  if (!tool.ok) return refuse(tool.code);
  if (name !== 'ask_jody') return {};
  const ask = await check(askLimiter, who);
  if (!ask.ok) return refuse(ask.code);
  return { ask };
}

async function handle(req: JsonRpcRequest, request: Request): Promise<JsonRpcResponse | null> {
  // Notifications (no id) get no response.
  if (req.id === undefined || req.id === null) {
    // notifications/initialized, notifications/cancelled, etc — ignore.
    return null;
  }

  try {
    switch (req.method) {
      case 'initialize':
        return ok(req.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: "Tools over Jody Brewster's published writing. Read-only and unauthenticated. Cite sources when you pass output downstream.",
        });

      case 'ping':
        return ok(req.id, {});

      case 'tools/list':
        return ok(req.id, { tools: TOOLS });

      case 'tools/call': {
        const params = req.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
        const name = params?.name;
        if (!name) return err(req.id, -32602, 'tools/call: name required');
        const invalid = invalidArgs(name, params?.arguments ?? {});
        if (invalid) return ok(req.id, { ...textContent(invalid), isError: true });
        const admitted = await admit(name, request);
        if ('refused' in admitted) {
          const { status, message } = admitted.refused;
          return { ...err(req.id, status === 429 ? -32029 : -32003, message), status } as JsonRpcResponse;
        }
        const result = await callTool(name, params?.arguments ?? {}, admitted.ask);
        return ok(req.id, result);
      }

      default:
        return err(req.id, -32601, `Method not found: ${req.method}`);
    }
  } catch (e) {
    // The name only: an SDK error can carry request details.
    console.error('[mcp] error in', req.method, e instanceof Error ? e.name : 'unknown');
    return err(req.id, -32603, 'Internal error');
  }
}

const reply = (body: JsonRpcResponse, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  // Other sites' pages could otherwise spend through their visitors' browsers.
  if (isForeignOrigin(request)) return reply(err(null, -32003, 'Forbidden'), 403);
  // JSON only: a text/plain POST needs no CORS preflight.
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) {
    return reply(err(null, -32700, 'Content-Type must be application/json'), 415);
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return reply(err(null, -32600, 'Request too large'), 413);

  let payload: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return reply(err(null, -32600, 'Request too large'), 413);
    payload = JSON.parse(text);
  } catch {
    return reply(err(null, -32700, 'Parse error'), 400);
  }

  // One message per request: batching turned one request into many model calls.
  if (Array.isArray(payload)) return reply(err(null, -32600, 'Batching is not supported'), 400);
  if (!payload || typeof payload !== 'object' || typeof (payload as JsonRpcRequest).method !== 'string') {
    return reply(err(null, -32600, 'Invalid Request'), 400);
  }

  const response = await handle(payload as JsonRpcRequest, request);
  if (!response) return new Response(null, { status: 202 });
  const { status = 200, ...body } = response as JsonRpcResponse & { status?: number };
  return reply(body, status);
};

export const GET: APIRoute = () =>
  new Response('MCP endpoint. POST JSON-RPC 2.0 to this URL.', {
    status: 405,
    headers: { 'Content-Type': 'text/plain', Allow: 'POST' },
  });
