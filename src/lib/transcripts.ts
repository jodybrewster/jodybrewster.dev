/**
 * The transcript log: every Verso conversation, kept 30 days so Jody can read
 * what people ask (`npm run conversations`).
 *
 * This is separate from the conversation in src/lib/conversation.ts, which
 * feeds the prompt and expires a day after its last message. Different jobs,
 * different lifetimes, and the prompt never reads from here.
 *
 * Emails and phone numbers are redacted on write, so the log never holds the
 * contact details people type into a chat box. The dock discloses the 30 days.
 *
 * Keys: `chat:log:<cid>` is a list of entries, and `chat:log:index` is a sorted
 * set of cids scored by their last activity, which is how the downloader finds
 * them without a SCAN. Nothing here throws.
 */

import { getRedis } from './redis';

export const TRANSCRIPT_TTL_S = 30 * 86400;
const INDEX = 'chat:log:index';
const logKey = (cid: string) => `chat:log:${cid}`;

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
}

export interface Transcript { cid: string; last: number; entries: TranscriptEntry[] }

/** The commands this module issues. The real client satisfies it structurally. */
export interface TranscriptRedis {
  rpush(key: string, ...values: unknown[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  lrange<T = unknown>(key: string, start: number, stop: number): Promise<T[]>;
  zadd(key: string, member: { score: number; member: string }): Promise<number | null>;
  zremrangebyscore(key: string, min: number, max: number): Promise<number>;
  zrange<T = unknown[]>(key: string, min: number, max: number, opts: { byScore: true }): Promise<T>;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
/** A run of digits and separators. Only runs with nine or more digits are
 *  phone numbers; "2019-2024" and "$120,000" stay as they are. */
const DIGIT_RUN = /\+?\d[\d\s().-]{6,}\d/g;

export function redact(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(DIGIT_RUN, run => (run.match(/\d/g)?.length ?? 0) >= 9 ? '[phone]' : run);
}

export async function logEntries(
  cid: string,
  entries: TranscriptEntry[],
  redis: TranscriptRedis | null = getRedis() as TranscriptRedis | null,
): Promise<void> {
  if (!redis || !entries.length) return;
  try {
    const now = Date.now();
    await redis.rpush(logKey(cid), ...entries.map(entry => JSON.stringify({ ...entry, t: redact(entry.t) })));
    await redis.expire(logKey(cid), TRANSCRIPT_TTL_S);
    await redis.zadd(INDEX, { score: now, member: cid });
    // The index has no TTL of its own, so it is trimmed as it grows.
    await redis.zremrangebyscore(INDEX, 0, now - TRANSCRIPT_TTL_S * 1000);
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
 *  failure: this runs from a script, where a silent empty download would lie. */
export async function readTranscripts(since: number, redis: TranscriptRedis): Promise<Transcript[]> {
  const cids = await redis.zrange<string[]>(INDEX, since, Date.now(), { byScore: true });
  const transcripts: Transcript[] = [];
  for (const cid of cids) {
    const entries = (await redis.lrange(logKey(cid), 0, -1)).map(parseEntry).filter((e): e is TranscriptEntry => e !== null);
    if (entries.length) transcripts.push({ cid, last: entries[entries.length - 1].ts, entries });
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

export function formatTranscripts(transcripts: Transcript[], opts: { since: number; until: number; digest?: string }): string {
  const s = summarize(transcripts);
  const lines = [
    `# Verso conversations, ${stamp(opts.since).slice(0, 10)} to ${stamp(opts.until).slice(0, 10)}`,
    '',
    `${count(s.conversations, 'conversation')}, ${count(s.questions, 'question')}, ${s.failed} unanswered, ${count(s.replies, 'reply', 'replies')} from Jody. Times are UTC.`,
    '',
    s.topics.length ? `Topics: ${s.topics.map(([topic, n]) => `${topic} ${n}`).join(', ')}.` : 'No questions in this range.',
    '',
  ];
  if (opts.digest) lines.push('## Digest', '', opts.digest.trim(), '');
  for (const transcript of transcripts) {
    const first = transcript.entries.find(e => e.r === 'u');
    const meta = [stamp(transcript.entries[0].ts), transcript.cid.slice(0, 4), first?.page && `from ${first.page}`].filter(Boolean);
    lines.push(`## ${meta.join(' · ')}`, '');
    for (const entry of transcript.entries) {
      const tags = entry.r === 'u' ? [entry.topic, entry.failed && 'no answer'].filter(Boolean) : [];
      lines.push(`${SPEAKERS[entry.r]}${tags.length ? ` (${tags.join(', ')})` : ''}:`, '', entry.t.trim(), '');
    }
  }
  return lines.join('\n');
}
