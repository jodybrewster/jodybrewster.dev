import { Ratelimit } from '@upstash/ratelimit';
import { getRedis } from './redis';
import { env } from './env';

// Per-IP: 5 requests / minute. The chat is multi-turn, so a real conversation
// burns several requests in quick succession; scripted abuse still hits the
// wall fast.
let _ipLimiter: Ratelimit | null = null;

// Site-wide: 75 chats / day across everyone. Sized so we run out of our quota
// before the Gemini spend cap kicks in, giving users a graceful 429 ("daily
// limit, try tomorrow") instead of an opaque upstream failure.
let _globalLimiter: Ratelimit | null = null;

// Voice sessions are capped by the framework's token handler
// (src/pages/api/live-token.ts), not here.

// MCP (/api/mcp) is public and unauthenticated, so its limits are its only
// protection. Every tool call counts against the per-IP limit; ask_jody,
// which calls Anthropic, also has its own per-IP and site-wide caps. At 50
// a day the worst case is about $1.40 of Sonnet (roughly 4k tokens in and
// 1,024 out per call), double that across a midnight window.
let _mcpIpLimiter: Ratelimit | null = null;
let _askIpLimiter: Ratelimit | null = null;
let _askGlobalLimiter: Ratelimit | null = null;

function limiter(cached: Ratelimit | null, set: (l: Ratelimit) => void, limit: number, window: `${number} ${'m' | 'h'}`, prefix: string): Ratelimit | null {
  if (cached) return cached;
  const redis = getRedis();
  if (!redis) return null;
  const created = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(limit, window), analytics: false, prefix });
  set(created);
  return created;
}

export const getMcpIpLimiter = () => limiter(_mcpIpLimiter, l => { _mcpIpLimiter = l; }, 20, '1 m', 'rl:mcp:ip');
export const getAskIpLimiter = () => limiter(_askIpLimiter, l => { _askIpLimiter = l; }, 5, '1 h', 'rl:mcp:ask:ip');
export const getAskGlobalLimiter = () => limiter(_askGlobalLimiter, l => { _askGlobalLimiter = l; }, 50, '24 h', 'rl:mcp:ask:global');

export function getIpLimiter(): Ratelimit | null {
  if (_ipLimiter) return _ipLimiter;
  const redis = getRedis();
  if (!redis) return null;
  _ipLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '1 m'),
    analytics: false,
    prefix: 'rl:chat:ip',
  });
  return _ipLimiter;
}

export function getGlobalLimiter(): Ratelimit | null {
  if (_globalLimiter) return _globalLimiter;
  const redis = getRedis();
  if (!redis) return null;
  _globalLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(75, '24 h'),
    analytics: false,
    prefix: 'rl:chat:global',
  });
  return _globalLimiter;
}

export function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    request.headers.get('x-real-ip') ??
    'anonymous'
  );
}

/**
 * For routes other sites' pages must not call but server-side clients may
 * (MCP): true when an Origin header is present and is not this site's, in
 * production. Server-side clients send no Origin.
 */
export function isForeignOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  const environment = env('VERCEL_ENV');
  if (environment ? environment !== 'production' : env('NODE_ENV') !== 'production') return false;
  return !['https://jodybrewster.dev', 'https://www.jodybrewster.dev'].includes(origin);
}

/**
 * Origin check enforced only in production (so dev over Tailscale / localhost /
 * Vercel preview deployments don't get locked out).
 */
export function isOriginAllowed(request: Request): boolean {
  const environment = env('VERCEL_ENV');
  if (environment ? environment !== 'production' : env('NODE_ENV') !== 'production') {
    return true;
  }
  const origin = request.headers.get('origin');
  const candidate = origin ?? request.headers.get('referer');
  if (!candidate) return false;
  try {
    const url = new URL(candidate);
    if (url.username || url.password) return false;
    if (!['https://jodybrewster.dev', 'https://www.jodybrewster.dev'].includes(url.origin)) return false;
    // Origin is an origin, never a path, query, credentials, or fragment.
    return origin === null || candidate === url.origin;
  } catch { return false; }
}
