/**
 * The transcript log: every Verso conversation, kept 30 days so Jody can read
 * what people ask (`npm run conversations`).
 *
 * This is separate from the conversation in src/lib/conversation.ts, which
 * feeds the prompt and expires a day after its last message. Different jobs,
 * different lifetimes, and the prompt never reads from here.
 *
 * Emails, phone numbers and similar details are redacted on write (see
 * `@jodybrewster/gemini-live/server/redact`), so the log never holds the
 * contact details people type into a chat box. The dock discloses the 30 days, which run from the first
 * message: the list gets its TTL once, when it is created, and a read deletes
 * any log whose first entry is older than that.
 *
 * Keys: `chat:log:<cid>` is a list of entries, and `chat:log:index` is a sorted
 * set of cids scored by their first message, which is how the downloader finds
 * them without a SCAN and how the index is trimmed to match retention.
 * Writes never throw.
 */

import { getRedis } from './redis';
import { redactText } from '@jodybrewster/gemini-live/server/redact';

export const TRANSCRIPT_TTL_S = 30 * 86400;
export const TRANSCRIPT_INDEX = 'chat:log:index';
export const logKey = (cid: string) => `chat:log:${cid}`;

export interface TranscriptEntry {
  /** visitor | Verso | Jody */
  r: 'u' | 'a' | 'j';
  t: string;
  ts: number;
  /** On a visitor turn: what it was about (src/lib/topics.ts). */
  topic?: string;
  /** On a visitor turn: the page it was asked from. */
  page?: string;
  /** On a visitor turn Verso could not answer. */
  failed?: boolean;
  /** On a visitor turn held for Jody while he was live in the conversation. */
  held?: boolean;
}

export interface Transcript { cid: string; last: number; entries: TranscriptEntry[] }

/** The commands this module issues. The real client satisfies it structurally. */
export interface TranscriptRedis {
  /** Writes go through one transaction, so a failure cannot leave a list without its TTL. */
  multi(): TranscriptTransaction;
  lrange<T = unknown>(key: string, start: number, stop: number): Promise<T[]>;
  del(...keys: string[]): Promise<number>;
  zrem(key: string, ...members: string[]): Promise<number>;
  zremrangebyscore(key: string, min: number, max: number): Promise<number>;
  zrange<T = unknown[]>(key: string, min: number, max: number, opts: { byScore: true }): Promise<T>;
}

export interface TranscriptTransaction {
  rpush(key: string, ...values: unknown[]): TranscriptTransaction;
  expire(key: string, seconds: number, option: 'NX'): TranscriptTransaction;
  zadd(key: string, opts: { nx: true }, member: { score: number; member: string }): TranscriptTransaction;
  zremrangebyscore(key: string, min: number, max: number): TranscriptTransaction;
  exec(): Promise<unknown[]>;
}

export async function logEntries(
  cid: string,
  entries: TranscriptEntry[],
  redis: TranscriptRedis | null = getRedis() as TranscriptRedis | null,
): Promise<void> {
  if (!redis || !entries.length) return;
  try {
    const now = Date.now();
    const key = logKey(cid);
    // One request: the TTL is set only when the list is created (NX), so it
    // runs from the first message, and it cannot be lost between two requests.
    // The index is scored by the first write too (NX) and trimmed by that
    // score, which is what retention measures. It has no TTL of its own.
    await redis.multi()
      .rpush(key, ...entries.map(entry => JSON.stringify({ ...entry, t: redactText(entry.t) })))
      .expire(key, TRANSCRIPT_TTL_S, 'NX')
      .zadd(TRANSCRIPT_INDEX, { nx: true }, { score: now, member: cid })
      // Only entries two windows old: by then every list's own TTL has
      // removed it, so the index never forgets a log the read path must delete.
      .zremrangebyscore(TRANSCRIPT_INDEX, 0, now - 2 * TRANSCRIPT_TTL_S * 1000)
      .exec();
  } catch (err) {
    console.error('[transcripts] write failed', err instanceof Error ? err.name : 'Error');
  }
}

function parseEntry(row: unknown): TranscriptEntry | null {
  let value = row;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return null; } }
  if (!value || typeof value !== 'object') return null;
  const entry = value as TranscriptEntry;
  if (!['u', 'a', 'j'].includes(entry.r) || typeof entry.t !== 'string' || typeof entry.ts !== 'number') return null;
  return entry;
}

