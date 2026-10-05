/**
 * Checks the production audit chain (src/lib/audit.ts) and the anchors kept
 * on Telegram. Read-only, with an Upstash read-only token. The chain key is
 * read from stdin, never from .env, so it never sits on disk next to a
 * production write token:
 *
 *   security find-generic-password -s "jodybrewster.dev AUDIT_CHAIN_KEY" -w | npm run audit:verify -- --anchor 120:9f2c...@2026-10-05 [--anchor ...] [--from 1:abcd...] [--max-age-days 2]
 *
 * Paste anchors from the Telegram messages ("Audit anchor (...): seq:hash@date");
 * after a month was dropped, pass its "audit.segment.dropped" lastSeq:lastHash as --from.
 * Fails when the chain is broken, when an anchor's entry is missing or
 * different (newest entries trimmed or rewritten), or when the newest anchor
 * is older than --max-age-days (entries after it are unprotected).
 * Env (.env): PROD_UPSTASH_REDIS_REST_URL, PROD_UPSTASH_REDIS_REST_READONLY_TOKEN.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { chainKeyFromEnv, createUpstashAuditStore, verifyUpstashAudit } from '@jodybrewster/gemini-live/server/audit';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function main(): void {
  const args = process.argv.slice(2);
  const values = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
  const parse = (raw: string) => {
    const m = /^(\d+):([0-9a-f]{64})(?:@(\d{4}-\d{2}-\d{2}))?$/.exec(raw);
    if (!m) fail(`Not an anchor: ${raw} (want seq:hash@YYYY-MM-DD)`);
    return { seq: Number(m[1]), hash: m[2], date: m[3] };
  };
  const anchors = values('--anchor').map(parse);
  const from = values('--from').map(parse)[0];
  const rawAge = values('--max-age-days')[0] ?? '2';
  const maxAgeDays = Number(rawAge);
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) fail(`--max-age-days must be a positive number, not "${rawAge}"`);

  const url = process.env.PROD_UPSTASH_REDIS_REST_URL;
  const token = process.env.PROD_UPSTASH_REDIS_REST_READONLY_TOKEN;
  if (!url || !token) fail('Set PROD_UPSTASH_REDIS_REST_URL and PROD_UPSTASH_REDIS_REST_READONLY_TOKEN (Upstash console, REST API, read-only token).');
  if (process.env.AUDIT_CHAIN_KEY) fail('AUDIT_CHAIN_KEY is in the environment or .env: remove it and pipe the key in on stdin instead.');
  if (!anchors.length) fail('Pass at least one --anchor from Telegram: without one, trimmed newest entries cannot be detected.');
  const dated = anchors.filter(a => a.date).map(a => Date.parse(`${a.date}T00:00:00Z`));
  if (dated.some(t => t > Date.now() + 86_400_000)) fail('An anchor is dated in the future.');
  const newest = dated.sort((a, b) => b - a)[0];
  if (!newest || Date.now() - newest > maxAgeDays * 86_400_000) fail(`The newest anchor is older than ${maxAgeDays} days (or has no date): entries after it are unprotected. Use the latest Telegram anchor.`);

  const keyText = readFileSync(0, 'utf8').trim();
  if (!keyText) fail('Pipe the audit chain key in on stdin (for example from your password manager).');
  const key = chainKeyFromEnv({ AUDIT_CHAIN_KEY: keyText });
  const store = createUpstashAuditStore({ url, token, key, prefix: 'audit:production' });
  void verifyUpstashAudit(store, key, { from, anchors }).then(result => {
    console.log(JSON.stringify({ checked: result.checked, head: result.head, problem: result.problem }));
    if (result.problem) process.exit(1);
  }, error => fail(`Could not read the chain: ${error instanceof Error ? error.message : String(error)}`));
}

main();
