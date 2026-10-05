/**
 * Everything the site holds for one conversation in Redis, found and deleted
 * together, for `npm run conversation:delete` (a visitor's deletion request).
 *
 * Per conversation the site keeps:
 *  - `chat:conv:<cid>`, the prompt history (src/lib/conversation.ts);
 *  - `chat:log:<cid>` and its member in `chat:log:index`, the 30-day
 *    transcript (src/lib/transcripts.ts);
 *  - `chat:tg:<message_id>`, one per turn sent to Jody, mapping his Telegram
 *    message back to the conversation and holding the redacted question
 *    (src/lib/operator.ts). Keyed by message, so they are found by scanning;
 *  - `chat:live:<cid>` and `chat:held:<cid>`, his live window and the question
 *    held for him (src/lib/operator.ts).
 *
 * The audit log refers to a conversation only by `ref()`, a keyed hash, and
 * is append-only, so it is not touched. Rate limit counters (`rl:*`) are per
 * visitor address, not per conversation.
 *
 * Run from a script, so failures throw: a deletion that silently did half its
 * work would be worse than one that stops.
 */
import { convKey } from './conversation';
import { TG_KEY_MATCH, heldKey, liveKey } from './operator';
import { TRANSCRIPT_INDEX, logKey, type Transcript } from './transcripts';

/** The commands this module issues. The real client satisfies it structurally. */
export interface DeleteRedis {
  exists(...keys: string[]): Promise<number>;
  get<T = unknown>(key: string): Promise<T | null>;
  scan(cursor: string | number, opts: { match: string; count: number }): Promise<[string | number, string[]]>;
  zscore(key: string, member: string): Promise<number | null>;
  del(...keys: string[]): Promise<number>;
  zrem(key: string, ...members: string[]): Promise<number>;
}

export interface Holdings {
  cid: string;
  /** Per-conversation keys that exist now. */
  keys: string[];
  /** Whether the transcript index still lists the conversation. */
  indexed: boolean;
  /** Telegram mappings that point at the conversation. */
  telegram: string[];
}

/** The keys named after the conversation itself. */
export function conversationKeys(cid: string): string[] {
  return [convKey(cid), logKey(cid), liveKey(cid), heldKey(cid)];
}

function mappedCid(value: unknown): string | null {
  let parsed = value;
  if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { return null; } }
  if (!parsed || typeof parsed !== 'object') return null;
  const { cid } = parsed as { cid?: unknown };
  return typeof cid === 'string' ? cid : null;
}

/** Every Telegram mapping whose value names this conversation. */
export async function telegramMappings(cid: string, redis: DeleteRedis): Promise<string[]> {
  const found: string[] = [];
  let cursor: string | number = '0';
  do {
    const [next, keys]: [string | number, string[]] = await redis.scan(cursor, { match: TG_KEY_MATCH, count: 500 });
    cursor = String(next);
    for (const key of keys) if (mappedCid(await redis.get(key)) === cid) found.push(key);
  } while (cursor !== '0');
  return found;
}

export async function findHoldings(cid: string, redis: DeleteRedis): Promise<Holdings> {
  const keys: string[] = [];
  for (const key of conversationKeys(cid)) if (await redis.exists(key)) keys.push(key);
  const indexed = (await redis.zscore(TRANSCRIPT_INDEX, cid)) !== null;
  return { cid, keys, indexed, telegram: await telegramMappings(cid, redis) };
}

export const holdsNothing = (h: Holdings) => !h.keys.length && !h.indexed && !h.telegram.length;

/** Deletes what findHoldings found. Returns how many keys and index members went. */
export async function deleteHoldings(h: Holdings, redis: DeleteRedis): Promise<number> {
  const keys = [...h.keys, ...h.telegram];
  let removed = keys.length ? await redis.del(...keys) : 0;
  if (h.indexed) removed += await redis.zrem(TRANSCRIPT_INDEX, h.cid);
  return removed;
}

export interface Candidate {
  cid: string;
  /** When the conversation started. */
  first: number;
  questions: number;
  /** The visitor question that matched best, shortened. */
  excerpt: string;
}

const EXCERPT_MAX = 80;

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= EXCERPT_MAX) return flat;
  const cut = flat.slice(0, EXCERPT_MAX);
  const space = cut.lastIndexOf(' ');
  return `${(space > EXCERPT_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}...`;
}

/**
 * Conversations whose visitor questions contain every word of `query`
 * (case-insensitive), oldest first. A requester remembers what they asked,
 * not what Verso said, so only their side is searched.
 */
export function searchTranscripts(transcripts: Transcript[], query: string): Candidate[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const candidates: Candidate[] = [];
  for (const t of transcripts) {
    const asked = t.entries.filter(e => e.r === 'u');
    const said = asked.map(e => e.t.toLowerCase()).join('\n');
    if (!asked.length || !words.every(w => said.includes(w))) continue;
    const score = (text: string) => words.filter(w => text.toLowerCase().includes(w)).length;
    const best = asked.reduce((a, b) => (score(b.t) > score(a.t) ? b : a));
    candidates.push({ cid: t.cid, first: t.entries[0].ts, questions: asked.length, excerpt: shorten(best.t) });
  }
  return candidates.sort((a, b) => a.first - b.first);
}
