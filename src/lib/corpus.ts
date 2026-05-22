/**
 * Filesystem-backed access to the published corpus, used by MCP tool handlers
 * and the .md endpoints. RAG is handled separately by lib/rag.ts.
 */
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

export interface Frontmatter {
  title?: string;
  date?: string;
  description?: string;
  status?: string;
  publish?: boolean;
  sector?: string;
  role?: string;
  duration?: string;
  pillar?: string;
  tags?: string[];
}

export type CollectionType = 'writing' | 'notes' | 'work';

export interface Doc {
  type: CollectionType;
  slug: string;
  url: string;
  raw: string;
  body: string;
  fm: Frontmatter;
}

export function parseFrontmatter(raw: string): { fm: Frontmatter; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: raw };
  const fm: Frontmatter = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val: string | string[] | boolean = line.slice(idx + 1).trim();
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    else if (typeof val === 'string') {
      if (val.startsWith('[') && val.endsWith(']')) {
        val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      } else {
        val = val.replace(/^["']|["']$/g, '');
      }
    }
    (fm as Record<string, unknown>)[key] = val;
  }
  return { fm, body: m[2].trim() };
}

export async function readDoc(type: CollectionType, slug: string): Promise<Doc | null> {
  const safe = slug.replace(/[^a-z0-9-]/gi, '');
  if (!safe || safe !== slug) return null;
  try {
    const raw = await readFile(resolve(`content/${type}/${safe}.md`), 'utf-8');
    const { fm, body } = parseFrontmatter(raw);
    return { type, slug: safe, url: `/${type}/${safe}`, raw, body, fm };
  } catch {
    return null;
  }
}

export async function listCollection(type: CollectionType): Promise<Doc[]> {
  const dir = resolve(`content/${type}`);
  let files: string[];
  try {
    files = (await readdir(dir)).filter(f => f.endsWith('.md') || f.endsWith('.mdx'));
  } catch {
    return [];
  }
  const docs: Doc[] = [];
  for (const file of files) {
    const slug = basename(file).replace(/\.mdx?$/, '');
    const raw = await readFile(join(dir, file), 'utf-8');
    const { fm, body } = parseFrontmatter(raw);
    if (type === 'writing' && fm.status === 'draft') continue;
    if (type === 'notes' && fm.publish !== true) continue;
    docs.push({ type, slug, url: `/${type}/${slug}`, raw, body, fm });
  }
  return docs;
}

export async function readNowFile(): Promise<{ raw: string; body: string; fm: Frontmatter } | null> {
  try {
    const raw = await readFile(resolve('content/now.md'), 'utf-8');
    const { fm, body } = parseFrontmatter(raw);
    return { raw, body, fm };
  } catch {
    return null;
  }
}
