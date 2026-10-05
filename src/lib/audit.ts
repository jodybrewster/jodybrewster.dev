import { createHmac } from 'node:crypto';
import {
  chainKeyFromEnv,
  chainLink,
  createUpstashAuditStore,
  type ChainKey,
  type UpstashAuditStore,
} from '@jodybrewster/gemini-live/server/audit';
import { createSwitches } from '@jodybrewster/gemini-live/server/switches';
import { env } from './env';
import { getRedis } from './redis';
import { sendNotice } from './telegram';
import { SWITCHES, switchEnv } from './switches';
import { withDeadline } from './deadline';

/**
 * The site's tamper-evident audit log (M1 1.7, site step S4): a keyed hash
 * chain on Upstash (@jodybrewster/gemini-live/server/audit), written only
 * in Production (`audit:production`), so neither a preview nor `astro dev`
 * ever signs with the key.
 *
 * Entries hold what happened and its outcome, never an IP, a user agent,
 * visitor text or a conversation id (an id is a capability: it lets its
 * holder read Jody's replies). `ref` is a keyed hash of an id instead.
 *
 * What visitors can cause is bounded by the rate limits: answers, minted
 * tokens and ask_jody calls are capped per day. Refusals are not chained one
 * by one (a flood of them could fill the monthly cap and blind the log);
 * they are counted per day in Redis and the daily cron writes one summary
 * entry. Writing never blocks a request; the first failure per instance an
 * hour, and the store's size warnings, go to Jody's Telegram.
 *
 * Jody's replies and switch changes send their anchor to Telegram as they
 * are written; the daily cron sends the newest with the day's counts and
 * drops months past retention (src/pages/api/cron/audit-anchor.ts). Anchors
 * protect the entries before them: the Redis token alone can trim entries
 * after the newest anchor on Telegram, until the next one.
 */

/** Months kept; older ones are dropped by the daily cron. */
export const RETENTION_MONTHS = 13;

type State = { store: UpstashAuditStore; key: ChainKey; prefix: string } | null;
let state: State | undefined;
let lastFailureNotice = 0;

function notify(text: string): void {
  void sendNotice(text).catch(() => console.error('[audit] notice not sent'));
}

function setup(): State {
  if (state !== undefined) return state;
  const url = env('UPSTASH_REDIS_REST_URL');
  const token = env('UPSTASH_REDIS_REST_TOKEN');
  if (env('VERCEL_ENV') !== 'production') return (state = null);
  if (!env('AUDIT_CHAIN_KEY') || !url || !token) {
    console.warn('[audit] off: AUDIT_CHAIN_KEY or Upstash is not set');
    return (state = null);
  }
  try {
    const key = chainKeyFromEnv({ AUDIT_CHAIN_KEY: env('AUDIT_CHAIN_KEY'), AUDIT_CHAIN_KEY_ID: env('AUDIT_CHAIN_KEY_ID') });
    const prefix = 'audit:production';
    // Anchor lines to the logs; size warnings to Jody, where they are seen.
    const write = (line: string) => {
      console.log(line);
      if (line.includes('"auditWarning"')) notify(`Audit log warning: ${JSON.parse(line).auditWarning}`);
    };
    return (state = { key, prefix, store: createUpstashAuditStore({ url, token, key, prefix, write }) });
  } catch (error) {
    console.error('[audit] off:', error instanceof Error ? error.message : 'bad key');
    return (state = null);
  }
}

/** A keyed, non-reversible reference for an id that must not be stored. */
export function ref(id: string): string | null {
  const s = setup();
  return s ? createHmac('sha256', s.key.secret).update(`ref:${id}`).digest('hex').slice(0, 16) : null;
}

/** What the store accepts (it refuses an IP or user agent), less the timestamp it adds. */
type Entry = Omit<Parameters<UpstashAuditStore['record']>[0], 'ts'>;

/**
 * Records an entry; with `anchor`, also sends its anchor to Jody's Telegram.
 * Never throws. Returns whether the entry was written (false when the log is
 * off or the write failed).
 */
