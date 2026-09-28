import type { CorpusChunk } from './corpus';

export const ACTIVE_NAMESPACE_KEY = 'chat:corpus:active';
export interface RefreshStore {
  write(namespace: string, rows: Array<CorpusChunk & { vector: number[] }>): Promise<void>;
  verify(namespace: string, ids: string[]): Promise<boolean>;
  activate(namespace: string): Promise<void>;
}
export async function refreshCorpus(
  chunks: CorpusChunk[], namespace: string, store: RefreshStore,
  embed: (texts: string[]) => Promise<number[][]>,
): Promise<void> {
  if (!chunks.length || !namespace) throw new Error('Cannot activate an empty corpus');
  const ids = chunks.map(chunk => chunk.id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate chunk ids');
  for (let i = 0; i < chunks.length; i += 64) {
    const batch = chunks.slice(i, i + 64);
    const vectors = await embed(batch.map(chunk => chunk.text));
    if (vectors.length !== batch.length || vectors.some(vector =>
      !Array.isArray(vector) || !vector.length || vector.some(value => !Number.isFinite(value)))) {
      throw new Error('Invalid embedding batch');
    }
    await store.write(namespace, batch.map((chunk, j) => ({ ...chunk, vector: vectors[j] })));
  }
  if (!await store.verify(namespace, ids)) throw new Error('Replacement index verification failed');
  await store.activate(namespace);
}
