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
  monthLabel,
  normalizeAlbums,
  normalizeBooks,
  normalizeFilms,
  normalizeGames,
  normalizePlaces,
  normalizePodcasts,
  normalizeTools,
  slugify,
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
  const toolsData = await readJson('content/tools.json');
  const filmsData = await readJson('content/films.json');
  const podcastsData = await readJson('content/podcasts.json');
  const placesData = await readJson('content/places.json');

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

  const list = (value: unknown) => (Array.isArray(value) ? value : []);
  const tools = normalizeTools(list(toolsData.tools));
  const films = normalizeFilms(list(filmsData.films));
  const podcasts = normalizePodcasts(list(podcastsData.podcasts));
  const places = normalizePlaces(list(placesData.places));

  const month = monthLabel(listeningData.updated as string | undefined);

  return {
    albums,
    books,
    games,
    tools,
    films,
    podcasts,
    places,
    listeningLabel: month ? `LISTENING · ${month.toUpperCase()}` : 'LISTENING',
    libraryLabel: `LIBRARY · ${books.length} BOOKS`,
    // The games are favourites kept by hand, not a month's play, so no date.
    gamesLabel: `GAMES · ${games.length}`,
  };
}