export async function audit(entry: Entry, { anchor = false } = {}): Promise<boolean> {
  return (await auditAnchored(entry, { anchor })).written;
}

/**
 * audit(), also reporting whether the anchor reached Telegram, for a caller
 * that must say so when it did not (an entry with no anchor after it can be
 * trimmed by the Redis token alone). `anchored` is false when no anchor was
 * asked for.
 */
export async function auditAnchored(entry: Entry, { anchor = true } = {}): Promise<{ written: boolean; anchored: boolean }> {
  const s = setup();
  if (!s) return { written: false, anchored: false };
  try {
    await s.store.record({ ts: new Date().toISOString(), ...entry });
  } catch (error) {
    console.error('[audit] write failed', { action: entry.action, error: error instanceof Error ? error.name : 'unknown' });
    if (Date.now() - lastFailureNotice > 3_600_000) {
      lastFailureNotice = Date.now();
      notify(`Audit log write failed (${entry.action}): ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    return { written: false, anchored: false };
  }
  if (!anchor) return { written: true, anchored: false };
  const head = await s.store.head().catch(() => null);
  return { written: true, anchored: head ? await sendAnchor(head, entry.action) : false };
}

/** The slice of the store checkChainKey reads. */
export type ChainReader = Pick<UpstashAuditStore, 'head' | 'segments' | 'entries'>;

export type ChainKeyCheck =
  | { ok: true; seq: number }
  | { ok: false; reason: 'off' | 'empty' | 'key-id' | 'mismatch' | 'head'; detail: string };

/**
 * Whether `key` is the key the chain is signed with, before anything is
 * written with it: the newest entry's link is recomputed the way
 * `audit:verify` does and must match its stored hash, and that entry must be
 * the head. A wrong key (any long enough string decodes to one) would
 * otherwise sign a link nobody can verify into the production chain.
 *
 * An empty chain proves nothing either way, so it is refused too: the site's
 * chain is never empty once the daily cron has run, and a first entry is the
 * site's to write, not a script's. Defaults to the configured store and key.
 */
export async function checkChainKey(store?: ChainReader, key?: ChainKey): Promise<ChainKeyCheck> {
  if (!store || !key) {
    const s = setup();
    if (!s) return { ok: false, reason: 'off', detail: 'The audit log is not configured (Production, AUDIT_CHAIN_KEY and Upstash).' };
    store ??= s.store;
    key ??= s.key;
  }
  const head = await store.head();
  const segments = await store.segments();
  let last: Awaited<ReturnType<ChainReader['entries']>>[number] | undefined;
  for (let i = segments.length - 1; i >= 0 && !last; i--) last = (await store.entries(segments[i])).at(-1);
  if (!head && !last) return { ok: false, reason: 'empty', detail: 'The audit chain has no entries, so the key cannot be checked against it.' };
  if (!head || !last || head.seq !== last.seq || head.hash !== last.hash) {
    return { ok: false, reason: 'head', detail: 'The chain head does not match its newest entry; run npm run audit:verify.' };
  }
  if (last.keyId !== key.id) return { ok: false, reason: 'key-id', detail: `The newest entry was signed with key id "${last.keyId}", not "${key.id}".` };
  if (chainLink(key, last.prevHash, last.seq, { keyId: last.keyId, event: last.event }) !== last.hash) {
    return { ok: false, reason: 'mismatch', detail: 'That key does not verify the newest entry: it is not the chain key.' };
  }
  return { ok: true, seq: last.seq };
}

const day = (d = new Date()) => d.toISOString().slice(0, 10);

/**
 * Counts a refusal for the day's summary (one Redis command, no chain
 * entry), so a flood of refusals can never fill the audit log.
 */
export async function auditRefusal(action: string, reason: string): Promise<void> {
  const s = setup();
  const redis = getRedis();
  if (!s || !redis) return;
  const key = `${s.prefix}:refusals:${day()}`;
  try {
    await redis.hincrby(key, `${action}:${reason}`, 1);
    await redis.expire(key, 7 * 86_400);
  } catch {
    console.error('[audit] refusal not counted');
  }
}

/** The anchor message, which `npm run audit:verify` takes as `--anchor seq:hash@date`. */
export async function sendAnchor(at: { seq: number; hash: string }, why: string, extra = ''): Promise<boolean> {
  try {
    if (await sendNotice(`Audit anchor (${why}): ${at.seq}:${at.hash}@${day()}${extra ? `\n${extra}` : ''}`)) return true;
  } catch { /* reported below */ }
  console.error('[audit] anchor not sent');
  return false;
}

/**
 * The daily heartbeat: writes yesterday's refusal summary, drops months past
 * retention (each drop recorded, anchored, with the last entry it removed,
 * which `audit:verify --from` then starts at), and sends the newest anchor
 * with the day's counts. Returns a line for the cron's response.
 */
export async function dailyAudit(now = new Date()): Promise<string> {
  const s = setup();
  if (!s) return 'Audit log is off';
  const redis = getRedis();
  const yesterday = day(new Date(now.getTime() - 86_400_000));
  if (redis) {
    const counts = await redis.hgetall<Record<string, number>>(`${s.prefix}:refusals:${yesterday}`).catch(() => null);
    if (counts && Object.keys(counts).length) await audit({ action: 'audit.refusals', outcome: 'deny', details: { day: yesterday, counts } });
  }
  const segments = await s.store.segments();
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - RETENTION_MONTHS + 1, 1)).toISOString().slice(0, 7);
  for (const segment of segments.filter(seg => seg < cutoff)) {
    const entries = await s.store.entries(segment);
    const last = entries[entries.length - 1];
    if (last && await audit({ action: 'audit.segment.dropped', outcome: 'allow', details: { segment, lastSeq: last.seq, lastHash: last.hash } }, { anchor: true })) {
      await s.store.dropSegment(segment);
    }
  }
  const head = await s.store.head();
  if (!head) {
    notify('Audit log: no entries and no head. If the log has run before, the head was removed.');
    return 'No head';
  }
  const current = segments.length ? (await s.store.entries(segments[segments.length - 1])).length : 0;
  await sendAnchor(head, 'daily', `Entries this month: ${current}. Months kept: ${Math.min(segments.length, RETENTION_MONTHS)}.`);
  return 'Anchor sent';
}

let switchesChecked: Promise<void> | null = null;

/**
 * Records a switch change: switches live in the environment and change with
 * a redeploy, so the first request on an instance compares them with the
 * last state recorded and writes `switch.changed` (anchored) when they
 * differ. The state moves on only once the entry is written, so a failed
 * write is retried by the next instance. Neither the key nor a Redis write
 * token is ever needed on Jody's machine to flip one.
 */
export function auditSwitchChanges(): Promise<void> {
  switchesChecked ??= (async () => {
    const s = setup();
    const redis = getRedis();
    if (!s || !redis) return;
    try {
      const switches = createSwitches({ env: switchEnv() });
      const now: Record<string, boolean> = {};
      for (const name of SWITCHES) now[name] = await switches.isOn(name);
      const stateKey = `${s.prefix}:switch-state`;
      // Bounded: a stalled Upstash must not hold every request waiting on this check.
      const before = await withDeadline(() => redis.get<Record<string, boolean> | string>(stateKey), 1500);
      const last = typeof before === 'string' ? JSON.parse(before) as Record<string, boolean> : before;
      if (last && SWITCHES.every(n => last[n] === now[n])) return;
      const written = await audit({ action: 'switch.changed', outcome: 'allow', details: { before: last ?? null, after: now } }, { anchor: last !== null });
      if (written) await withDeadline(() => redis.set(stateKey, JSON.stringify(now)), 1500);
      else switchesChecked = null; // try again on the next request
    } catch (error) {
      console.error('[audit] switch check failed', error instanceof Error ? error.name : 'unknown');
      switchesChecked = null;
    }
  })();
  return switchesChecked;
}
