/**
 * Idempotent cover + catalog sync for the /library shelf.
 *
 * Books: resolves each curated title against Open Library, stores the work URL
 * in content/library.json, and caches the jacket under public/media/books/.
 * Albums: caches the Spotify art referenced by content/listening.json under
 * public/media/albums/ so the scene never depends on a cross-origin texture.
 *
 * Curated order is never changed. Records that already have a URL and a cover
 * file on disk are skipped, so re-running costs nothing. Pass --force to
 * re-resolve everything, or --books / --albums to run one half.
 *
 *   npx tsx scripts/sync-book-covers.ts
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const UA = 'jodybrewster.dev library sync (https://jodybrewster.dev)';
const SEARCH = 'https://openlibrary.org/search.json';
const COVERS = 'https://covers.openlibrary.org/b/id';
const SEARCH_GAP_MS = 250;

const LIBRARY_PATH = resolve('content/library.json');
const LISTENING_PATH = resolve('content/listening.json');
const BOOK_DIR = resolve('public/media/books');
const ALBUM_DIR = resolve('public/media/albums');

const args = new Set(process.argv.slice(2));
const force = args.has('--force');
const runBooks = !args.has('--albums') || args.has('--books');
const runAlbums = !args.has('--books') || args.has('--albums');

interface BookRecord {
  title: string;
  author: string;
  edition?: string;
  url?: string;
  cover?: string;
  [key: string]: unknown;
}

interface OpenLibraryEdition {
  key?: string;
  title?: string;
  language?: string[];
  cover_i?: number;
}

interface OpenLibraryDoc {
  key?: string;
  title?: string;
  author_name?: string[];
  cover_i?: number;
  first_publish_year?: number;
  /** Best-matching editions for the query, when requested. */
  editions?: { docs?: OpenLibraryEdition[] };
}

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2018\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Mirrors normalizeBooks() in src/lib/shelf/media.ts. Both must agree or the
 *  cached filename will not line up with the id the scene asks for. */
