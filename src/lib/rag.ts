import { Index } from '@upstash/vector';
import { env } from './env';

const VOYAGE_API = 'https://api.voyageai.com/v1/embeddings';
const MODEL = 'voyage-3-lite';

export interface SourceMetadata {
  type: 'writing' | 'notes' | 'work';
  slug: string;
  title: string;
  date: string;
  url: string;
  chunk: number;
  description?: string;
}

export interface SearchHit {
  id: string;
  score: number;
  metadata: SourceMetadata;
  data?: string;
}

let _index: Index | null = null;
function getIndex(): Index {
  if (_index) return _index;
  const url = env('UPSTASH_VECTOR_REST_URL');
  const token = env('UPSTASH_VECTOR_REST_TOKEN');
  if (!url || !token) throw new Error('UPSTASH_VECTOR_REST_URL / TOKEN missing');
  _index = new Index({ url, token });
  return _index;
}

export async function embedQuery(query: string): Promise<number[]> {
  const key = env('VOYAGE_API_KEY');
  if (!key) throw new Error('VOYAGE_API_KEY missing');
  const res = await fetch(VOYAGE_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: [query], model: MODEL, input_type: 'query' }),
  });
  if (!res.ok) {
    throw new Error(`Voyage embed failed (${res.status}): ${await res.text()}`);
  }
  const json = await res.json() as { data: Array<{ embedding: number[] }> };
  return json.data[0].embedding;
}

export async function searchVectors(query: string, topK = 5, filter?: { type?: SourceMetadata['type'] }): Promise<SearchHit[]> {
  const vector = await embedQuery(query);
  const opts: { vector: number[]; topK: number; includeMetadata: boolean; filter?: string } = {
    vector,
    topK,
    includeMetadata: true,
  };
  if (filter?.type) {
    opts.filter = `type = '${filter.type}'`;
  }
  const results = await getIndex().query(opts);
  return results.map(r => ({
    id: String(r.id),
    score: r.score,
    metadata: r.metadata as SourceMetadata,
  }));
}

/**
 * Pull the actual chunk text back from the markdown file at retrieval time.
 * Stored vectors don't carry full text (we keep the index lean); the file is
 * the source of truth.
 */
export async function getChunkText(meta: SourceMetadata): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const raw = await readFile(resolve(`content/${meta.type}/${meta.slug}.md`), 'utf-8');
  const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
  const words = body.split(/\s+/).filter(Boolean);
  const CHUNK = 500;
  const OVERLAP = 50;
  const start = meta.chunk * (CHUNK - OVERLAP);
  return words.slice(start, start + CHUNK).join(' ');
}
