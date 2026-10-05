/**
 * The files `npm run conversations` writes, and which of them a run deletes.
 *
 * The site deletes a transcript 30 days after its first message, and the
 * downloads follow the same clock. A transcript file is named for the day it
 * was written and the day its oldest conversation started
 * (`verso-2026-10-04-from-2026-09-10.md`), and goes once that oldest
 * conversation is 30 days old, measured from the start of its day, so no
 * conversation outlives the site's own copy here (the newer ones in the file
 * go with it; the next download fetches whatever the site still holds).
 * Digests (`verso-digest-2026-10-04.md`) hold no conversations and go 30 days
 * after they were written. Files named the old way (`verso-2026-10-04.md`,
 * before the oldest day was in the name) go 30 days after they were written.
 *
 * Only names this script writes are touched. Pure, so the rule is tested
 * without a file system.
 */
import { TRANSCRIPT_TTL_S } from '../src/lib/transcripts';

export const KEEP_MS = TRANSCRIPT_TTL_S * 1000;

const DAY = '(\\d{4}-\\d{2}-\\d{2})';
const OUTPUT = new RegExp(`^verso-(?:(digest)-${DAY}|${DAY}(?:-from-${DAY})?)\\.md$`);

export type OutputKind = 'transcripts' | 'digest';

const day = (at: number) => new Date(at).toISOString().slice(0, 10);

/** A transcript file's name carries `oldest`, the first message of its oldest conversation (or the write time when it has none). */
export function outputName(kind: 'digest', at: number): string;
export function outputName(kind: 'transcripts', at: number, oldest: number): string;
export function outputName(kind: OutputKind, at: number, oldest?: number): string {
  return kind === 'digest' ? `verso-digest-${day(at)}.md` : `verso-${day(at)}-from-${day(Math.min(oldest ?? at, at))}.md`;
}

const parseDay = (text: string) => {
  const at = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(at) && day(at) === text ? at : null;
};

/**
 * What a name says about a file, or null when this script did not write it.
 * `expiresFrom` is the moment its 30 days run from.
 */
export function parseOutputName(name: string): { kind: OutputKind; written: number; expiresFrom: number } | null {
  const match = OUTPUT.exec(name);
  if (!match) return null;
  const [, digest, digestDay, writtenDay, fromDay] = match;
  const written = parseDay(digest ? digestDay : writtenDay);
  const from = fromDay === undefined ? written : parseDay(fromDay);
  if (written === null || from === null) return null;
  return { kind: digest ? 'digest' : 'transcripts', written, expiresFrom: from };
}

/**
 * The names in one directory to delete: this script's files whose 30 days
 * have run out by `now`. With `transcriptsAnyAge` (the iCloud vault, which no
 * longer takes raw transcripts), transcript files go whatever their age.
 */
export function filesToPrune(names: string[], now: number, { transcriptsAnyAge = false } = {}): string[] {
  return names.filter(name => {
    const file = parseOutputName(name);
    if (!file) return false;
    if (transcriptsAnyAge && file.kind === 'transcripts') return true;
    return now - file.expiresFrom > KEEP_MS;
  });
}
