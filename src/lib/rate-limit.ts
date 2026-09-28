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

// Voice is billed per minute of audio, so it is metered per session rather
// than per message: a few sessions a day per visitor, and a site-wide ceiling
// that a scripted token farm hits long before the bill does.
let _voiceIpLimiter: Ratelimit | null = null;
let _voiceGlobalLimiter: Ratelimit | null = null;

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

export function getVoiceIpLimiter(): Ratelimit | null {
  if (_voiceIpLimiter) return _voiceIpLimiter;
  const redis = getRedis();
  if (!redis) return null;
  _voiceIpLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(3, '24 h'),
    analytics: false,
    prefix: 'rl:voice:ip',
  });
  return _voiceIpLimiter;
}

export function getVoiceGlobalLimiter(): Ratelimit | null {
  if (_voiceGlobalLimiter) return _voiceGlobalLimiter;
  const redis = getRedis();
  if (!redis) return null;
  _voiceGlobalLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(40, '24 h'),
    analytics: false,
    prefix: 'rl:voice:global',
  });
  return _voiceGlobalLimiter;
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
