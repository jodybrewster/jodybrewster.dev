/**
 * Checks the production audit chain (src/lib/audit.ts) and the anchors kept
 * on Telegram. Read-only: give it an Upstash read-only token.
 *
 *   npm run audit:verify -- --anchor 120:9f2c...@2026-10-05 [--anchor ...] [--from 1:abcd...] [--max-age-days 2]
 *
 * Paste anchors from the Telegram messages ("Audit anchor (...): seq:hash@date").
 * Fails when the chain is broken, when an anchor's entry is missing or
 * different (newest entries trimmed or rewritten), or when the newest anchor
 * is older than --max-age-days (entries after it are unprotected).
 * Env (.env): PROD_UPSTASH_REDIS_REST_URL, PROD_UPSTASH_REDIS_REST_READONLY_TOKEN,
 * AUDIT_CHAIN_KEY (and AUDIT_CHAIN_KEY_ID if not k1).
 */
import 'dotenv/config';
import { chainKeyFromEnv, createUpstashAuditStore, verifyUpstashAudit } from '@jodybrewster/gemini-live/server/audit';

function main(): void {
  const args = process.argv.slice(2);
  const values = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
  const parse = (raw: string) => {
    const m = /^(\d+):([0-9a-f]{64})(?:@(\d{4}-\d{2}-\d{2}))?$/.exec(raw);
    if (!m) { console.error(`Not an anchor: ${raw} (want seq:hash@YYYY-MM-DD)`); process.exit(1); }
    return { seq: Number(m[1]), hash: m[2], date: m[3] };
  };
  const anchors = values('--anchor').map(parse);
  const from = values('--from').map(parse)[0];
  const maxAgeDays = Number(values('--max-age-days')[0] ?? 2);

  const url = process.env.PROD_UPSTASH_REDIS_REST_URL;
  const token = process.env.PROD_UPSTASH_REDIS_REST_READONLY_TOKEN;
  if (!url || !token) { console.error('Set PROD_UPSTASH_REDIS_REST_URL and PROD_UPSTASH_REDIS_REST_READONLY_TOKEN (Upstash console, REST API, read-only token).'); process.exit(1); }
  if (!anchors.length) { console.error('Pass at least one --anchor from Telegram: without one, trimmed newest entries cannot be detected.'); process.exit(1); }
  const newest = anchors.filter(a => a.date).map(a => Date.parse(a.date!)).sort((a, b) => b - a)[0];
  if (!newest || Date.now() - newest > maxAgeDays * 86_400_000) {
    console.error(`The newest anchor is older than ${maxAgeDays} days (or has no date): entries after it are unprotected. Use the latest Telegram anchor.`);
    process.exit(1);
  }

  const key = chainKeyFromEnv(process.env);
  const store = createUpstashAuditStore({ url, token, key, prefix: 'audit:production' });
  void verifyUpstashAudit(store, key, { from, anchors }).then(result => {
    console.log(JSON.stringify({ checked: result.checked, head: result.head, problem: result.problem }));
    if (result.problem) process.exit(1);
  }, error => { console.error('Could not read the chain:', error instanceof Error ? error.message : error); process.exit(1); });
}

main();
