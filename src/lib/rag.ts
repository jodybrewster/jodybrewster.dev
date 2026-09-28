import { Index } from '@upstash/vector';
import { env } from './env';
import { getRedis } from './redis';
import { withDeadline } from './deadline';
import { ACTIVE_NAMESPACE_KEY } from './vector-refresh';
import { canonicalContentId, readDoc, docToChunks, COLLECTIONS, type CollectionType } from './corpus';

const VOYAGE_API = 'https://api.voyageai.com/v1/embeddings';
const MODEL = 'voyage-3-lite';

export interface SourceMetadata {
  type: CollectionType;
  slug: string;
  title: string;
  date: string;
  url: string;
  chunk: number;
  description?: string;
  /** Exact text embedded at index time; never reconstructed from edited files. */
  text?: string;
  source?: string;
}

export interface SearchHit {
  id: string;
  score: number;
  metadata: SourceMetadata;
  data?: string;
}

function getIndex(signal: AbortSignal): Index {
  const url = env('UPSTASH_VECTOR_REST_URL');
  const token = env('UPSTASH_VECTOR_REST_TOKEN');
  if (!url || !token) throw new Error('UPSTASH_VECTOR_REST_URL / TOKEN missing');
  return new Index({ url, token, signal, retry: false });
}

export async function embedQuery(query: string, signal?: AbortSignal): Promise<number[]> {
  const key = env('VOYAGE_API_KEY');
  if (!key) throw new Error('VOYAGE_API_KEY missing');
  return withDeadline(async requestSignal => {
  const res = await fetch(VOYAGE_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: [query], model: MODEL, input_type: 'query' }),
    signal: requestSignal,
  });
  if (!res.ok) {
    throw new Error(`Voyage embed failed (${res.status})`);
  }
  const json = await res.json() as { data: Array<{ embedding: number[] }> };
  return json.data[0].embedding;
  }, 8000, signal);
}

export async function searchVectors(query: string, topK = 5, filter?: { type?: SourceMetadata['type'] }, signal?: AbortSignal): Promise<SearchHit[]> {
  return withDeadline(async requestSignal => {
  const vector = await embedQuery(query, requestSignal);
  const opts: { vector: number[]; topK: number; includeMetadata: boolean; filter?: string } = {
    vector,
    topK,
    includeMetadata: true,
  };
  if (filter?.type) {
    opts.filter = `type = '${filter.type}'`;
  }
  const redis = getRedis();
  const active = redis ? await redis.get<string>(ACTIVE_NAMESPACE_KEY) : null;
  requestSignal.throwIfAborted();
  const results = await getIndex(requestSignal).namespace(typeof active === 'string' ? active : '').query(opts);
  const hits: SearchHit[] = [];
  for (const row of results) {
    const metadata = row.metadata as unknown as SourceMetadata;
    if (!metadata || !COLLECTIONS.includes(metadata.type)) continue;
    // Legacy default-namespace records used filenames as slugs. Resolve their
    // current published entry until the first safe refresh activates snapshots.
    if (typeof metadata.text !== 'string') {
      const doc = await readDoc(metadata.type, canonicalContentId(`${metadata.slug}.md`));
      if (!doc) continue;
      const chunk = docToChunks(doc)[metadata.chunk];
      if (!chunk) continue;
      hits.push({ id: String(row.id), score: row.score, metadata: chunk.metadata });
    } else hits.push({ id: String(row.id), score: row.score, metadata });
  }
  requestSignal.throwIfAborted();
  return hits;
  }, 12_000, signal);
}

/** Use the indexed snapshot, with a published-file fallback for legacy records. */
export async function getChunkText(meta: SourceMetadata): Promise<string> {
  if (typeof meta.text === 'string') return meta.text;
  const doc = await readDoc(meta.type, canonicalContentId(`${meta.slug}.md`));
  const chunk = doc && docToChunks(doc)[meta.chunk];
  if (!chunk) throw new Error('Source is no longer published; refresh the corpus');
  return chunk.text;
}
