import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

const readNowFile = vi.hoisted(() => vi.fn());
vi.mock('./corpus', async importOriginal => ({ ...await importOriginal<typeof import('./corpus')>(), readNowFile }));

import { createCardIndex, plainText } from './cards';
import { resolveCard } from './verso-tools';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'verso-cards-'));
  roots.push(root);
  for (const type of ['writing', 'notes', 'work', 'research', 'portfolio']) await mkdir(join(root, type));
  for (const [file, text] of Object.entries(files)) await writeFile(join(root, file), text);
  return root;
}

describe('createCardIndex', () => {
  it('builds cards from published content only', async () => {
    readNowFile.mockResolvedValue({ raw: '', fm: { updated: '2026-07-30' }, body: 'Just added a library section to the site, holding books and albums and the newest notes.' });
    const root = await fixture({
      'work/agentic-analytics-platform.md': '---\ntitle: Long brief title\nsector: Manufacturing\nrole: Lead Developer / Architect\nduration: 2026\nsub: A sub.\n---\nBody.',
      'work/Plain Case.md': '---\ntitle: Plain case\nsector: Retail\nrole: Architect\nduration: 2025\n---\n## Context\n\nThe first real paragraph of the brief explains what the work was for.',
      'work/Hidden.md': '---\ntitle: Hidden\ndraft: true\n---\nPrivate.',
      'writing/Essay.md': '---\ntitle: Essay\ndate: 2026-09-27\ndescription: An essay.\n---\nThe **essay** body.',
      'writing/Draft.md': '---\ntitle: Draft\nstatus: draft\n---\nSecret.',
      'research/2026-07-13-eve.md': '---\ntitle: Eve\nslug: vercel-eve-agent-framework\npubDate: 2026-07-13\ndescription: Agents.\n---\nResearch.',
      'notes/Note.md': '---\ntitle: Note\ndate: 2026-05-23\nstatus: budding\npublish: true\n---\nA note.',
      'notes/Private.md': '---\ntitle: Private\n---\nPrivate note.',
      'portfolio/Project.md': '---\ntitle: Project\ndescription: A project.\n---\nPortfolio body.',
    });
    const index = await createCardIndex(root);
    expect(Object.keys(index.work).sort()).toEqual(['agentic-analytics-platform', 'plain-case']);
    expect(index.work['agentic-analytics-platform']).toMatchObject({
      title: 'Brand Impact Tracker', role: 'Lead Developer / Architect', sector: 'Manufacturing', url: '/work/agentic-analytics-platform',
    });
    expect(index.work['plain-case']).toMatchObject({ title: 'Plain case', summary: 'The first real paragraph of the brief explains what the work was for.' });
    expect(index.articles['writing:essay']).toMatchObject({ collection: 'writing', date: '2026-09-27', description: 'An essay.' });
    expect(index.articles['research:vercel-eve-agent-framework']).toMatchObject({
      url: '/research/vercel-eve-agent-framework', image: '/images/articles/vercel-eve-agent-framework.webp',
    });
    expect(index.articles).not.toHaveProperty('writing:draft');
    expect(index.notes).toEqual({ note: { kind: 'note', slug: 'note', title: 'Note', url: '/notes/note', status: 'budding', date: '2026-05-23' } });
    expect(index.now).toMatchObject({ kind: 'now', url: '/now', updated: '2026-07-30' });
    expect(Object.keys(index.pages).sort()).toEqual([
      '/notes/note', '/now', '/portfolio/project', '/research/vercel-eve-agent-framework', '/work/agentic-analytics-platform',
      '/work/plain-case', '/writing/essay',
    ]);
    expect(index.pages['/writing/essay'].text).toBe('The essay body.');
    expect(JSON.parse(JSON.stringify(index))).toEqual(index);
  });

  it('omits the Now card when there is no Now file', async () => {
    readNowFile.mockResolvedValue(null);
    const index = await createCardIndex(await fixture({}));
    expect(index.now).toBeNull();
    expect(resolveCard(index, 'show_now', {})).toBeNull();
  });
});

describe('plainText', () => {
  it('drops markup a reader never sees', () => {
    expect(plainText('## Heading\n\n<figure><img src="x"></figure>\n\nSee [the brief](/work/x) and **this**.\n\n- item')).toBe('Heading\n\n \n\nSee the brief and this.\n\nitem');
  });
});
