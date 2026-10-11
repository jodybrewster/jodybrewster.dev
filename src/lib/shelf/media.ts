/**
 * Media normalization for the /library scene.
 *
 * Everything here is pure and framework-free: Astro calls it at build time to
 * serialize the payload, and the Three.js scene consumes the same output at
 * runtime. Bad rows are dropped individually and nothing ever throws, so one
 * malformed record can never take the scene down.
 */

/** The site's own pieces, printed as folios: writing, lab notes, case studies. */
export type FolioKind = 'article' | 'note' | 'case';

export type MediaKind = 'album' | 'book' | 'game' | FolioKind;

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

/** The case a game ships in, which sets its size, plastic, and banner. */
export type GameSystem = 'switch' | 'ps5' | 'other';

export interface ShelfGame extends ShelfItemBase {
  kind: 'game';
  title: string;
  /** As written in content/games.json, e.g. `Nintendo Switch`. */
  platform: string;
  system: GameSystem;
  /** One line of Jody's own, shown on the card. */
  note?: string;
  /** The game's official page. */
  url?: string;
  cover?: string;
}

export interface ShelfFolio extends ShelfItemBase {
  kind: FolioKind;
  title: string;
  /** What sort of piece it is, as the site names it: Essay, Research, Seedling, Case study. */
  label: string;
  summary?: string;
  /** Site path of the piece itself. */
  url: string;
  /** Lead image, site-absolute. */
  cover?: string;
  /** `YYYY-MM-DD`, when the piece is dated. */
  date?: string;
}

export type ShelfItem = ShelfAlbum | ShelfBook | ShelfGame | ShelfFolio;

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

const NOTE_MAX = 280;

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

function localAsset(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  if (raw.startsWith('/')) return raw;
  return /^https?:\/\//i.test(raw) ? raw : undefined;
}

/** A path on this site. Protocol-relative `//host` would leave it. */
function sitePath(value: unknown): string | undefined {
  const raw = text(value);
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : undefined;
}

function isoDay(value: unknown): string | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text(value));
  return match?.[1];
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

/** Reads the platform name for the kind of case to draw. Anything unknown
 *  still gets a case, just a plain one. */
export function gameSystem(platform: string): GameSystem {
  if (/switch/i.test(platform)) return 'switch';
  if (/\bps5\b|playstation\s*5/i.test(platform)) return 'ps5';
  return 'other';
}

export function normalizeGames(rows: readonly unknown[]): ShelfGame[] {
  if (!Array.isArray(rows)) return [];
  const taken = new Set<string>();
  const games: ShelfGame[] = [];

  for (const row of rows) {
    const raw = record(row);
    if (!raw) continue;
    const title = text(raw.title);
    const platform = text(raw.platform);
    if (!title || !platform) continue;

    const slug = slugify(title);
    if (!slug) continue;

    games.push({
      id: uniqueId(`game-${slug}`, taken),
      kind: 'game',
      index: games.length,
      title,
      platform,
      system: gameSystem(platform),
      note: tidy(raw.note, NOTE_MAX) || undefined,
      url: externalUrl(raw.url),
      cover: localAsset(raw.cover),
      color: fallbackColor(`${platform}|${title}`),
    });
  }

  return games;
}

/**
 * The site's own pieces. Rows come from the content collections, already
 * validated by their schemas, but they get the same treatment as the media:
 * anything without a title or a path on this site is dropped.
 */
export function normalizeFolios(kind: FolioKind, rows: readonly unknown[]): ShelfFolio[] {
  if (!Array.isArray(rows)) return [];
  const taken = new Set<string>();
  const folios: ShelfFolio[] = [];

  for (const row of rows) {
    const raw = record(row);
    if (!raw) continue;
    const title = tidy(raw.title, 160);
    const url = sitePath(raw.url);
    if (!title || !url) continue;

    const slug = slugify(url.split('/').filter(Boolean).pop() ?? title);
    if (!slug) continue;

    folios.push({
      id: uniqueId(`${kind}-${slug}`, taken),
      kind,
      index: folios.length,
      title,
      label: text(raw.label) || 'Piece',
      summary: tidy(raw.summary, NOTE_MAX) || undefined,
      url,
      cover: sitePath(raw.cover),
      date: isoDay(raw.date),
      color: fallbackColor(`${kind}|${title}`),
    });
  }

  return folios;
}

/**
 * The opening of a Markdown body as plain prose, for a piece with no
 * description of its own. Drops headings and code, keeps link and wiki-link
 * text, and stops at the first paragraph break past a sentence or two.
 */
export function plainExcerpt(markdown: unknown, max = NOTE_MAX): string {
  const body = text(markdown)
    .replace(/^---[\s\S]*?\n---\n?/, '')
    .replace(/```[\s\S]*?```/g, ' ');
  const paragraphs = body
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim())
    .filter(paragraph => paragraph && !/^(#|>|\||!\[|<)/.test(paragraph));
  const prose = (paragraphs[0] ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '');
  return tidy(prose, max);
}
