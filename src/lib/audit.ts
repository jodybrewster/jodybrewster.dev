import { createHmac } from 'node:crypto';
import {
  chainKeyFromEnv,
  createDenyThrottle,
  createUpstashAuditStore,
  type ChainKey,
  type UpstashAuditStore,
} from '@jodybrewster/gemini-live/server/audit';
import { createSwitches, envSwitchKey } from '@jodybrewster/gemini-live/server/switches';
import { env } from './env';
import { getRedis } from './redis';
import { sendNotice } from './telegram';

/**
 * The site's tamper-evident audit log (M1 1.7, site step S4): a keyed hash
 * chain on Upstash (@jodybrewster/gemini-live/server/audit), one per Vercel
 * environment (`audit:production`), so previews never write into
 * production's chain.
 *
 * Entries hold what happened and its outcome, never an IP, a user agent,
 * visitor text or a conversation id (an id is a capability: it lets its
 * holder read Jody's replies). `ref` is a keyed hash of an id instead, so
 * entries about one conversation can be matched without exposing it.
 *
 * Writing never blocks a request: a failure is logged and the request goes
 * on. Refusals go through a per-instance throttle (one per action and
 * reason a minute), so a flood of cheap refusals cannot fill the store.
 * High-value entries (Jody's replies, switch changes) send their anchor to
 * Jody's Telegram as they are written; a daily cron sends the latest
 * (src/pages/api/cron/audit-anchor.ts). Anchors protect the entries before
 * them: whoever holds the Redis token can trim entries after the newest
 * anchor kept on Telegram, until the next one.
 *
 * Off unless AUDIT_CHAIN_KEY and Upstash are configured (set the key for
 * Production only).
 */

type State = { store: UpstashAuditStore; key: ChainKey; prefix: string } | null;
let state: State | undefined;

function setup(): State {
  if (state !== undefined) return state;
  const url = env('UPSTASH_REDIS_REST_URL');
  const token = env('UPSTASH_REDIS_REST_TOKEN');
  if (!env('AUDIT_CHAIN_KEY') || !url || !token) {
    if (env('VERCEL_ENV') === 'production') console.warn('[audit] off: AUDIT_CHAIN_KEY or Upstash is not set');
    return (state = null);
  }
  try {
    const key = chainKeyFromEnv({ AUDIT_CHAIN_KEY: env('AUDIT_CHAIN_KEY'), AUDIT_CHAIN_KEY_ID: env('AUDIT_CHAIN_KEY_ID') });
    const prefix = `audit:${env('VERCEL_ENV') ?? 'local'}`;
    return (state = { key, prefix, store: createUpstashAuditStore({ url, token, key, prefix }) });
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

/** Records an entry; with `anchor`, also sends its anchor to Jody's Telegram. Never throws. */
export async function audit(entry: Entry, { anchor = false } = {}): Promise<void> {
  const s = setup();
  if (!s) return;
  let written: { seq: number; hash: string } | null = null;
  try {
    await s.store.record({ ts: new Date().toISOString(), ...entry });
    if (anchor) written = await s.store.head();
  } catch (error) {
    console.error('[audit] write failed', { action: entry.action, error: error instanceof Error ? error.name : 'unknown' });
    return;
  }
  if (written) await sendAnchor(written, entry.action);
}

const throttle = createDenyThrottle();
/** Records a refusal at most once a minute per action and reason, per instance. */
export async function auditRefusal(action: string, reason: string): Promise<void> {
  if (!throttle(`${action}:${reason}`)) return;
  await audit({ action, outcome: 'deny', details: { reason } });
}

/** The anchor message: seq and hash, which `npm run audit:verify` takes as `--anchor seq:hash@date`. */
export async function sendAnchor(at: { seq: number; hash: string }, why: string): Promise<void> {
  try {
    await sendNotice(`Audit anchor (${why}): ${at.seq}:${at.hash}@${new Date().toISOString().slice(0, 10)}`);
  } catch {
    console.error('[audit] anchor not sent');
  }
}

/** The newest entry, for the daily anchor. */
export async function auditHead(): Promise<{ seq: number; hash: string } | null> {
  const s = setup();
  return s ? s.store.head() : null;
}

const SWITCHES = ['chat', 'voice', 'tool:search_site', 'tool:ask_jody'] as const;
let switchesChecked: Promise<void> | null = null;

/**
 * Records a switch change once per instance: switches live in the
 * environment and change with a redeploy, so the first request after one
 * compares them with the last state recorded and writes `switch.changed`
 * (anchored) when they differ. Neither the key nor a Redis write token ever
 * needs to be on Jody's machine to flip one.
 */
export function auditSwitchChanges(): Promise<void> {
  switchesChecked ??= (async () => {
    const s = setup();
    const redis = getRedis();
    if (!s || !redis) return;
    try {
      const switches = createSwitches({ env: Object.fromEntries(SWITCHES.map(name => [envSwitchKey(name), env(envSwitchKey(name))])) });
      const now: Record<string, boolean> = {};
      for (const name of SWITCHES) now[name] = await switches.isOn(name);
      const stateKey = `${s.prefix}:switch-state`;
      const before = await redis.get<Record<string, boolean> | string>(stateKey);
      const last = typeof before === 'string' ? JSON.parse(before) as Record<string, boolean> : before;
      if (last && SWITCHES.every(n => last[n] === now[n])) return;
      await audit({ action: 'switch.changed', outcome: 'allow', details: { before: last ?? null, after: now } }, { anchor: last !== null });
      await redis.set(stateKey, JSON.stringify(now));
    } catch (error) {
      console.error('[audit] switch check failed', error instanceof Error ? error.name : 'unknown');
    }
  })();
  return switchesChecked;
}
