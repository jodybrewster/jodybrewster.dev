/**
 * Download Verso's conversations as Markdown.
 *
 * Run: npm run conversations
 *   --days <n>   how far back to look (default 7, the log keeps 30)
 *   --digest     add a Gemini-written digest: themes, answers that fell short,
 *                and what the site is missing. Needs GEMINI_API_KEY.
 *   --vault      also write the digest (counts, topics and the digest, no
 *                conversations) into the Obsidian vault. Needs --digest: raw
 *                transcripts never go to the vault, which syncs to iCloud.
 *   --out <path> write the transcripts to this file instead
 *
 * The site deletes a transcript 30 days after its first message, and every
 * run deletes this script's earlier files on the same clock, in .conversations/
 * and the vault (scripts/conversation-files.ts): a transcript file once its
 * oldest conversation is 30 days old (the name carries that day), a digest 30
 * days after it was written, and any transcript file still in the vault from
 * before it stopped taking them. A file written with --out is yours to delete.
 *
 * Reads the transcript log (src/lib/transcripts.ts) from the production Redis,
 * so .env needs PROD_UPSTASH_REDIS_REST_URL and _TOKEN. They carry a PROD_
 * prefix so `npm run dev` never picks them up and writes into production. Output goes
 * to .conversations/, which is gitignored: these are visitors' words and they
 * do not belong in the repo.
 */
import 'dotenv/config';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Redis } from '@upstash/redis';
import { GoogleGenAI } from '@google/genai';
import { filesToPrune, outputName } from './conversation-files';
import { formatDigest, formatTranscripts, readTranscripts, summarize, TRANSCRIPT_TTL_S, type Transcript, type TranscriptRedis } from '../src/lib/transcripts';

const VAULT_DIR = '/Users/jodybrewster/Library/Mobile Documents/iCloud~md~obsidian/Documents/Sheikah Slate/personal/projects/jodybrewster.dev/verso';
const OUT_DIR = '.conversations';
const DIGEST_MODEL = 'gemini-3.8-flash';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) { console.error(`${name} needs a value.`); process.exit(1); }
  return value;
};

const wantDigest = args.includes('--digest');
const toVault = args.includes('--vault');
if (toVault && !wantDigest) {
  console.error('--vault writes only the digest into the vault, so it needs --digest. Raw transcripts stay in .conversations/.');
  process.exit(1);
}

const days = Number(flag('--days') ?? 7);
if (!Number.isFinite(days) || days <= 0) { console.error('--days must be a positive number.'); process.exit(1); }
if (days > TRANSCRIPT_TTL_S / 86400) console.warn(`The log keeps ${TRANSCRIPT_TTL_S / 86400} days; older conversations are gone.`);

const url = process.env.PROD_UPSTASH_REDIS_REST_URL;
const token = process.env.PROD_UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) {
  console.error('Set PROD_UPSTASH_REDIS_REST_URL and PROD_UPSTASH_REDIS_REST_TOKEN in .env to the production database (Upstash console, REST API).');
  process.exit(1);
}

async function digest(transcripts: Transcript[]): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) { console.error('--digest needs GEMINI_API_KEY in .env.'); process.exit(1); }
  const ai = new GoogleGenAI({ apiKey: key });
  const result = await ai.models.generateContent({
    model: DIGEST_MODEL,
    contents: formatTranscripts(transcripts, { since, until }),
    config: {
      systemInstruction: `These are conversations visitors had with Verso, the AI assistant on Jody Brewster's personal site, which answers from his published writing and case studies. Jody reads this to learn what people want from the site. Write plain Markdown with three short sections, each a "###" heading: "What people asked about" (the recurring themes, with how many conversations each), "Where Verso fell short" (answers that were wrong, vague, refused or missing, each described in your own words: never quote or closely paraphrase a visitor), and "What the site is missing" (content Jody could write or publish that would have answered them). Be specific and brief. Do not invent conversations. Refer to Jody in the third person.`,
    },
  });
  return result.text ?? '';
}

/** Deletes this script's own files past retention from one directory. A missing directory has nothing to prune. */
async function prune(dir: string, now: number, opts?: { transcriptsAnyAge?: boolean }): Promise<void> {
  let names: string[];
  try { names = await readdir(dir); } catch { return; }
  for (const name of filesToPrune(names, now, opts)) {
    await rm(join(dir, name));
    console.log(`Deleted ${join(dir, name)}`);
  }
}

const until = Date.now();
const since = until - days * 86400_000;
await prune(OUT_DIR, until);
await prune(VAULT_DIR, until, { transcriptsAnyAge: true });

const redis = new Redis({ url, token }) as unknown as TranscriptRedis;
const transcripts = await readTranscripts(since, redis);
const counts = summarize(transcripts);
console.log(`${counts.conversations} conversations, ${counts.questions} questions in the last ${days} days.`);

const digestText = wantDigest && transcripts.length ? await digest(transcripts) : undefined;
// The first message of the oldest conversation in the file, which its 30 days run from.
const oldest = Math.min(until, ...transcripts.map(t => t.entries[0].ts));
const out = flag('--out') ?? join(OUT_DIR, outputName('transcripts', until, oldest));
await mkdir(dirname(out), { recursive: true });
await writeFile(out, formatTranscripts(transcripts, { since, until, digest: digestText }));
console.log(`Written to ${out}`);

if (toVault) {
  const vaultOut = join(VAULT_DIR, outputName('digest', until));
  await mkdir(VAULT_DIR, { recursive: true });
  await writeFile(vaultOut, formatDigest(transcripts, { since, until, digest: digestText ?? 'No conversations in this range.' }));
  console.log(`Digest written to ${vaultOut}`);
}
