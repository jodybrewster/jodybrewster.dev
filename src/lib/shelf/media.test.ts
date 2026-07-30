import { describe, expect, it } from 'vitest';
import {
  fallbackColor,
  monthLabel,
  normalizeAlbums,
  normalizeBooks,
  normalizeNotebooks,
} from './media';

describe('normalizeBooks', () => {
  it('keeps valid editions distinct and drops malformed rows', () => {
    const books = normalizeBooks([
      { title: 'The Design of Everyday Things', author: 'Don Norman', edition: 'revised' },
      { title: 'The Design of Everyday Things', author: 'Donald A. Norman', edition: 'original' },
      { title: '', author: 'Nobody' },
    ]);
    expect(books.map(book => book.id)).toEqual([
      'book-the-design-of-everyday-things-revised',
      'book-the-design-of-everyday-things-original',
    ]);
  });

  it('preserves input order', () => {
    const books = normalizeBooks([
      { title: 'Deep Work', author: 'Cal Newport' },
      { title: 'Atomic Habits', author: 'James Clear' },
      { title: 'Grit', author: 'Angela Duckworth' },
    ]);
    expect(books.map(book => book.title)).toEqual(['Deep Work', 'Atomic Habits', 'Grit']);
    expect(books.map(book => book.index)).toEqual([0, 1, 2]);
  });

  it('drops rows missing an author and never throws on junk', () => {
    const books = normalizeBooks([
      { title: 'Real Book', author: 'Real Author' },
      { title: 'No Author', author: '   ' },
      null,
      undefined,
      'not an object',
      { author: 'Title missing' },
      42,
    ] as unknown[]);
    expect(books).toHaveLength(1);
    expect(books[0].title).toBe('Real Book');
  });

  it('disambiguates same-title rows that carry no edition', () => {
    const books = normalizeBooks([
      { title: 'Scrum', author: 'Jeff Sutherland' },
      { title: 'Scrum', author: 'Ken Schwaber' },
    ]);
    expect(new Set(books.map(book => book.id)).size).toBe(2);
  });

  it('builds URL-safe ids from punctuation-heavy titles', () => {
    const [book] = normalizeBooks([
      { title: "What Your Customer Wants and Can't Tell You", author: 'Melina Palmer' },
    ]);
    expect(book.id).toBe('book-what-your-customer-wants-and-cant-tell-you');
    expect(book.id).toBe(encodeURIComponent(book.id));
  });

  it('carries through catalog url and cached cover when present', () => {
    const [book] = normalizeBooks([
      {
        title: 'Deep Work',
        author: 'Cal Newport',
        url: 'https://openlibrary.org/isbn/9781455586691',
        cover: '/media/books/book-deep-work.jpg',
      },
    ]);
    expect(book.url).toBe('https://openlibrary.org/isbn/9781455586691');
    expect(book.cover).toBe('/media/books/book-deep-work.jpg');
  });

  it('ignores a non-http url rather than emitting it', () => {
    const [book] = normalizeBooks([
      { title: 'Deep Work', author: 'Cal Newport', url: 'javascript:alert(1)' },
    ]);
    expect(book.url).toBeUndefined();
  });
});

describe('normalizeAlbums', () => {
  it('maps the spotify cache shape and drops malformed rows', () => {
    const albums = normalizeAlbums([
      {
        name: 'Bloom',
        artist: 'Beach House',
        url: 'https://open.spotify.com/album/6w84G1JaQPqbf8RzS48tPf',
        image: 'https://i.scdn.co/image/abc',
      },
      { name: '', artist: 'Nobody' },
    ]);
    expect(albums).toHaveLength(1);
    expect(albums[0].id).toBe('album-beach-house-bloom');
    expect(albums[0].title).toBe('Bloom');
    expect(albums[0].artist).toBe('Beach House');
  });

  it('keeps two albums of the same name by different artists distinct', () => {
    const albums = normalizeAlbums([
      { name: 'Nevermind', artist: 'Nirvana' },
      { name: 'Nevermind', artist: 'Someone Else' },
    ]);
    expect(new Set(albums.map(album => album.id)).size).toBe(2);
  });
});

describe('normalizeNotebooks', () => {
  it('requires a title and an internal href', () => {
    const notebooks = normalizeNotebooks([
      { title: 'On evaluation', href: '/writing/on-evaluation', section: 'writing', excerpt: 'Some text.' },
      { title: 'Broken', href: '', section: 'writing' },
      { title: 'External', href: 'https://example.com', section: 'writing' },
    ]);
    expect(notebooks.map(entry => entry.id)).toEqual(['notebook-writing-on-evaluation']);
  });

  it('collapses whitespace in the excerpt and truncates on a word boundary', () => {
    const [notebook] = normalizeNotebooks([
      {
        title: 'Long one',
        href: '/notes/long-one',
        section: 'notes',
        excerpt: `  ${'alpha '.repeat(200)}  `,
      },
    ]);
    expect(notebook.excerpt.length).toBeLessThanOrEqual(600);
    expect(notebook.excerpt).not.toMatch(/\s{2}/);
    expect(notebook.excerpt.endsWith(' ')).toBe(false);
  });
});

describe('monthLabel', () => {
  it('formats the snapshot month', () => {
    expect(monthLabel('2026-07-28')).toBe('July 2026');
  });

  it('does not drift across timezones on the first of the month', () => {
    expect(monthLabel('2026-01-01')).toBe('January 2026');
    expect(monthLabel('2026-12-01')).toBe('December 2026');
  });

  it('returns an empty label for unusable input', () => {
    expect(monthLabel('')).toBe('');
    expect(monthLabel('not-a-date')).toBe('');
    expect(monthLabel(undefined)).toBe('');
  });
});

describe('fallbackColor', () => {
  it('chooses deterministic fallback colors', () => {
    expect(fallbackColor('Atomic Habits')).toBe(fallbackColor('Atomic Habits'));
  });

  it('returns a hex color from the cloth palette', () => {
    expect(fallbackColor('Deep Work')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('spreads a realistic library across more than one color', () => {
    const titles = ['Deep Work', 'Grit', 'Mindset', 'Scrum', 'Hooked', 'Antifragile', 'Noise', 'Range'];
    expect(new Set(titles.map(fallbackColor)).size).toBeGreaterThan(1);
  });
});
