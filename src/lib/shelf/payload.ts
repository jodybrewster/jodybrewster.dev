/**
 * Builds the shelf's data payload at build time.
 *
 * Shared by the shelf at /, which renders the semantic shelf from it, and by
 * the static /library-data.json endpoint, which lets the scene be warmed from
 * anywhere on the site without loading the shelf first.
 *
 * Server side only: reads the content directory.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getCollection } from 'astro:content';
import {
  monthLabel,
  normalizeAlbums,
  normalizeBooks,
  normalizeNotebooks,
  slugify,
} from './media';
import type { ShelfAlbum, ShelfBook, ShelfNotebook } from './media';

export interface ShelfPayloadData {
  albums: ShelfAlbum[];
  books: ShelfBook[];
  notebooks: ShelfNotebook[];
  listeningLabel: string;
  libraryLabel: string;
  notebookLabel: string;
  /** The notebook standing in for the site itself. */
  siteNotebookId: string;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(resolve(path), 'utf-8'));
  } catch {
    return {};
  }
}

/** First real paragraph of an entry, with headings and frontmatter dropped. */
function excerptOf(body: string | undefined): string {
  return (body ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && !line.startsWith('---') && !line.startsWith('!['))
    .slice(0, 3)
    .join(' ');
}

function dateLabel(value: Date | undefined): string | undefined {
  return value
    ? value.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : undefined;
}

export async function buildShelfPayload(): Promise<ShelfPayloadData> {
  const libraryData = await readJson('content/library.json');
  const listeningData = await readJson('content/listening.json');

  const books = normalizeBooks((libraryData.books as unknown[]) ?? []);

  // Prefer the locally cached art so the scene never reaches across origins for
  // a texture. Falls back to the Spotify CDN URL when the cache is cold.
  const rawAlbums = ((listeningData.albums as Record<string, unknown>[]) ?? []).map(album => {
    const id = `album-${slugify(`${album.artist ?? ''}-${album.name ?? ''}`)}`;
    const cached = `/media/albums/${id}.jpg`;
    return { ...album, cover: existsSync(resolve(`public${cached}`)) ? cached : album.image };
  });
  const albums = normalizeAlbums(rawAlbums);

  const writing = (await getCollection('writing', entry => entry.data.status === 'published'))
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
    .slice(0, 3)
    .map(entry => ({
      title: entry.data.title,
      href: `/writing/${entry.id}`,
      section: 'Writing',
      date: dateLabel(entry.data.date),
      excerpt: entry.data.description || excerptOf(entry.body),
    }));

  const research = (await getCollection('research', entry => entry.data.publish))
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
    .slice(0, 3)
    .map(entry => ({
      title: entry.data.title,
      href: `/research/${entry.id}`,
      section: 'Research',
      date: dateLabel(entry.data.pubDate),
      excerpt: entry.data.description || excerptOf(entry.body),
    }));

  const labNotes = (await getCollection('notes', entry => entry.data.publish))
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
    .slice(0, 3)
    .map(entry => ({
      title: entry.data.title,
      href: `/notes/${entry.id}`,
      section: 'Lab',
      date: dateLabel(entry.data.date),
      excerpt: excerptOf(entry.body),
    }));

  // The site itself sits on the shelf as a notebook. Opening it is the way home.
  const siteNotebook = {
    title: 'jodybrewster.dev',
    href: '/home',
    section: 'Site',
    excerpt: 'The rest of the site: writing, briefs, research, and lab notes.',
  };
  const notebooks = normalizeNotebooks([siteNotebook, ...writing, ...research, ...labNotes]);
  if (notebooks[0]) notebooks[0].color = '#2d5d4f';

  const month = monthLabel(listeningData.updated as string | undefined);

  return {
    albums,
    books,
    notebooks,
    listeningLabel: month ? `LISTENING · ${month.toUpperCase()}` : 'LISTENING',
    libraryLabel: `LIBRARY · ${books.length} BOOKS`,
    notebookLabel: `NOTEBOOKS · ${notebooks.length} ENTRIES`,
    siteNotebookId: notebooks[0]?.id ?? '',
  };
}
