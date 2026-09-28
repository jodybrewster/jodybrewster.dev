/** Stage a complete corpus, verify it, then activate it. Never reset the live index. */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Index } from '@upstash/vector';
import { Redis } from '@upstash/redis';
import { loadDocs, docToChunks } from '../src/lib/corpus';
import { ACTIVE_NAMESPACE_KEY, refreshCorpus } from '../src/lib/vector-refresh';
import { withDeadline } from '../src/lib/deadline';

async function main() {
  if (process.argv.includes('--if-production') && process.env.VERCEL_ENV !== 'production') return;
  const docs = await loadDocs();
  const chunks = docs.flatMap(docToChunks);
  console.log(`Published corpus: ${docs.length} documents, ${chunks.length} chunks.`);
  if (process.argv.includes('--dry-run')) {
    for (const doc of docs) console.log(`${doc.type}\t${doc.url}\t${doc.fm.title}`);
    return;
  }
  for (const key of ['VOYAGE_API_KEY', 'UPSTASH_VECTOR_REST_URL', 'UPSTASH_VECTOR_REST_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
    if (!process.env[key] || process.env[key] === '[SENSITIVE]') throw new Error(`${key} missing`);
  }
  const index = new Index({ url: process.env.UPSTASH_VECTOR_REST_URL, token: process.env.UPSTASH_VECTOR_REST_TOKEN,
    signal: () => AbortSignal.timeout(10_000), retry: false });
  const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN,
    signal: () => AbortSignal.timeout(5000), retry: false });
  // Read the pointer before any embeddings are billed. The old namespace is
  // deliberately retained for rollback and any queries already in flight.
  const previous = await redis.get<string>(ACTIVE_NAMESPACE_KEY);
  const namespace = `corpus-${Date.now()}-${randomUUID().slice(0, 8)}`;
  console.log(`Staging ${namespace}; current namespace: ${previous ?? '(default)'}.`);
  await refreshCorpus(chunks, namespace, {
    async write(name, rows) {
      await index.namespace(name).upsert(rows.map(row => ({ id: row.id, vector: row.vector, metadata: { ...row.metadata } })));
    },
    async verify(name, ids) {
      const limit = Date.now() + 30_000;
      while (Date.now() < limit) {
        const info = (await index.info()).namespaces[name];
        if (info?.vectorCount === ids.length && info.pendingVectorCount === 0) {
          for (let i = 0; i < ids.length; i += 100) {
            const batch = ids.slice(i, i + 100);
            const fetched = await index.namespace(name).fetch(batch, { includeMetadata: true });
            if (fetched.some(row => !row || typeof row.metadata?.text !== 'string') || fetched.length !== batch.length) return false;
          }
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      return false;
    },
    async activate(name) {
      await redis.set(ACTIVE_NAMESPACE_KEY, name);
      console.log(`Active namespace: ${name}. Previous namespace retained: ${previous ?? '(default)'}.`);
    },
  }, async texts => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await withDeadline(async (signal: AbortSignal): Promise<
        { ok: true; vectors: number[][] } | { ok: false; status: number; retryAfter: string | null }
      > => {
        const response = await fetch('https://api.voyageai.com/v1/embeddings', {
          method: 'POST', signal,
          headers: { Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: texts, model: 'voyage-3-lite', input_type: 'document' }),
        });
        if (response.ok) {
          const body = await response.json() as { data: Array<{ index: number; embedding: number[] }> };
          return { ok: true, vectors: body.data.sort((a, b) => a.index - b.index).map(row => row.embedding) };
        }
        await response.body?.cancel();
        return { ok: false, status: response.status, retryAfter: response.headers.get('retry-after') };
      }, 30_000);
      if (result.ok) return result.vectors;
      if (result.status !== 429 || attempt === 2) {
        throw new Error(`Voyage embedding failed (${result.status}); active corpus unchanged`);
      }
      const requested = Number(result.retryAfter) * 1000;
      const delay = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 8000) : 2000 * (attempt + 1);
      console.warn(`Voyage rate limited the refresh; retrying in ${delay}ms (${attempt + 1}/2).`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    throw new Error('Voyage embedding failed; active corpus unchanged');
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Corpus refresh failed');
    if (process.argv.includes('--allow-failure')) {
      console.warn('Corpus refresh skipped; the previous active namespace remains in service.');
    } else process.exitCode = 1;
  });
}
