/**
 * The card index, built from the same published files retrieval reads.
 * Server-only: it reads content/ from disk through corpus.ts, so the drafts
 * and unpublished notes that corpus.ts skips can never become a card.
 */
import { loadDocs, readNowFile, type Doc } from './corpus';
import { articleImage } from './article-images';
import { workPresentation } from './work-presentation';
import { hasCaseVisual, partsFor } from './verso-parts';
import type { Card, CardIndex } from './verso-tools';

const NOTE_STATES = ['seedling', 'budding', 'evergreen'] as const;
const EXCERPT_MAX = 260;

/** Markdown to the plain text a reader sees, close enough to check a quote against. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]*)\|?([^\]]*)\]\]/g, (_m, target, alias) => alias || target)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+\.)[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:---+|\|?[-:| ]+\|[-:| ]*)[ \t]*$/gm, '')
    .replace(/[*`]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The first paragraph of prose, skipping headings and figures. */
function firstParagraph(markdown: string): string {
  const paragraph = plainText(markdown).split(/\n{2,}/).map(p => p.replace(/\s+/g, ' ').trim()).find(p => p.length > 40) ?? '';
  return clip(paragraph, EXCERPT_MAX);
}
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).replace(/[\s,;:.-]+$/, '')}...`;
}
const field = (fm: Doc['fm'], key: string) => {
  const value = (fm as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : value instanceof Date ? value.toISOString().slice(0, 10) : '';
};

function workCard(doc: Doc): Card {
  const presentation = workPresentation[doc.slug];
  const summary = presentation?.description || field(doc.fm, 'sub') || firstParagraph(doc.body);
  return {
    kind: 'work', slug: doc.slug, url: doc.url, title: presentation?.title ?? doc.fm.title ?? doc.slug,
    sector: field(doc.fm, 'sector'), role: field(doc.fm, 'role'), duration: field(doc.fm, 'duration'),
    ...(summary ? { summary } : {}),
  };
}

export async function createCardIndex(root?: string): Promise<CardIndex> {
  const [docs, now] = await Promise.all([loadDocs(root), readNowFile()]);
  const index: CardIndex = { work: {}, articles: {}, notes: {}, now: null, pages: {}, parts: {} };
  for (const doc of docs) {
    const title = doc.fm.title ?? doc.slug;
    const description = field(doc.fm, 'description') || field(doc.fm, 'sub') || undefined;
    index.pages[doc.url] = { title, ...(description ? { description } : {}), text: plainText(doc.body) };
    // Same rule VersoPartTemplates renders by, so a part the model can name always has a template.
    if (doc.type === 'work' || doc.type === 'portfolio') {
      const presentation = doc.type === 'work' ? workPresentation[doc.slug] : undefined;
      for (const entry of partsFor({
        type: doc.type, slug: doc.slug, url: doc.url,
        title: presentation?.title ?? title,
        hasPresentation: Boolean(presentation),
        hasVisual: hasCaseVisual(doc.slug, presentation),
        imageCount: Array.isArray(doc.fm.images) ? doc.fm.images.length : 0,
      })) index.parts[entry.key] = { title: entry.title, url: entry.url, parts: entry.parts };
    }
    if (doc.type === 'work') index.work[doc.slug] = workCard(doc);
    else if (doc.type === 'writing' || doc.type === 'research') {
      index.articles[`${doc.type}:${doc.slug}`] = {
        kind: 'article', collection: doc.type, slug: doc.slug, title, url: doc.url,
        description: description ?? firstParagraph(doc.body), date: doc.date, image: articleImage(doc.type, doc.slug),
      };
    } else if (doc.type === 'notes') {
      const status = NOTE_STATES.find(state => state === doc.fm.status) ?? 'seedling';
      index.notes[doc.slug] = { kind: 'note', slug: doc.slug, title, url: doc.url, status, date: doc.date };
    }
  }
  if (now) {
    const updated = field(now.fm, 'updated');
    const excerpt = firstParagraph(now.body) || clip(plainText(now.body).replace(/\s+/g, ' '), EXCERPT_MAX);
    index.now = { kind: 'now', title: 'What Jody is doing now', url: '/now', excerpt, ...(updated ? { updated } : {}) };
    index.pages['/now'] = { title: 'Now', text: plainText(now.body) };
  }
  return index;
}

let cached: Promise<CardIndex> | null = null;
/** Once per process: content only changes with a deploy. A failed build is not cached. */
export function buildCardIndex(): Promise<CardIndex> {
  cached ??= createCardIndex().catch(error => { cached = null; throw error; });
  return cached;
}
