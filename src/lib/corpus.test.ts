import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalContentId, loadDocs, docToChunks } from './corpus';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'verso-corpus-'));
  roots.push(root);
  for (const type of ['writing', 'notes', 'work', 'research', 'portfolio']) await mkdir(join(root, type));
  for (const [file, text] of Object.entries(files)) await writeFile(join(root, file), text);
  return root;
}

describe('published Verso corpus', () => {
  it('uses Astro default IDs, preserving explicit frontmatter slugs', () => {
    expect(canonicalContentId("The Model That Won't Talk A Teardown of Jev.md")).toBe('the-model-that-wont-talk-a-teardown-of-jev');
    expect(canonicalContentId('Some Folder/index.mdx')).toBe('some-folder');
    expect(canonicalContentId('2026-07-30-topic.md', 'my-custom-url')).toBe('my-custom-url');
  });

  it('indexes all five collections using the pages’ publication rules', async () => {
    const root = await fixture({
      'writing/Essay.md': '---\ntitle: Essay\n---\nPublished essay',
      'writing/Draft.md': '---\ntitle: Draft\nstatus: draft\n---\nSecret draft',
      'notes/Private.md': '---\ntitle: Private\n---\nPrivate note',
      'notes/Note.md': '---\ntitle: Note\npublish: true\n---\nPublic note',
      'work/Case.md': '---\ntitle: Case\n---\nPublic work',
      'work/Secret.md': '---\ntitle: Secret\ndraft: true\n---\nPrivate work',
      'research/Research.mdx': '---\ntitle: Research\nslug: custom-research\npubDate: 2026-07-30\n---\nPublic research',
      'research/Secret.md': '---\ntitle: Hidden\npublish: false\n---\nPrivate research',
      'portfolio/Project.md': '---\ntitle: Project\n---\nPublic portfolio',
    });
    const docs = await loadDocs(root);
    expect(docs.map(doc => doc.url)).toEqual([
      '/writing/essay', '/notes/note', '/work/case', '/research/custom-research', '/portfolio/project',
    ]);
    expect(docs.find(doc => doc.type === 'research')?.date).toBe('2026-07-30');
  });

  it('parses real YAML and retains exact MDX content plus its source filename', async () => {
    const root = await fixture({
      'writing/Quoted Title.mdx': '---\r\ntitle: "A title: with punctuation"\r\ndescription: >-\r\n  First line\r\n  second line\r\ntags:\r\n  - ai\r\n  - systems\r\n---\r\n\r\n# Hello\r\n\r\n<Component value="original" />',
    });
    const [doc] = await loadDocs(root);
    const [chunk] = docToChunks(doc);
    expect(chunk.metadata.title).toBe('A title: with punctuation');
    expect(chunk.metadata.description).toBe('First line second line');
    expect(chunk.metadata.source).toBe('writing/Quoted Title.mdx');
    expect(chunk.metadata.text).toBe(doc.body);
    expect(chunk.text).toContain('<Component value="original" />');
  });

  it('fails a rebuild input when a configured collection is missing', async () => {
    const root = await fixture({});
    await rm(join(root, 'research'), { recursive: true });
    await expect(loadDocs(root)).rejects.toThrow();
  });

  it('rejects duplicate canonical URLs rather than silently overwriting vectors', async () => {
    const root = await fixture({
      'writing/One.md': '---\ntitle: One\nslug: same\n---\nFirst',
      'writing/Two.mdx': '---\ntitle: Two\nslug: same\n---\nSecond',
    });
    await expect(loadDocs(root)).rejects.toThrow(/duplicate/i);
  });
});
