/**
 * Deletes everything the site holds for one Verso conversation in production,
 * for a visitor who asks (the /privacy page promises it). Requests are
 * deletion only: a transcript is never sent out, since nobody can prove they
 * wrote one.
 *
 * Find the conversation from what the requester remembers (lists, deletes nothing):
 *   npm run conversation:delete -- --find "rates freelance" [--since 2026-09-20]
 *
 * See what one conversation holds (a dry run):
 *   npm run conversation:delete -- --cid <id>
 *
 * Delete it, with the audit chain key on stdin (never in .env):
 *   pbpaste | npm run conversation:delete -- --cid <id> --yes
 *
 * What goes is listed in src/lib/conversation-delete.ts. The key on stdin is
 * checked against the newest entry in the chain first (checkChainKey in
 * src/lib/audit.ts): a wrong one is refused before anything is written or
 * deleted. The deletion is then recorded, as `conversation.deleted` in the
 * audit log with the keyed ref() of the id (never the id itself), and anchored
 * on Telegram; if the entry cannot be written, nothing is deleted. A missing
 * anchor is warned about, not fatal: the entry is written either way.
 *
 * Needs PROD_UPSTASH_REDIS_REST_URL and PROD_UPSTASH_REDIS_REST_TOKEN in .env,
 * like `npm run conversations`. --find prints excerpts of visitors' questions
 * to this terminal only.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Redis } from '@upstash/redis';
import { deleteHoldings, findHoldings, holdsNothing, searchTranscripts, type DeleteRedis, type Holdings } from '../src/lib/conversation-delete';
import { readTranscripts, TRANSCRIPT_TTL_S, type TranscriptRedis } from '../src/lib/transcripts';
import { isValidConversationId } from '../src/lib/verso';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) fail(`${name} needs a value.`);
  return value;
};

const cid = flag('--cid');
const find = flag('--find');
const sinceArg = flag('--since');
const yes = args.includes('--yes');
if (!cid === !find) fail('Pass either --cid <id> to delete one conversation or --find "<words>" to look for it.');
if (find && yes) fail('--find only lists. Delete with --cid <id> --yes.');
if (cid && !isValidConversationId(cid)) fail('That is not a conversation id (a UUID, as --find prints it).');
// Redis keys are case-sensitive and the site writes ids in lowercase: an uppercase copy would find nothing and report the conversation gone.
if (cid && cid !== cid.toLowerCase()) fail(`Conversation ids are lowercase; an uppercase one matches no key. Did you mean ${cid.toLowerCase()}?`);

const url = process.env.PROD_UPSTASH_REDIS_REST_URL;
const token = process.env.PROD_UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) fail('Set PROD_UPSTASH_REDIS_REST_URL and PROD_UPSTASH_REDIS_REST_TOKEN in .env to the production database (Upstash console, REST API).');
const redis = new Redis({ url, token });

const stamp = (ts: number) => `${new Date(ts).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

const OUT_OF_REACH = [
  'Not reachable from here, so check by hand:',
  '  - the copies of its turns in the Telegram chat on your phone (delete those messages there);',
  '  - files under .conversations/ (and any --out file) downloaded before now that contain it;',
  '  - verso-digest-*.md digests in the vault, which should never quote a visitor but are written by a model: check none does;',
  "  - AI and other providers' own short-term logs, kept under their terms.",
];

function describe(h: Holdings): string[] {
  return [
    ...h.keys.map(key => `  ${key}`),
    ...(h.indexed ? ['  chat:log:index (its entry)'] : []),
    ...h.telegram.map(key => `  ${key} (Telegram message mapping)`),
  ];
}

async function listCandidates(words: string): Promise<void> {
  const since = sinceArg ? Date.parse(`${sinceArg}T00:00:00Z`) : Date.now() - TRANSCRIPT_TTL_S * 1000;
  if (!Number.isFinite(since)) fail('--since must be a date like 2026-09-20.');
  const transcripts = await readTranscripts(since, redis as unknown as TranscriptRedis);
  const found = searchTranscripts(transcripts, words);
  console.log(`${found.length} of ${transcripts.length} conversations active since ${stamp(since)} match. Nothing was deleted.`);
  for (const c of found) console.log(`\n${c.cid}\n  started ${stamp(c.first)}, ${c.questions} question${c.questions === 1 ? '' : 's'}\n  "${c.excerpt}"`);
  if (found.length) console.log('\nCheck the time and words against the request, then: npm run conversation:delete -- --cid <id>');
}

async function remove(id: string): Promise<void> {
  const store = redis as unknown as DeleteRedis;
  const holdings = await findHoldings(id, store);
  if (holdsNothing(holdings)) {
    console.log('The site holds nothing for that conversation in Redis (expired, already deleted or never existed).');
    console.log(OUT_OF_REACH.join('\n'));
    return;
  }
  if (!yes) {
    console.log(`Dry run. Deleting would remove:\n${describe(holdings).join('\n')}`);
    console.log('\nTo delete: pbpaste | npm run conversation:delete -- --cid <id> --yes  (audit chain key on stdin)');
    return;
  }

  // Recorded before anything is deleted, through the site's own audit log.
  if (process.env.AUDIT_CHAIN_KEY) fail('AUDIT_CHAIN_KEY is in the environment or .env: remove it and pipe the key in on stdin instead.');
  const key = readFileSync(0, 'utf8').trim();
  if (!key) fail('Pipe the audit chain key in on stdin (for example from your password manager). Nothing was deleted.');
  Object.assign(process.env, { VERCEL_ENV: 'production', UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token, AUDIT_CHAIN_KEY: key });
  const { auditAnchored, checkChainKey, ref } = await import('../src/lib/audit');
  const target = ref(id);
  if (!target) fail('The audit log could not start with that key. Nothing was deleted.');
  const check = await checkChainKey();
  if (!check.ok) fail(`Refused: ${check.detail} Nothing was written or deleted.`);
  const { written, anchored } = await auditAnchored({
    action: 'conversation.deleted',
    outcome: 'allow',
    actor: { userId: 'jody' },
    target: { kind: 'conversation', id: target },
    details: { keys: holdings.keys.length + holdings.telegram.length, indexed: holdings.indexed },
  });
  if (!written) fail('The audit entry could not be written. Nothing was deleted.');

  const removed = await deleteHoldings(holdings, store);
  const left = await findHoldings(id, store);
  console.log(`Deleted ${removed}:\n${describe(holdings).join('\n')}`);
  console.log(`Recorded as conversation.deleted, ref ${target}.`);
  if (!anchored) {
    console.warn('WARNING: the audit anchor for this entry did not reach Telegram (no TELEGRAM_* in .env, or the send failed).');
    console.warn('Until the next anchor (the daily cron sends one), the Redis token alone could trim this entry. Keep the head from `npm run audit:verify` if it matters.');
  }
  if (!holdsNothing(left)) {
    // A visitor with the page still open can write to it again between the two reads.
    console.log(`Written again since (the visitor may still be chatting); run it again:\n${describe(left).join('\n')}`);
    process.exitCode = 1;
  }
  console.log(`\n${OUT_OF_REACH.join('\n')}`);
}

try {
  if (find) await listCandidates(find);
  else await remove(cid!);
} catch (error) {
  fail(`Stopped: ${error instanceof Error ? error.message : String(error)}`);
}
