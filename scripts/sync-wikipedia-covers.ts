/**
 * Idempotent cover cache for the /library games and films.
 *
 * content/games.json and content/films.json are kept by hand. Each record
 * names the image its cover comes from as a Wikipedia file page
 * (`coverSource`), which is where a game's box art and a film's poster live.
 * This resolves that page through the MediaWiki API, downloads the file once
 * into public/media/<collection>/, and writes the cached path back as `cover`.
 * The cached files are committed like the book jackets, so nothing here runs
 * in the build.
 *
 * Records whose cover is already on disk are skipped. Pass --force to fetch
 * everything again.
 *
 *   npx tsx scripts/sync-wikipedia-covers.ts games
 *   npx tsx scripts/sync-wikipedia-covers.ts films
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const UA = 'jodybrewster.dev library sync (https://jodybrewster.dev)';
/** Covers are drawn onto a case face well under this, so more is only weight. */
const MAX_EDGE = 600;

const COLLECTIONS = {
  games: { label: 'Games', prefix: 'game' },
  films: { label: 'Films', prefix: 'film' },
} as const;
type CollectionName = keyof typeof COLLECTIONS;

const requested = process.argv.slice(2).find(arg => !arg.startsWith('--'));
if (!requested || !(requested in COLLECTIONS)) {
  console.error(`Name a collection: ${Object.keys(COLLECTIONS).join(' or ')}.`);
  process.exit(1);
}
const name = requested as CollectionName;
const collection = COLLECTIONS[name];
const DATA_PATH = resolve(`content/${name}.json`);
const MEDIA_DIR = resolve(`public/media/${name}`);

const force = process.argv.includes('--force');

interface CoverRecord {
  title: string;
  coverSource?: string;
  cover?: string;
  [key: string]: unknown;
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Series infoboxes often carry an SVG logo rather than a poster. The API
 *  renders those as PNG thumbnails, so the cache never holds an SVG. */
const RENDERED = new Set(['image/svg+xml']);

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['‘’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `https://pt.wikipedia.org/wiki/Ficheiro:X.png` -> the API host and title.
 *  The namespace prefix is localized, and the API accepts it as written. */
function parseSource(source: string): { api: string; title: string } | null {
  try {
    const url = new URL(source);
    if (!/\.wikipedia\.org$/.test(url.hostname) || !url.pathname.startsWith('/wiki/')) return null;
    return {
      api: `https://${url.hostname}/w/api.php`,
      title: decodeURIComponent(url.pathname.slice('/wiki/'.length)).replace(/_/g, ' '),
    };
  } catch {
    return null;
  }
}

async function resolveFile(source: string): Promise<{ url: string; mime: string } | null> {
  const parsed = parseSource(source);
  if (!parsed) return null;
  const query = new URL(parsed.api);
  query.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    prop: 'imageinfo',
    iiprop: 'url|mime',
    iiurlwidth: String(MAX_EDGE),
    titles: parsed.title,
  }).toString();
  const response = await fetch(query, { headers: { 'User-Agent': UA } });
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    query?: { pages?: Record<string, { imageinfo?: { url?: string; mime?: string; thumburl?: string }[] }> };
  };
  const page = Object.values(payload.query?.pages ?? {})[0];
  const info = page?.imageinfo?.[0];
  if (info?.mime && RENDERED.has(info.mime) && info.thumburl) return { url: info.thumburl, mime: 'image/png' };
  return info?.url && info.mime ? { url: info.url, mime: info.mime } : null;
}

/**
 * Re-encodes to a capped JPEG with macOS `sips` when it is there. Wikipedia's
 * cover files are PNGs as often as not, at several times the weight of the same
 * picture as a JPEG. Elsewhere the original is kept as it came.
 */
function compress(file: string): string {
  const jpeg = file.replace(/\.[a-z]+$/, '.jpg');
  try {
    // Only ever down: sips will happily upscale a small file to the cap.
    const sizes = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], {
      encoding: 'utf-8',
    });
    const longest = Math.max(...[...sizes.matchAll(/pixel(?:Width|Height): (\d+)/g)].map(m => Number(m[1])));
    execFileSync('sips', [
      ...(longest > MAX_EDGE ? ['--resampleHeightWidthMax', String(MAX_EDGE)] : []),
      '-s', 'format', 'jpeg',
      '-s', 'formatOptions', '84',
      file,
      '--out', jpeg,
    ], { stdio: 'ignore' });
    return jpeg;
  } catch {
    return file;
  }
}

function cachedCover(id: string): string | undefined {
  for (const ext of new Set(Object.values(EXTENSIONS))) {
    const path = `/media/${name}/${id}.${ext}`;
    if (existsSync(resolve(`public${path}`))) return path;
  }
  return undefined;
}

async function main(): Promise<void> {
  await mkdir(MEDIA_DIR, { recursive: true });
  const raw = JSON.parse(await readFile(DATA_PATH, 'utf-8')) as Record<string, CoverRecord[] | undefined>;
  const records = raw[name] ?? [];
  console.log(`${collection.label}: ${records.length} records`);

  let cached = 0;
  let skipped = 0;
  const failed: string[] = [];

  for (const record of records) {
    if (!record?.title) continue;
    const id = `${collection.prefix}-${slugify(record.title)}`;
    const existing = cachedCover(id);
    if (existing && !force) {
      record.cover = existing;
      skipped += 1;
      continue;
    }
    if (!record.coverSource) {
      failed.push(`${record.title} (no coverSource)`);
      continue;
    }

    const file = await resolveFile(record.coverSource).catch(() => null);
    const ext = file ? EXTENSIONS[file.mime] : undefined;
    if (!file || !ext) {
      failed.push(`${record.title} (could not resolve ${record.coverSource})`);
      continue;
    }

    const response = await fetch(file.url, { headers: { 'User-Agent': UA } }).catch(() => null);
    if (!response?.ok) {
      failed.push(`${record.title} (download failed)`);
      continue;
    }

    const downloaded = resolve(MEDIA_DIR, `${id}.${ext}`);
    await writeFile(downloaded, Buffer.from(await response.arrayBuffer()));
    const kept = compress(downloaded);
    if (kept !== downloaded) await rm(downloaded, { force: true });

    record.cover = `/media/${name}/${kept.split('/').pop()}`;
    cached += 1;
    console.log(`  ${record.title} <- ${file.url.split('?')[0]}`);
  }

  await writeFile(DATA_PATH, `${JSON.stringify(raw, null, 2)}\n`, 'utf-8');
  console.log(`${collection.label} done: ${cached} cached, ${skipped} already current.`);
  if (failed.length) {
    console.log(`Without a cover (${failed.length}), these fall back to a drawn one:`);
    for (const line of failed) console.log(`  - ${line}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
