import { describe, expect, it } from 'vitest';
import { getChunkText, type SourceMetadata } from './rag';

describe('indexed source snapshots', () => {
  it('reads the exact indexed text even when the original MDX file no longer exists', async () => {
    const metadata: SourceMetadata & { text: string; source: string } = {
      type: 'writing', slug: 'changed-article', title: 'Original article', date: '',
      url: '/writing/changed-article', chunk: 1, source: 'writing/Changed Article.mdx',
      text: 'The exact original second chunk.\n\nIncluding its paragraph boundaries.',
    };
    await expect(getChunkText(metadata)).resolves.toBe(metadata.text);
  });
});
