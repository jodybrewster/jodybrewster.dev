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
import {
  normalizeAlbums,
  normalizeBooks,
  normalizeFilms,
  normalizeGames,
  normalizePlaces,
  normalizePodcasts,
  normalizeTools,
} from './media';
import type { ShelfAlbum, ShelfBook, ShelfFilm, ShelfGame, ShelfPlace, ShelfPodcast, ShelfTool } from './media';

export interface ShelfPayloadData {
  albums: ShelfAlbum[];
  books: ShelfBook[];
  games: ShelfGame[];
  tools: ShelfTool[];
  films: ShelfFilm[];
  podcasts: ShelfPodcast[];
  places: ShelfPlace[];
  musicLabel: string;
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
  const musicData = await readJson('content/music.json');
  const gamesData = await readJson('content/games.json');
  const toolsData = await readJson('content/tools.json');
  const filmsData = await readJson('content/films.json');
  const podcastsData = await readJson('content/podcasts.json');
  const placesData = await readJson('content/places.json');

  const books = normalizeBooks((libraryData.books as unknown[]) ?? []);

  // Box art and album art are only ever local. A cover path whose file never
  // got cached is dropped here, so the scene draws a case of its own instead
  // of a 404.
  const cachedOnly = (rows: unknown) =>
    (Array.isArray(rows) ? rows : []).map(row => {
      const cover = (row as { cover?: unknown } | null)?.cover;
      const cached = typeof cover === 'string' && cover.startsWith('/') && existsSync(resolve(`public${cover}`));
      return cached ? row : { ...(row as object), cover: undefined };
    });
  const albums = normalizeAlbums(cachedOnly(musicData.albums));
  const games = normalizeGames(cachedOnly(gamesData.games));

  const list = (value: unknown) => (Array.isArray(value) ? value : []);
  const tools = normalizeTools(list(toolsData.tools));
  const films = normalizeFilms(list(filmsData.films));
  const podcasts = normalizePodcasts(list(podcastsData.podcasts));
  const places = normalizePlaces(list(placesData.places));

  return {
    albums,
    books,
    games,
    tools,
    films,
    podcasts,
    places,
    // Favourite bands kept by hand, one album each, not a month's listening.
    musicLabel: `MUSIC · ${albums.length}`,
    libraryLabel: `LIBRARY · ${books.length} BOOKS`,
    // The games are favourites kept by hand, not a month's play, so no date.
    gamesLabel: `GAMES · ${games.length}`,
  };
}
