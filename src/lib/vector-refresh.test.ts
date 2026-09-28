import { describe, expect, it } from 'vitest';
import { refreshCorpus, type RefreshStore } from './vector-refresh';
import type { CorpusChunk } from './corpus';

const chunk: CorpusChunk = { id: 'work:one#0', text: 'A real case study.', metadata: {
  type: 'work', slug: 'one', title: 'One', url: '/work/one', date: '', chunk: 0,
} };
function storage(failVerify = false) {
  const state = { active: 'previous', staged: new Map<string, number>() };
  const store: RefreshStore = {
    async write(namespace, rows) { state.staged.set(namespace, rows.length); },
    async verify(namespace, ids) { return !failVerify && state.staged.get(namespace) === ids.length; },
    async activate(namespace) { state.active = namespace; },
  };
  return { state, store };
}
describe('safe vector refresh', () => {
  it('preserves the active index if embeddings fail', async () => {
    const { state, store } = storage();
    await expect(refreshCorpus([chunk], 'replacement', store, async () => { throw new Error('embedding offline'); })).rejects.toThrow('embedding offline');
    expect(state.active).toBe('previous'); expect(state.staged.size).toBe(0);
  });
  it('preserves the active index when replacement verification fails', async () => {
    const { state, store } = storage(true);
    await expect(refreshCorpus([chunk], 'replacement', store, async () => [[1, 2]])).rejects.toThrow('verification');
    expect(state.active).toBe('previous');
  });
  it('activates only a complete verified replacement', async () => {
    const { state, store } = storage();
    await refreshCorpus([chunk], 'replacement', store, async () => [[1, 2]]);
    expect(state.active).toBe('replacement');
  });
  it('rejects empty or mismatched embeddings without replacing the index', async () => {
    const { state, store } = storage();
    await expect(refreshCorpus([], 'replacement', store, async () => [])).rejects.toThrow();
    await expect(refreshCorpus([chunk], 'replacement', store, async () => [])).rejects.toThrow();
    expect(state.active).toBe('previous');
  });
});
