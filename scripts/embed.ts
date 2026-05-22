/**
 * Embed all published content into Upstash Vector.
 *
 * Reads ./content/{writing,notes,work}/*.md, chunks at ~500 words with 50-word
 * overlap, embeds via Voyage voyage-3-lite (512 dims), upserts to Upstash with
 * metadata for retrieval-side citation rendering.
 *
 * Run: npm run embed
 */
import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Index } from '@upstash/vector';

const VOYAGE_API = 'https://api.voyageai.com/v1/embeddings';
const MODEL = 'voyage-3-lite';
const CHUNK_WORDS = 500;
const OVERLAP_WORDS = 50;
const BATCH_SIZE = 64;

interface Frontmatter {
  title?: string;
  date?: string;
  description?: string;
  status?: string;
  publish?: boolean;
  sector?: string;
  role?: string;
  duration?: string;
  pillar?: string;
  tags?: string[];
}

type DocType = 'writing' | 'notes' | 'work';

interface Doc {
  type: DocType;
  slug: string;
  url: string;
  fm: Frontmatter;
  body: string;
}

interface Chunk {
  id: string;
  text: string;
  metadata: {
    type: DocType;
    slug: string;
    title: string;
    date: string;
    url: string;
    chunk: number;
    description?: string;
  };
}

function parseFrontmatter(raw: string): { fm: Frontmatter; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: raw };
  const fm: Frontmatter = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val: string | string[] | boolean = line.slice(idx + 1).trim();
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    else if (typeof val === 'string') {
      if (val.startsWith('[') && val.endsWith(']')) {
        val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      } else {
        val = val.replace(/^["']|["']$/g, '');
      }
    }
    (fm as Record<string, unknown>)[key] = val;
  }
  return { fm, body: m[2].trim() };
}

async function loadDocs(): Promise<Doc[]> {
  const docs: Doc[] = [];
  const collections: Array<{ type: DocType; dir: string; filter?: (fm: Frontmatter) => boolean }> = [
    { type: 'writing', dir: 'content/writing', filter: fm => fm.status !== 'draft' },
    { type: 'notes', dir: 'content/notes', filter: fm => fm.publish === true },
    { type: 'work', dir: 'content/work' },
  ];

  for (const { type, dir, filter } of collections) {
    let files: string[];
    try {
      files = (await readdir(dir)).filter(f => f.endsWith('.md') || f.endsWith('.mdx'));
    } catch {
      continue;
    }
    for (const file of files) {
      const raw = await readFile(join(dir, file), 'utf-8');
      const { fm, body } = parseFrontmatter(raw);
      if (filter && !filter(fm)) continue;
      const slug = basename(file).replace(/\.mdx?$/, '');
      docs.push({ type, slug, url: `/${type}/${slug}`, fm, body });
    }
  }
  return docs;
}

function chunkText(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= CHUNK_WORDS) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += CHUNK_WORDS - OVERLAP_WORDS) {
    chunks.push(words.slice(i, i + CHUNK_WORDS).join(' '));
    if (i + CHUNK_WORDS >= words.length) break;
  }
  return chunks;
}

function docToChunks(doc: Doc): Chunk[] {
  const pieces = chunkText(doc.body);
  return pieces.map((text, i) => ({
    id: `${doc.type}:${doc.slug}#${i}`,
    text,
    metadata: {
      type: doc.type,
      slug: doc.slug,
      title: doc.fm.title ?? doc.slug,
      date: doc.fm.date ?? '',
      url: doc.url,
      chunk: i,
      description: doc.fm.description,
    },
  }));
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch(VOYAGE_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: texts, model: MODEL, input_type: 'document' }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Voyage API error ${res.status}: ${errBody}`);
  }
  const json = await res.json() as { data: Array<{ embedding: number[]; index: number }> };
  return json.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
}

async function main() {
  if (!process.env.VOYAGE_API_KEY) throw new Error('VOYAGE_API_KEY missing');
  if (!process.env.UPSTASH_VECTOR_REST_URL) throw new Error('UPSTASH_VECTOR_REST_URL missing');

  const index = new Index({
    url: process.env.UPSTASH_VECTOR_REST_URL,
    token: process.env.UPSTASH_VECTOR_REST_TOKEN,
  });

  console.log('Loading docs…');
  const docs = await loadDocs();
  console.log(`Loaded ${docs.length} docs (writing+notes+work).`);

  const allChunks: Chunk[] = docs.flatMap(docToChunks);
  console.log(`Chunked into ${allChunks.length} pieces.`);

  console.log('Resetting index…');
  await index.reset();

  for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
    const batch = allChunks.slice(i, i + BATCH_SIZE);
    const vectors = await embedBatch(batch.map(c => c.text));
    await index.upsert(
      batch.map((c, j) => ({ id: c.id, vector: vectors[j], metadata: c.metadata })),
    );
    console.log(`  Upserted ${Math.min(i + BATCH_SIZE, allChunks.length)}/${allChunks.length}`);
  }

  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
