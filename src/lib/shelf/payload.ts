/**
 * Builds the library's data payload at build time.
 *
 * Shared by the /library page, which renders the semantic list from it, and by
 * the static /library-data.json endpoint, which lets the scene be warmed from
 * anywhere on the site without loading the page first.
 *
 * Server side only: reads the content directory and the content collections.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getCollection } from 'astro:content';
import { articleImage } from '../article-images';
import { workProjects } from '../work-projects';
import {
  monthLabel,
  normalizeAlbums,
  normalizeBooks,
  normalizeFolios,
  normalizeGames,
  plainExcerpt,
  slugify,
} from './media';
import type { ShelfAlbum, ShelfBook, ShelfFolio, ShelfGame } from './media';

export interface ShelfPayloadData {
  albums: ShelfAlbum[];
  books: ShelfBook[];
  games: ShelfGame[];
  articles: ShelfFolio[];
  notes: ShelfFolio[];
  cases: ShelfFolio[];
  listeningLabel: string;
  libraryLabel: string;
  gamesLabel: string;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(resolve(path), 'utf-8'));
  } catch {
    return {};
  }
}

export async function buildShelfPayload(): Promise<ShelfPayloadData> {
  const libraryData = await readJson('content/library.json');
  const listeningData = await readJson('content/listening.json');
  const gamesData = await readJson('content/games.json');

  const books = normalizeBooks((libraryData.books as unknown[]) ?? []);

  // Prefer the locally cached art so the scene never reaches across origins for
  // a texture. Falls back to the Spotify CDN URL when the cache is cold.
  const rawAlbums = ((listeningData.albums as Record<string, unknown>[]) ?? []).map(album => {
    const id = `album-${slugify(`${album.artist ?? ''}-${album.name ?? ''}`)}`;
    const cached = `/media/albums/${id}.jpg`;
    return { ...album, cover: existsSync(resolve(`public${cached}`)) ? cached : album.image };
  });
  const albums = normalizeAlbums(rawAlbums);

  // Box art is only ever local. A cover path whose file never got cached is
  // dropped here, so the scene draws a case of its own instead of a 404.
  const rawGames = (Array.isArray(gamesData.games) ? gamesData.games : []).map(game => {
    const cover = (game as { cover?: unknown } | null)?.cover;
    const cached = typeof cover === 'string' && cover.startsWith('/') && existsSync(resolve(`public${cover}`));
    return cached ? game : { ...(game as object), cover: undefined };
  });
  const games = normalizeGames(rawGames);

  const [essays, research, notes, projects] = await Promise.all([
    getCollection('writing', entry => entry.data.status === 'published'),
    getCollection('research', entry => entry.data.publish),
    getCollection('notes', entry => entry.data.publish),
    workProjects(),
  ]);

  // Newest first, essays and research together, the way /writing lists them.
  const articles = normalizeFolios('article', [
    ...essays.map(entry => ({
      title: entry.data.title,
      url: `/writing/${entry.id}`,
      label: 'Essay',
      summary: entry.data.description,
      cover: articleImage('writing', entry.id),
      date: entry.data.date,
    })),
    ...research.map(entry => ({
      title: entry.data.title,
      url: `/research/${entry.id}`,
      label: 'Research',
      summary: entry.data.description,
      cover: articleImage('research', entry.id),
      date: entry.data.pubDate,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime()));

  const labNotes = normalizeFolios('note', notes
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime())
    .map(entry => ({
      title: entry.data.title,
      url: `/notes/${entry.id}`,
      label: entry.data.status.charAt(0).toUpperCase() + entry.data.status.slice(1),
      summary: plainExcerpt(entry.body),
      date: entry.data.date,
    })));

  const cases = normalizeFolios('case', projects.map(project => ({
    title: project.title,
    url: project.href,
    label: project.type,
    summary: project.description,
    cover: project.image,
  })));

  const month = monthLabel(listeningData.updated as string | undefined);
  const gamesMonth = monthLabel(gamesData.updated as string | undefined);

  return {
    albums,
    books,
    games,
    articles,
    notes: labNotes,
    cases,
    listeningLabel: month ? `LISTENING · ${month.toUpperCase()}` : 'LISTENING',
    libraryLabel: `LIBRARY · ${books.length} BOOKS`,
    gamesLabel: gamesMonth ? `PLAYING · ${gamesMonth.toUpperCase()}` : 'PLAYING',
  };
}
