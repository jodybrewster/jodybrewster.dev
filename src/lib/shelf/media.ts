/**
 * Media normalization for the /library shelf.
 *
 * Everything here is pure and framework-free: Astro calls it at build time to
 * serialize the shelf payload, and the Three.js scene consumes the same output
 * at runtime. Bad rows are dropped individually and nothing ever throws, so one
 * malformed record can never take the shelf down.
 */

export type MediaKind = 'album' | 'book' | 'notebook';

interface ShelfItemBase {
  id: string;
  kind: MediaKind;
  /** Position within its own collection, in curated order. */
  index: number;
  /** Deterministic cloth color, used when no cover image resolves. */
  color: string;
}

export interface ShelfBook extends ShelfItemBase {
  kind: 'book';
  title: string;
  author: string;
  edition?: string;
  /** External catalog page. */
  url?: string;
  /** Locally cached cover, site-absolute. */
  cover?: string;
}

export interface ShelfAlbum extends ShelfItemBase {
  kind: 'album';
  title: string;
  artist: string;
  url?: string;
  cover?: string;
}

export interface ShelfNotebook extends ShelfItemBase {
  kind: 'notebook';
  title: string;
  /** Internal route on this site. */
  href: string;
  section: string;
  date?: string;
  excerpt: string;
}

export type ShelfItem = ShelfAlbum | ShelfBook | ShelfNotebook;

/** Muted book-cloth tones. Saturated enough to read as bound cloth, quiet
 *  enough to sit beside ash paper and the one forest green. */
const CLOTH_PALETTE = [
  '#7d3b32',
  '#2d4a3e',
  '#3a4a63',
  '#8a6a33',
  '#4a3b52',
  '#9c5540',
  '#5c6b5d',
  '#2f3a44',
  '#8d7350',
  '#6b2f3f',
  '#3f5a5c',
  '#736451',
] as const;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const EXCERPT_MAX = 600;

/** FNV-1a. Small, fast, and stable across runs and platforms. */
export function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic 0..1 from a seed string. Used for shelf jitter so the same
 *  book always sits at the same angle on every visit and every device. */
export function seededUnit(seed: string): number {
  return hash(seed) / 0xffffffff;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2018\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function fallbackColor(seed: string): string {
  return CLOTH_PALETTE[hash(seed) % CLOTH_PALETTE.length];
}

/** `2026-07-28` -> `July 2026`. Parsed by parts so it cannot drift a month
 *  when the browser sits behind UTC. */
export function monthLabel(iso: string | undefined | null): string {
  if (typeof iso !== 'string') return '';
  const match = /^(\d{4})-(\d{2})/.exec(iso.trim());
  if (!match) return '';
  const month = Number(match[2]);
  if (month < 1 || month > 12) return '';
  return `${MONTHS[month - 1]} ${match[1]}`;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Only ordinary web links survive. Keeps `javascript:` and friends out of the
 *  href we hand to the overlay. */
function externalUrl(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  return /^https?:\/\//i.test(raw) ? raw : undefined;
}

function internalHref(value: unknown): string | undefined {
  const raw = text(value);
  return raw.startsWith('/') ? raw : undefined;
}

function localAsset(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  if (raw.startsWith('/')) return raw;
  return /^https?:\/\//i.test(raw) ? raw : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Appends `-2`, `-3`, ... only when a base id genuinely repeats, so curated
 *  ids stay readable and stable for every non-colliding record. */
function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  const id = `${base}-${n}`;
  taken.add(id);
  return id;
}

function tidy(value: unknown, max: number): string {
  const collapsed = text(value).replace(/\s+/g, ' ');
  if (collapsed.length <= max) return collapsed;
  const cut = collapsed.slice(0, max);
  const boundary = cut.lastIndexOf(' ');
  return (boundary > max * 0.6 ? cut.slice(0, boundary) : cut).trimEnd();
}

export function normalizeBooks(rows: readonly unknown[]): ShelfBook[] {
  if (!Array.isArray(rows)) return [];
  const taken = new Set<string>();
  const books: ShelfBook[] = [];

  for (const row of rows) {
    const raw = record(row);
    if (!raw) continue;
    const title = text(raw.title);
    const author = text(raw.author);
    if (!title || !author) continue;

    const edition = text(raw.edition) || undefined;
    const slug = slugify(title);
    if (!slug) continue;
    const base = edition ? `book-${slug}-${slugify(edition)}` : `book-${slug}`;

    books.push({
      id: uniqueId(base, taken),
      kind: 'book',
      index: books.length,
      title,
      author,
      edition,
      url: externalUrl(raw.url),
      cover: localAsset(raw.cover ?? raw.image),
      color: fallbackColor(`${title}|${author}`),
    });
  }

  return books;
}

export function normalizeAlbums(rows: readonly unknown[]): ShelfAlbum[] {
  if (!Array.isArray(rows)) return [];
  const taken = new Set<string>();
  const albums: ShelfAlbum[] = [];

  for (const row of rows) {
    const raw = record(row);
    if (!raw) continue;
    const title = text(raw.name ?? raw.title);
    const artist = text(raw.artist);
    if (!title || !artist) continue;

    const slug = slugify(`${artist}-${title}`);
    if (!slug) continue;

    albums.push({
      id: uniqueId(`album-${slug}`, taken),
      kind: 'album',
      index: albums.length,
      title,
      artist,
      url: externalUrl(raw.url),
      cover: localAsset(raw.cover ?? raw.image),
      color: fallbackColor(`${artist}|${title}`),
    });
  }

  return albums;
}

export function normalizeNotebooks(rows: readonly unknown[]): ShelfNotebook[] {
  if (!Array.isArray(rows)) return [];
  const taken = new Set<string>();
  const notebooks: ShelfNotebook[] = [];

  for (const row of rows) {
    const raw = record(row);
    if (!raw) continue;
    const title = text(raw.title);
    const href = internalHref(raw.href);
    const section = text(raw.section);
    if (!title || !href || !section) continue;

    const slug = slugify(title);
    if (!slug) continue;

    notebooks.push({
      id: uniqueId(`notebook-${slugify(section)}-${slug}`, taken),
      kind: 'notebook',
      index: notebooks.length,
      title,
      href,
      section,
      date: text(raw.date) || undefined,
      excerpt: tidy(raw.excerpt, EXCERPT_MAX),
      color: fallbackColor(`${section}|${title}`),
    });
  }

  return notebooks;
}
