/**
 * Idempotent Spotify link and cover cache for the /library music.
 *
 * content/music.json is kept by hand: one album per band, by `artist` and
 * `title`. This looks each one up on Spotify, writes the album page back as
 * `url`, downloads the art once into public/media/albums/ and writes the cached
 * path back as `cover`. The cached files are committed like the book jackets,
 * so nothing here runs in the build.
 *
 * Records with a url and a cover on disk are skipped. When the search picks the
 * wrong release, paste the right album page into `url` and remove `cover`: a
 * record with a url is fetched by that id rather than searched. Pass --force to
 * fetch everything again.
 *
 * Needs SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET (an app token is enough for
 * search; no user consent).
 *
 *   npm run music
 */
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DATA_PATH = resolve('content/music.json');
const MEDIA_DIR = resolve('public/media/albums');
const API = 'https://api.spotify.com/v1';

const force = process.argv.includes('--force');

interface MusicRecord {
  artist: string;
  title: string;
  url?: string;
  cover?: string;
  [key: string]: unknown;
}

interface SpotifyAlbum {
  id: string;
  name: string;
  album_type: string;
  release_date: string;
  total_tracks: number;
  artists: { name: string }[];
  images: { url: string; width: number }[];
  external_urls: { spotify: string };
}

const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env first.');
  process.exit(1);
}

/** Mirrors slugify() in src/lib/shelf/media.ts. Both must agree or the cached
 *  filename will not line up with the id the scene asks for. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2018\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Loose form for matching: no accents, punctuation or leading "the". */
function loose(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

/** Drops the "(Remastered)" and " - 2011 Remaster" tails Spotify adds. */
function bareTitle(value: string): string {
  return loose(value.replace(/\s*[([].*$/, '').replace(/\s+-\s+.*$/, ''));
}

async function appToken(): Promise<string> {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  if (!response.ok) throw new Error(`token request failed: ${response.status}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function get<T>(path: string, token: string): Promise<T | null> {
  const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return response.ok ? ((await response.json()) as T) : null;
}

function albumId(url: string | undefined): string | null {
  return url?.match(/open\.spotify\.com\/album\/([A-Za-z0-9]+)/)?.[1] ?? null;
}

/**
 * The band's own studio album: an album before a single or a compilation, then
 * the exact title before one under a remaster tail, then the fewest tracks, so
 * the original beats the deluxe edition.
 */
async function findAlbum(record: MusicRecord, token: string): Promise<SpotifyAlbum | null> {
  const pinned = albumId(record.url);
  if (pinned) return get<SpotifyAlbum>(`/albums/${pinned}`, token);

  const q = new URLSearchParams({
    q: `album:${record.title} artist:${record.artist}`,
    type: 'album',
    limit: '10',
  });
  const found = await get<{ albums: { items: (SpotifyAlbum | null)[] } }>(`/search?${q}`, token);
  const artist = loose(record.artist);
  const candidates = (found?.albums.items ?? []).filter(
    (album): album is SpotifyAlbum => !!album && album.artists.some(a => loose(a.name) === artist),
  );
  const title = loose(record.title);
  const kind = (album: SpotifyAlbum) => (album.album_type === 'album' ? 1 : 0);
  const named = (album: SpotifyAlbum) =>
    loose(album.name) === title ? 2 : bareTitle(album.name) === bareTitle(record.title) ? 1 : 0;
  return (
    candidates.sort((a, b) => kind(b) - kind(a) || named(b) - named(a) || a.total_tracks - b.total_tracks)[0] ??
    null
  );
}

async function main(): Promise<void> {
  await mkdir(MEDIA_DIR, { recursive: true });
  const raw = JSON.parse(await readFile(DATA_PATH, 'utf-8')) as { albums?: MusicRecord[] };
  const records = raw.albums ?? [];
  console.log(`Music: ${records.length} records`);

  const token = await appToken();
  let cached = 0;
  let skipped = 0;
  const failed: string[] = [];

  for (const record of records) {
    if (!record?.artist || !record?.title) continue;
    const id = `album-${slugify(`${record.artist}-${record.title}`)}`;
    const cover = `/media/albums/${id}.jpg`;
    if (record.url && record.cover === cover && existsSync(resolve(`public${cover}`)) && !force) {
      skipped += 1;
      continue;
    }

    const album = await findAlbum(record, token).catch(() => null);
    if (!album) {
      failed.push(`${record.artist} - ${record.title} (not found on Spotify)`);
      continue;
    }
    record.url = album.external_urls.spotify;

    const image = [...album.images].sort((a, b) => b.width - a.width)[0];
    const response = image ? await fetch(image.url).catch(() => null) : null;
    if (!response?.ok) {
      failed.push(`${record.artist} - ${record.title} (cover download failed)`);
      continue;
    }
    await writeFile(resolve(`public${cover}`), Buffer.from(await response.arrayBuffer()));
    record.cover = cover;
    cached += 1;
    console.log(`  ${record.artist} - ${record.title} <- "${album.name}" (${album.release_date.slice(0, 4)})`);
  }

  await writeFile(DATA_PATH, `${JSON.stringify(raw, null, 2)}\n`, 'utf-8');
  console.log(`Music done: ${cached} cached, ${skipped} already current.`);
  if (failed.length) {
    console.log(`Without a match (${failed.length}), these fall back to a drawn case:`);
    for (const line of failed) console.log(`  - ${line}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
