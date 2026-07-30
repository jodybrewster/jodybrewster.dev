/**
 * Fetch top listening data from Spotify and cache it to content/listening.json.
 *
 * Runs automatically before `astro build` (prebuild) and by hand via
 * `npm run spotify`. If credentials are missing or Spotify is unreachable,
 * the existing cache is left untouched and the build continues.
 *
 * Spotify has no top-albums endpoint, so albums are derived from the top 50
 * tracks of the same period: grouped by album, ranked by how many top tracks
 * they contain, tie-broken by best track rank. The short_term window is
 * Spotify's rolling last ~4 weeks.
 */
import 'dotenv/config';
import { writeFile } from 'node:fs/promises';

const OUT = 'content/listening.json';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const LIMIT = 25;

interface SpotifyImage {
  url: string;
  width: number;
}

interface SpotifyArtist {
  name: string;
  external_urls: { spotify: string };
}

interface SpotifyAlbum {
  id: string;
  name: string;
  artists: SpotifyArtist[];
  images: SpotifyImage[];
  external_urls: { spotify: string };
}

const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;

if (!clientId || !clientSecret || !refreshToken) {
  console.log('[spotify] credentials not set; keeping existing listening cache');
  process.exit(0);
}

async function accessToken(): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken! }),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function get<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

/** Smallest image at least 100px wide; covers render at ~44px in a 2x list. */
function coverImage(images: SpotifyImage[]): string {
  const fit = images.filter(i => i.width >= 100).sort((a, b) => a.width - b.width)[0];
  return (fit ?? images[0])?.url ?? '';
}

try {
  const token = await accessToken();
  const [topArtists, topTracks] = await Promise.all([
    get<{ items: SpotifyArtist[] }>(`/me/top/artists?time_range=short_term&limit=${LIMIT}`, token),
    get<{ items: Array<{ album: SpotifyAlbum }> }>('/me/top/tracks?time_range=short_term&limit=50', token),
  ]);

  const artists = topArtists.items.map(a => ({ name: a.name, url: a.external_urls.spotify }));

  const byAlbum = new Map<string, { album: SpotifyAlbum; count: number; bestRank: number }>();
  topTracks.items.forEach((track, rank) => {
    const entry = byAlbum.get(track.album.id);
    if (entry) {
      entry.count += 1;
    } else {
      byAlbum.set(track.album.id, { album: track.album, count: 1, bestRank: rank });
    }
  });

  const albums = [...byAlbum.values()]
    .sort((a, b) => b.count - a.count || a.bestRank - b.bestRank)
    .slice(0, LIMIT)
    .map(({ album }) => ({
      name: album.name,
      artist: album.artists[0]?.name ?? '',
      url: album.external_urls.spotify,
      image: coverImage(album.images),
    }));

  const updated = new Date().toISOString().slice(0, 10);
  await writeFile(OUT, JSON.stringify({ updated, artists, albums }, null, 2) + '\n');
  console.log(`[spotify] wrote ${OUT}: ${artists.length} artists, ${albums.length} albums`);
} catch (err) {
  console.warn(`[spotify] sync failed; keeping existing listening cache: ${err}`);
}
