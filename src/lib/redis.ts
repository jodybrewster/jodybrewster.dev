import { Redis } from '@upstash/redis';
import { env } from './env';

/**
 * The one place that reads UPSTASH_REDIS_REST_*. Returns null when either var
 * is absent, so every caller shares the same contract: no Redis means the
 * feature that needs it degrades, it does not throw.
 *
 * Rate limiting (lib/rate-limit.ts) and the chat handoff (lib/handoff.ts) both
 * sit on this client.
 */
let _redis: Redis | null = null;
let _checked = false;

export function getRedis(): Redis | null {
  if (_checked) return _redis;
  _checked = true;
  const url = env('UPSTASH_REDIS_REST_URL');
  const token = env('UPSTASH_REDIS_REST_TOKEN');
  if (!url || !token) return null;
  _redis = new Redis({ url, token, signal: () => AbortSignal.timeout(2500), retry: false });
  return _redis;
}
