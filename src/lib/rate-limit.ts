import { Ratelimit } from '@upstash/ratelimit';
import { getRedis } from './redis';
import { env } from './env';

// Per-IP: 5 requests / minute. The chat is multi-turn, so a real conversation
// burns several requests in quick succession; scripted abuse still hits the
// wall fast.
let _ipLimiter: Ratelimit | null = null;

// Site-wide: 75 chats / day across everyone. Sized so we run out of our quota
// before the Anthropic monthly spend cap kicks in, giving users a graceful
// 429 ("daily limit, try tomorrow") instead of an opaque upstream failure.
// Only the model path spends this; a question Jody answers himself is free.
let _globalLimiter: Ratelimit | null = null;

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
 * Origin check enforced only in production (so dev over Tailscale / localhost /
 * Vercel preview deployments don't get locked out).
 */
export function isOriginAllowed(request: Request): boolean {
  if (env('VERCEL_ENV') !== 'production' && env('NODE_ENV') !== 'production') {
    return true;
  }
  const origin = request.headers.get('origin') ?? '';
  const referer = request.headers.get('referer') ?? '';
  const allowedHost = 'jodybrewster.dev';
  return origin.includes(allowedHost) || referer.includes(allowedHost);
}
