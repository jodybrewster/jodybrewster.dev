import {
  clientIp,
  createLimiter,
  limitStoreFromEnv,
  type Decision,
  type Limiter,
  type LimitStore,
  type Rule,
} from '@jodybrewster/gemini-live/server/limits';
import { env } from './env';

/**
 * Every rate limit on the site, on the framework's limiter (M1 1.5):
 * Upstash on Vercel (RATE_LIMIT_STORE defaults to upstash there, and a
 * missing URL or token refuses every limited route with 503), memory in
 * `astro dev`. Every limiter fails closed: a store error or a missed
 * deadline refuses. Windows are fixed (a UTC day on Upstash), so up to twice
 * a daily cap can pass around midnight UTC.
 *
 * Voice sessions are capped by the voice token handler
 * (src/pages/api/live-token.ts), on the same store.
 */

type Env = Record<string, string | undefined>;
const KEYS = ['NODE_ENV', 'VERCEL', 'RATE_LIMIT_STORE', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'] as const;

/** The limiter's environment: Astro's and Vercel's sources, Upstash by default on Vercel. */
export function limitEnv(read: (key: string) => string | undefined = env): Env {
  const out: Env = Object.fromEntries(KEYS.map(key => [key, read(key)]));
  out.NODE_ENV ??= import.meta.env.DEV ? 'development' : 'production';
  if (out.VERCEL) out.RATE_LIMIT_STORE ??= 'upstash';
  return out;
}

let store: LimitStore | null = null;
const getStore = () => (store ??= limitStoreFromEnv(limitEnv()));

function lazy<R extends string>(prefix: string, rules: Record<R, Rule>): () => Limiter<R> {
  let limiter: Limiter<R> | null = null;
  return () => (limiter ??= createLimiter({ store: getStore(), prefix, rules, failClosed: true, deadlineMs: 3000 }));
}

// The chat is multi-turn, so a real conversation sends several requests in a
// row; scripted abuse still hits 5 a minute fast. 75 answers a day site-wide
// keeps the site under the Gemini spend cap, so visitors get a graceful
// "daily limit" instead of an upstream failure (double that across midnight).
export const chatLimiter = lazy('rl:chat', {
  ip: { kind: 'rate', scope: 'subject', limit: 5, window: '1 m' },
  global: { kind: 'quota', scope: 'global', limit: 75, window: '1 d' },
});

// Voice's search_site tool: the same per-IP counter as the chat.
export const corpusLimiter = lazy('rl:chat', {
  ip: { kind: 'rate', scope: 'subject', limit: 5, window: '1 m' },
});

// MCP is public and unauthenticated, so its limits are its only protection:
// 20 tool calls a minute per visitor, and 2,000 a day across everyone, so
// many addresses cannot drain the embedding, vector or Redis quotas
// (search_writing calls Voyage and Upstash Vector).
export const mcpLimiter = lazy('rl:mcp', {
  ip: { kind: 'rate', scope: 'subject', limit: 20, window: '1 m' },
  day: { kind: 'rate', scope: 'global', limit: 2000, window: '1 d' },
});

// ask_jody calls Claude. Besides 5 an hour per IP and 50 calls a day, each
// call reserves its worst case (the prompt plus 1,024 output tokens) from a
// daily token budget before calling Anthropic and settles from the reported
// usage, so the day's spend is bounded by tokens, not just calls: about
// $1.50 a day of Sonnet at most, double across midnight.
export const ASK_MAX_OUTPUT_TOKENS = 1024;
export const ASK_TOKENS_PER_DAY = 250_000;
export const askLimiter = lazy('rl:mcp:ask', {
  ip: { kind: 'rate', scope: 'subject', limit: 5, window: '1 h' },
  calls: { kind: 'quota', scope: 'global', limit: 50, window: '1 d' },
  tokens: { kind: 'quota', scope: 'global', limit: ASK_TOKENS_PER_DAY, window: '1 d' },
});

// The dock polls for Jody's replies every 3 s at most while he is live.
export const repliesLimiter = lazy('rl:replies', {
  ip: { kind: 'rate', scope: 'subject', limit: 60, window: '1 m' },
});

/**
 * Who the visitor is: Vercel's trusted client IP (IPv6 by /64), one bucket
 * in local dev. A request with no client IP on Vercel (which should not
 * happen) shares one "unknown" bucket, so it is limited more, never less.
 */
export function visitor(request: Request): string {
  const source = limitEnv();
  if (!source.VERCEL) return 'local';
  return clientIp(request, { trustedProxy: 'vercel', env: source as NodeJS.ProcessEnv }) ?? 'unknown';
}

/**
 * Runs a limiter's check. A store that cannot be built (no Redis on Vercel)
 * or that fails counts as unavailable, never as allowed.
 */
export async function check<R extends string>(limiter: () => Limiter<R>, subject: string): Promise<Decision<R>> {
  try {
    return await limiter().check(subject);
  } catch {
    return { ok: false, code: 'unavailable', rule: 'store', retryAfterSeconds: 30 };
  }
}
