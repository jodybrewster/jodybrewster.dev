/** Published content shared by retrieval, index refreshes, and agent tools. */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { slug as githubSlug } from 'github-slugger';
import { parse } from 'yaml';
import type { SourceMetadata } from './rag';

export interface Frontmatter {
  title?: string; date?: string; pubDate?: string; description?: string;
  status?: string; publish?: boolean; draft?: boolean; slug?: string;
  sector?: string; role?: string; duration?: string; pillar?: string; tags?: string[];
  images?: unknown[];
}
export const COLLECTIONS = ['writing', 'notes', 'work', 'research', 'portfolio'] as const;
export type CollectionType = typeof COLLECTIONS[number];
export interface Doc {
  type: CollectionType; slug: string; url: string; raw: string; body: string;
  fm: Frontmatter; date: string; source: string;
}
export interface CorpusChunk { id: string; text: string; metadata: SourceMetadata }
export function canonicalContentId(file: string, explicit?: string): string {
  if (explicit) return explicit;
  return file.replace(/\.mdx?$/i, '').split('/').map(part => githubSlug(part)).join('/').replace(/\/index$/, '');
}
export function parseFrontmatter(raw: string): { fm: Frontmatter; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) return { fm: {}, body: raw.trim() };
  const fm: unknown = parse(match[1]);
  if (!fm || typeof fm !== 'object' || Array.isArray(fm)) throw new Error('Invalid content frontmatter');
  return { fm: fm as Frontmatter, body: match[2].trim() };
}
function published(type: CollectionType, fm: Frontmatter): boolean {
  if (type === 'writing') return fm.status !== 'draft';
  if (type === 'notes') return fm.publish === true;
  if (type === 'work') return fm.draft !== true;
  if (type === 'research') return fm.publish !== false;
  return true;
}
async function filesIn(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(join(dir, prefix), { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return filesIn(dir, relative);
    return Promise.resolve(entry.isFile() && /\.mdx?$/.test(entry.name) ? [relative] : []);
  }));
  return nested.flat().sort();
}
async function collection(type: CollectionType, root: string): Promise<Doc[]> {
  const docs: Doc[] = [];
  for (const file of await filesIn(join(root, type))) {
    const raw = await readFile(join(root, type, file), 'utf-8');
    const { fm, body } = parseFrontmatter(raw);
    if (!published(type, fm)) continue;
    const slug = canonicalContentId(file, fm.slug);
    if (!slug || slug.includes('..') || /[?#\\]/.test(slug) || slug.startsWith('/')) throw new Error(`Invalid content slug: ${file}`);
    docs.push({ type, slug, url: `/${type}/${slug}`, raw, body, fm,
      date: String(fm.date ?? fm.pubDate ?? '').slice(0, 10), source: `${type}/${file}` });
  }
  return docs;
}
export async function loadDocs(root = resolve('content')): Promise<Doc[]> {
  const docs = (await Promise.all(COLLECTIONS.map(type => collection(type, root)))).flat();
  const urls = new Set<string>();
  for (const doc of docs) {
    if (urls.has(doc.url)) throw new Error(`Duplicate canonical URL: ${doc.url}`);
    urls.add(doc.url);
  }
  return docs;
}
export async function listCollection(type: CollectionType): Promise<Doc[]> {
  if (!COLLECTIONS.includes(type)) return [];
  return collection(type, resolve('content'));
}
export async function readDoc(type: CollectionType, slug: string): Promise<Doc | null> {
  if (!COLLECTIONS.includes(type)) return null;
  const docs = await listCollection(type);
  return docs.find(doc => doc.slug === slug) ?? null;
}
export function docToChunks(doc: Doc): CorpusChunk[] {
  const words = [...doc.body.matchAll(/\S+/g)];
  if (!words.length) return [];
  const chunks: CorpusChunk[] = [];
  for (let offset = 0; offset < words.length; offset += 450) {
    const end = Math.min(offset + 500, words.length);
    const text = doc.body.slice(words[offset].index, end === words.length ? undefined : words[end].index).trim();
    const chunk = chunks.length;
    chunks.push({ id: `${doc.type}:${doc.slug}#${chunk}`, text, metadata: {
      type: doc.type, slug: doc.slug, url: doc.url, title: doc.fm.title ?? doc.slug,
      date: doc.date, chunk, description: doc.fm.description, source: doc.source, text,
    } });
    if (end === words.length) break;
  }
  return chunks;
}
export async function readNowFile(): Promise<{ raw: string; body: string; fm: Frontmatter } | null> {
  try {
    const raw = await readFile(resolve('content/now.md'), 'utf-8');
    return { raw, ...parseFrontmatter(raw) };
  } catch { return null; }
}
