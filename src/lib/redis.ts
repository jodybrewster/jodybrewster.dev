import { Redis } from '@upstash/redis';
import { env } from './env';

/**
 * The Redis client for chat history, transcripts and Telegram state. Returns
 * null when either UPSTASH_REDIS_REST_* var is absent, so every caller shares
 * the same contract: no Redis means the feature that needs it degrades, it
 * does not throw.
 *
 * The rate limits (lib/limits.ts) and the voice token caps read the same
 * variables through the framework's limiter, which refuses instead of
 * degrading when they are missing on Vercel.
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
