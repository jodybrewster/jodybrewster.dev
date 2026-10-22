/**
 * Media normalization for the /library shelf.
 *
 * Everything here is pure and framework-free: Astro calls it at build time to
 * serialize the shelf payload, and the Three.js scene consumes the same output
 * at runtime. Bad rows are dropped individually and nothing ever throws, so one
 * malformed record can never take the shelf down.
 */

export type MediaKind = 'album' | 'book' | 'game' | 'tool' | 'film' | 'podcast' | 'place';

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

/** Software Jody works in, kept by hand in content/tools.json. */
export interface ShelfTool extends ShelfItemBase {
  kind: 'tool';
  title: string;
  /** Who makes it. */
  maker?: string;
  /** One line of Jody's on how he uses it, shown on the card. */
  note?: string;
  /** The tool's official page. */
  url?: string;
}

/** A film or a series, kept by hand in content/films.json. */
export interface ShelfFilm extends ShelfItemBase {
  kind: 'film';
  title: string;
  /** As written, e.g. `1985` or `1984-1989`. */
  year?: string;
  note?: string;
  url?: string;
  cover?: string;
  /** A placeholder standing in until Jody's own list lands. */
  sample?: boolean;
}

/** A show Jody listens to, kept in content/podcasts.json. */
export interface ShelfPodcast extends ShelfItemBase {
  kind: 'podcast';
  title: string;
  host?: string;
  note?: string;
  url?: string;
  cover?: string;
  sample?: boolean;
}

/** Somewhere Jody went, printed as a postcard. Kept in content/places.json. */
export interface ShelfPlace extends ShelfItemBase {
  kind: 'place';
  title: string;
  /** City and region for the postmark, e.g. `Miami Beach, FL`. */
  location?: string;
  year?: string;
  /** What he would write on the back. */
  note?: string;
  /** His own photograph for the front, site-absolute. */
  cover?: string;
  url?: string;
}

export type ShelfItem = ShelfAlbum | ShelfBook | ShelfGame | ShelfTool | ShelfFilm | ShelfPodcast | ShelfPlace;

/** An item's own picture, for the kinds that have one. */
export function coverOf(item: ShelfItem): string | undefined {
  return 'cover' in item ? item.cover : undefined;
}

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

export function normalizeTools(rows: readonly unknown[]): ShelfTool[] {
  if (!Array.isArray(rows)) return [];
  const taken = new Set<string>();
  const tools: ShelfTool[] = [];

  for (const row of rows) {
    const raw = record(row);
    if (!raw) continue;
    const title = text(raw.title);
    if (!title) continue;

    const slug = slugify(title);
    if (!slug) continue;

    tools.push({
      id: uniqueId(`tool-${slug}`, taken),
      kind: 'tool',
      index: tools.length,
      title,
      maker: text(raw.maker) || undefined,
      note: tidy(raw.note, NOTE_MAX) || undefined,
      url: externalUrl(raw.url),
      color: fallbackColor(`tool|${title}`),
    });
  }

  return tools;
}

/** A year or a span of years, as written. Anything else is dropped. */
function years(value: unknown): string | undefined {
  const raw = text(typeof value === 'number' ? String(value) : value);
  return /^\d{4}(\s*-\s*(\d{4})?)?$/.test(raw) ? raw.replace(/\s+/g, '') : undefined;
}

export function normalizeFilms(rows: readonly unknown[]): ShelfFilm[] {
  if (!Array.isArray(rows)) return [];
  const taken = new Set<string>();
  const films: ShelfFilm[] = [];
  for (const row of rows) {
    const raw = record(row);
    const title = text(raw?.title);
    const slug = slugify(title);
    if (!raw || !slug) continue;
    films.push({
      id: uniqueId(`film-${slug}`, taken),
      kind: 'film',
      index: films.length,
      title,
      year: years(raw.year),
      note: tidy(raw.note, NOTE_MAX) || undefined,
      url: externalUrl(raw.url),
      cover: localAsset(raw.cover),
      sample: raw.sample === true || undefined,
      color: fallbackColor(`film|${title}`),
    });
  }
  return films;
}

export function normalizePodcasts(rows: readonly unknown[]): ShelfPodcast[] {
  if (!Array.isArray(rows)) return [];
  const taken = new Set<string>();
  const podcasts: ShelfPodcast[] = [];
  for (const row of rows) {
    const raw = record(row);
    const title = text(raw?.title);
    const slug = slugify(title);
    if (!raw || !slug) continue;
    podcasts.push({
      id: uniqueId(`podcast-${slug}`, taken),
      kind: 'podcast',
      index: podcasts.length,
      title,
      host: text(raw.host) || undefined,
      note: tidy(raw.note, NOTE_MAX) || undefined,
      url: externalUrl(raw.url),
      cover: localAsset(raw.cover),
      sample: raw.sample === true || undefined,
      color: fallbackColor(`podcast|${title}`),
    });
  }
  return podcasts;
}

export function normalizePlaces(rows: readonly unknown[]): ShelfPlace[] {
  if (!Array.isArray(rows)) return [];
  const taken = new Set<string>();
  const places: ShelfPlace[] = [];
  for (const row of rows) {
    const raw = record(row);
    const title = text(raw?.title);
    const slug = slugify(title);
    if (!raw || !slug) continue;
    // A photograph has to be on this origin: it is drawn into a canvas that
    // becomes a texture, and a remote image would taint it.
    const cover = text(raw.photo ?? raw.cover);
    places.push({
      id: uniqueId(`place-${slug}`, taken),
      kind: 'place',
      index: places.length,
      title,
      location: text(raw.location) || undefined,
      year: years(raw.year),
      note: tidy(raw.note, NOTE_MAX) || undefined,
      cover: cover.startsWith('/') && !cover.startsWith('//') ? cover : undefined,
      url: externalUrl(raw.url),
      color: fallbackColor(`place|${title}`),
    });
  }
  return places;
}