function bookId(book: BookRecord): string {
  const slug = slugify(book.title);
  return book.edition ? `book-${slug}-${slugify(book.edition)}` : `book-${slug}`;
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Drops edition parentheticals, which Open Library does not carry and which
 *  reduce an otherwise good query to zero hits. */
function cleanTitle(value: string): string {
  return value.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The part before a colon. Open Library often files a book under its main
 *  title with the subtitle dropped, or vice versa. */
function shortTitle(value: string): string {
  return cleanTitle(value).split(':')[0].trim();
}

/** Last names only. Open Library disagrees with Audible constantly on first
 *  names, initials, and credited co-authors, but surnames line up. */
function surnames(author: string): string[] {
  return author
    .split(/,| and | & /i)
    .map(part => part.trim().split(/\s+/).filter(Boolean).pop() ?? '')
    .map(name => name.toLowerCase().replace(/[^a-z]/g, ''))
    .filter(name => name.length > 2);
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function search(query: string): Promise<OpenLibraryDoc[]> {
  const url = new URL(SEARCH);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '8');
  url.searchParams.set('editions.limit', '4');
  url.searchParams.set(
    'fields',
    'key,title,author_name,cover_i,first_publish_year,'
      + 'editions,editions.key,editions.title,editions.language,editions.cover_i',
  );
  const payload = (await fetchJson(url.toString())) as { docs?: OpenLibraryDoc[] };
  return Array.isArray(payload?.docs) ? payload.docs : [];
}

/**
 * Rejects the summaries, study guides, and foreign reprints that dominate
 * Open Library results for popular business titles. A doc has to look like the
 * real book on both title and author before we accept it.
 */
function scoreDoc(doc: OpenLibraryDoc, book: BookRecord): number {
  const gotTitle = normalizeTitle(doc.title ?? '');
  if (!gotTitle) return -1;

  const junk = /\b(summary|summaries|workbook|study guide|analysis|key takeaways|conversation starters)\b/;
  if (junk.test(gotTitle) && !junk.test(normalizeTitle(book.title))) return -1;

  // The author gate is the one hard requirement. Title wording drifts between
  // Audible and Open Library far more than authorship does.
  const wantedAuthors = surnames(book.author);
  const gotAuthors = (doc.author_name ?? []).join(' ').toLowerCase();
  if (wantedAuthors.length && !wantedAuthors.some(name => gotAuthors.includes(name))) return -1;

  const editionTitles = (doc.editions?.docs ?? []).map(edition => normalizeTitle(edition.title ?? ''));
  const gotTitles = [gotTitle, ...editionTitles].filter(Boolean);
  const candidates = [normalizeTitle(cleanTitle(book.title)), normalizeTitle(shortTitle(book.title))];
  let titleScore = 0;
  for (const wanted of candidates) {
    if (!wanted) continue;
    for (const got of gotTitles) {
      if (got === wanted) titleScore = Math.max(titleScore, 6);
      else if (got.startsWith(wanted) || wanted.startsWith(got)) titleScore = Math.max(titleScore, 4);
      else if (got.includes(wanted) || wanted.includes(got)) titleScore = Math.max(titleScore, 2);
    }
  }

  // Retitled and translated works ("The Psychology of Everyday Things",
  // "L'ordine del tempo") share no words with the edition Jody owns. Accept
  // them on the author gate alone, but only as a last resort and only with art.
  if (titleScore === 0) {
    if (!doc.cover_i) return -1;
    titleScore = 1;
  }

  return titleScore + 3 + (pickCover(doc) ? 2 : 0);
}

async function resolveBook(book: BookRecord): Promise<OpenLibraryDoc | undefined> {
  const title = cleanTitle(book.title);
  const short = shortTitle(book.title);
  const lead = book.author.split(',')[0].trim();
  const queries = [
    `"${title}" ${book.author}`,
    `${title} ${lead}`,
    ...(short !== title ? [`${short} ${lead}`] : []),
  ];
  for (const query of queries) {
    let docs: OpenLibraryDoc[];
    try {
      docs = await search(query);
    } catch (error) {
      console.warn(`  search failed (${(error as Error).message})`);
      await sleep(SEARCH_GAP_MS * 4);
      continue;
    }
    const ranked = docs
      .map(doc => ({ doc, score: scoreDoc(doc, book) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    if (ranked.length) return ranked[0].doc;
    await sleep(SEARCH_GAP_MS);
  }
  return undefined;
}

/**
 * A work's default cover is whichever edition Open Library happens to feature,
 * which is often a foreign-language reprint. The edition that actually matched
 * the query is a far better jacket, so prefer an English one when offered.
 */
function pickCover(doc: OpenLibraryDoc): number | undefined {
  const editions = doc.editions?.docs ?? [];
  const english = editions.find(
    edition => edition.cover_i && (edition.language ?? []).includes('eng'),
  );
  if (english?.cover_i) return english.cover_i;
  const anyEdition = editions.find(edition => edition.cover_i);
  return anyEdition?.cover_i ?? doc.cover_i;
}

async function download(url: string, destination: string): Promise<boolean> {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!response.ok) return false;
    const type = response.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return false;
    const bytes = Buffer.from(await response.arrayBuffer());
    // Open Library answers "no cover" with a ~1KB placeholder rather than a 404.
    if (bytes.byteLength < 2048) return false;
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    return true;
  } catch {
    return false;
  }
}

async function syncBooks(): Promise<void> {
  const raw = JSON.parse(await readFile(LIBRARY_PATH, 'utf-8')) as { books: BookRecord[] };
  const books = raw.books;
  console.log(`Books: ${books.length} curated records`);

  let resolved = 0;
  let cached = 0;
  let skipped = 0;
  const unresolved: string[] = [];

  for (const [i, book] of books.entries()) {
    const id = bookId(book);
    const coverPath = `/media/books/${id}.jpg`;
    const coverFile = resolve(`public${coverPath}`);
    const settled = Boolean(book.url) && existsSync(coverFile);

    if (settled && !force) {
      skipped += 1;
      book.cover = coverPath;
      continue;
    }

    const doc = await resolveBook(book);
    if (!doc) {
      unresolved.push(book.title);
      console.log(`  [${i + 1}/${books.length}] no match: ${book.title}`);
      await sleep(SEARCH_GAP_MS);
      continue;
    }

    if (doc.key) book.url = `https://openlibrary.org${doc.key}`;
    resolved += 1;

    const coverId = pickCover(doc);
    if (coverId && (force || !existsSync(coverFile))) {
      if (await download(`${COVERS}/${coverId}-L.jpg`, coverFile)) cached += 1;
    }
    if (existsSync(coverFile)) book.cover = coverPath;
    else delete book.cover;

    console.log(`  [${i + 1}/${books.length}] ${book.title} -> ${doc.key ?? 'no key'}`);
    await sleep(SEARCH_GAP_MS);
  }

  await writeFile(LIBRARY_PATH, `${JSON.stringify(raw, null, 2)}\n`, 'utf-8');
  console.log(`Books done: ${resolved} resolved, ${cached} covers cached, ${skipped} already current.`);
  if (unresolved.length) {
    console.log(`Unresolved (${unresolved.length}), these fall back to cloth spines:`);
    for (const title of unresolved) console.log(`  - ${title}`);
  }
}

async function syncAlbums(): Promise<void> {
  if (!existsSync(LISTENING_PATH)) {
    console.log('Albums: no content/listening.json, skipping.');
    return;
  }
  const listening = JSON.parse(await readFile(LISTENING_PATH, 'utf-8')) as {
    albums?: { name?: string; artist?: string; image?: string }[];
  };
  const albums = listening.albums ?? [];
  console.log(`Albums: ${albums.length} in the current snapshot`);

  let cached = 0;
  let skipped = 0;
  let failed = 0;

  for (const album of albums) {
    if (!album?.name || !album?.artist || !album?.image) continue;
    const id = `album-${slugify(`${album.artist}-${album.name}`)}`;
    const file = resolve(`public/media/albums/${id}.jpg`);
    if (existsSync(file) && !force) {
      skipped += 1;
      continue;
    }
    if (await download(album.image, file)) cached += 1;
    else {
      failed += 1;
      console.log(`  cover failed: ${album.artist} - ${album.name}`);
    }
  }

  console.log(`Albums done: ${cached} cached, ${skipped} already current, ${failed} failed.`);
}

async function main(): Promise<void> {
  await mkdir(BOOK_DIR, { recursive: true });
  await mkdir(ALBUM_DIR, { recursive: true });
  if (runBooks) await syncBooks();
  if (runAlbums) await syncAlbums();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
