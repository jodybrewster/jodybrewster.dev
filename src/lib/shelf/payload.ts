/**
 * Builds the shelf's data payload at build time.
 *
 * Shared by the /library page, which renders the semantic shelf from it, and by
 * the static /library-data.json endpoint, which lets the scene be warmed from
 * anywhere on the site without loading the shelf first.
 *
 * Server side only: reads the content directory.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { monthLabel, normalizeAlbums, normalizeBooks, normalizeGames, slugify } from './media';
import type { ShelfAlbum, ShelfBook, ShelfGame } from './media';

export interface ShelfPayloadData {
  albums: ShelfAlbum[];
  books: ShelfBook[];
  games: ShelfGame[];
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

  const month = monthLabel(listeningData.updated as string | undefined);
  const gamesMonth = monthLabel(gamesData.updated as string | undefined);

  return {
    albums,
    books,
    games,
    listeningLabel: month ? `LISTENING · ${month.toUpperCase()}` : 'LISTENING',
    libraryLabel: `LIBRARY · ${books.length} BOOKS`,
    gamesLabel: gamesMonth ? `PLAYING · ${gamesMonth.toUpperCase()}` : 'PLAYING',
  };
}
