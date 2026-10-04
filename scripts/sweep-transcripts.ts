/**
 * One-off: finds transcript logs with no TTL in production (written before
 * the 30-days-from-first-message change, when the TTL was a separate request
 * that could fail) and gives each its correct expiry, or deletes it if its
 * first message is already older than 30 days. Dry run unless --apply.
 *
 *   npm run transcripts:sweep            # report only
 *   npm run transcripts:sweep -- --apply # fix
 *
 * Needs PROD_UPSTASH_REDIS_REST_URL and PROD_UPSTASH_REDIS_REST_TOKEN, like
 * `npm run conversations`. Prints counts only, never transcript text.
 */
import 'dotenv/config';
import { Redis } from '@upstash/redis';
import { TRANSCRIPT_TTL_S } from '../src/lib/transcripts';

const apply = process.argv.includes('--apply');
const url = process.env.PROD_UPSTASH_REDIS_REST_URL;
const token = process.env.PROD_UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) {
  console.error('Set PROD_UPSTASH_REDIS_REST_URL and PROD_UPSTASH_REDIS_REST_TOKEN in .env to the production database.');
  process.exit(1);
}
const redis = new Redis({ url, token });

const firstTs = (row: unknown): number | null => {
  const entry = typeof row === 'string' ? (() => { try { return JSON.parse(row); } catch { return null; } })() : row;
  return entry && typeof entry === 'object' && typeof (entry as { ts?: unknown }).ts === 'number' ? (entry as { ts: number }).ts : null;
};

let cursor = '0';
const counts = { scanned: 0, noTtl: 0, expired: 0, fixed: 0 };
do {
  const [next, keys] = await redis.scan(cursor, { match: 'chat:log:*', count: 200 });
  cursor = String(next);
  for (const key of keys) {
    if (key === 'chat:log:index') continue;
    counts.scanned++;
    if ((await redis.ttl(key)) !== -1) continue;
    counts.noTtl++;
    const [first] = await redis.lrange(key, 0, 0);
    const ts = firstTs(first) ?? 0;
    const left = Math.floor((ts + TRANSCRIPT_TTL_S * 1000 - Date.now()) / 1000);
    if (left <= 0) {
      counts.expired++;
      if (apply) await redis.del(key);
    } else {
      counts.fixed++;
      if (apply) await redis.expire(key, left);
    }
  }
} while (cursor !== '0');

console.log(JSON.stringify({ ...counts, applied: apply }));
