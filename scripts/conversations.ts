/**
 * Download Verso's conversations as Markdown.
 *
 * Run: npm run conversations
 *   --days <n>   how far back to look (default 7, the log keeps 30)
 *   --digest     add a Gemini-written digest: themes, answers that fell short,
 *                and what the site is missing. Needs GEMINI_API_KEY.
 *   --vault      write into the Obsidian vault instead of .conversations/
 *   --out <path> write to this file instead
 *
 * Reads the transcript log (src/lib/transcripts.ts) from the production Redis,
 * so .env needs the production UPSTASH_REDIS_REST_URL and _TOKEN. Output goes
 * to .conversations/, which is gitignored: these are visitors' words and they
 * do not belong in the repo.
 */
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Redis } from '@upstash/redis';
import { GoogleGenAI } from '@google/genai';
import { formatTranscripts, readTranscripts, summarize, TRANSCRIPT_TTL_S, type Transcript, type TranscriptRedis } from '../src/lib/transcripts';

const VAULT_DIR = '/Users/jodybrewster/Library/Mobile Documents/iCloud~md~obsidian/Documents/Sheikah Slate/personal/projects/jodybrewster.dev/verso';
const DIGEST_MODEL = 'gemini-3.8-flash';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) { console.error(`${name} needs a value.`); process.exit(1); }
  return value;
};

const days = Number(flag('--days') ?? 7);
if (!Number.isFinite(days) || days <= 0) { console.error('--days must be a positive number.'); process.exit(1); }
if (days > TRANSCRIPT_TTL_S / 86400) console.warn(`The log keeps ${TRANSCRIPT_TTL_S / 86400} days; older conversations are gone.`);

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) {
  console.error('Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in .env to the production database (Upstash console, REST API).');
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
      systemInstruction: `These are conversations visitors had with Verso, the AI assistant on Jody Brewster's personal site, which answers from his published writing and case studies. Jody reads this to learn what people want from the site. Write plain Markdown with three short sections, each a "###" heading: "What people asked about" (the recurring themes, with how many conversations each), "Where Verso fell short" (answers that were wrong, vague, refused or missing, quoting the question), and "What the site is missing" (content Jody could write or publish that would have answered them). Be specific and brief. Do not invent conversations. Refer to Jody in the third person.`,
    },
  });
  return result.text ?? '';
}

const until = Date.now();
const since = until - days * 86400_000;
const redis = new Redis({ url, token }) as unknown as TranscriptRedis;
const transcripts = await readTranscripts(since, redis);
const counts = summarize(transcripts);
console.log(`${counts.conversations} conversations, ${counts.questions} questions in the last ${days} days.`);

const markdown = formatTranscripts(transcripts, {
  since, until,
  digest: args.includes('--digest') && transcripts.length ? await digest(transcripts) : undefined,
});
const name = `verso-${new Date(until).toISOString().slice(0, 10)}.md`;
const out = flag('--out') ?? join(args.includes('--vault') ? VAULT_DIR : '.conversations', name);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, markdown);
console.log(`Written to ${out}`);