/** Every conversation active since `since`, oldest first. Throws on a Redis
 *  failure: this runs from a script, where a silent empty download would lie.
 *
 *  Reading also enforces retention: a log whose first entry is older than the
 *  window is deleted, and the index is trimmed, so nothing depends on the
 *  TTL alone. The index is scored by first message, so it is searched from one
 *  window before `since` and filtered by each conversation's last entry. */
export async function readTranscripts(since: number, redis: TranscriptRedis): Promise<Transcript[]> {
  const now = Date.now();
  const cutoff = now - TRANSCRIPT_TTL_S * 1000;
  // Expired conversations: delete each log before forgetting it in the index,
  // so one whose TTL never landed is still removed.
  const expired = await redis.zrange<string[]>(TRANSCRIPT_INDEX, 0, cutoff, { byScore: true });
  for (const cid of expired) {
    await redis.del(logKey(cid));
    await redis.zrem(TRANSCRIPT_INDEX, cid);
  }
  const cids = await redis.zrange<string[]>(TRANSCRIPT_INDEX, Math.max(0, since - TRANSCRIPT_TTL_S * 1000), now, { byScore: true });
  const transcripts: Transcript[] = [];
  for (const cid of cids) {
    const entries = (await redis.lrange(logKey(cid), 0, -1)).map(parseEntry).filter((e): e is TranscriptEntry => e !== null);
    if (entries.length && entries[0].ts < cutoff) {
      await redis.del(logKey(cid));
      await redis.zrem(TRANSCRIPT_INDEX, cid);
      continue;
    }
    if (entries.length && entries[entries.length - 1].ts >= since) transcripts.push({ cid, last: entries[entries.length - 1].ts, entries });
  }
  return transcripts;
}

const SPEAKERS = { u: 'Visitor', a: 'Verso', j: 'Jody' } as const;

function stamp(ts: number): string {
  return new Date(ts).toISOString().slice(0, 16).replace('T', ' ');
}

/** Counts that head the download: how much, about what, and how often Verso failed. */
export function summarize(transcripts: Transcript[]) {
  const questions = transcripts.flatMap(t => t.entries.filter(e => e.r === 'u'));
  const topics: Record<string, number> = {};
  for (const q of questions) topics[q.topic ?? 'untagged'] = (topics[q.topic ?? 'untagged'] ?? 0) + 1;
  return {
    conversations: transcripts.length,
    questions: questions.length,
    failed: questions.filter(q => q.failed).length,
    replies: transcripts.flatMap(t => t.entries.filter(e => e.r === 'j')).length,
    topics: Object.entries(topics).sort((a, b) => b[1] - a[1]),
  };
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function header(transcripts: Transcript[], opts: { since: number; until: number; digest?: string }, title: string): string[] {
  const s = summarize(transcripts);
  const lines = [
    `# ${title}, ${stamp(opts.since).slice(0, 10)} to ${stamp(opts.until).slice(0, 10)}`,
    '',
    `${count(s.conversations, 'conversation')}, ${count(s.questions, 'question')}, ${s.failed} unanswered, ${count(s.replies, 'reply', 'replies')} from Jody. Times are UTC.`,
    '',
    s.topics.length ? `Topics: ${s.topics.map(([topic, n]) => `${topic} ${n}`).join(', ')}.` : 'No questions in this range.',
    '',
  ];
  if (opts.digest) lines.push('## Digest', '', opts.digest.trim(), '');
  return lines;
}

/** The counts, topics and digest without the conversations, for places that must not hold transcripts. */
export function formatDigest(transcripts: Transcript[], opts: { since: number; until: number; digest: string }): string {
  return header(transcripts, opts, 'Verso digest').join('\n');
}

export function formatTranscripts(transcripts: Transcript[], opts: { since: number; until: number; digest?: string }): string {
  const lines = header(transcripts, opts, 'Verso conversations');
  for (const transcript of transcripts) {
    const first = transcript.entries.find(e => e.r === 'u');
    const meta = [stamp(transcript.entries[0].ts), transcript.cid.slice(0, 4), first?.page && `from ${first.page}`].filter(Boolean);
    lines.push(`## ${meta.join(' · ')}`, '');
    for (const entry of transcript.entries) {
      const tags = entry.r === 'u' ? [entry.topic, entry.held && 'held for Jody', entry.failed && 'no answer'].filter(Boolean) : [];
      lines.push(`${SPEAKERS[entry.r]}${tags.length ? ` (${tags.join(', ')})` : ''}:`, '', entry.t.trim(), '');
    }
  }
  return lines.join('\n');
}
