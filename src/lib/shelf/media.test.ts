import { describe, expect, it } from 'vitest';
import {
  fallbackColor,
  gameSystem,
  monthLabel,
  normalizeAlbums,
  normalizeBooks,
  normalizeGames,
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

describe('normalizeGames', () => {
  it('builds stable ids and drops rows missing a title or platform', () => {
    const games = normalizeGames([
      { title: 'Dead Cells', platform: 'Nintendo Switch' },
      { title: "The Legend of Zelda: Link's Awakening", platform: 'Nintendo Switch' },
      { title: 'No Platform', platform: '  ' },
      { platform: 'PlayStation 5' },
    ]);
    expect(games.map(game => game.id)).toEqual([
      'game-dead-cells',
      'game-the-legend-of-zelda-links-awakening',
    ]);
    expect(games.map(game => game.index)).toEqual([0, 1]);
  });

  it('never throws on junk rows', () => {
    const games = normalizeGames([
      null,
      undefined,
      'Fortnite',
      42,
      [],
      { title: 'Fortnite', platform: 'Nintendo Switch' },
    ] as unknown[]);
    expect(games).toHaveLength(1);
    expect(normalizeGames('nope' as unknown as unknown[])).toEqual([]);
  });

  it('keeps the same game on two platforms distinct', () => {
    const games = normalizeGames([
      { title: 'Fortnite', platform: 'Nintendo Switch' },
      { title: 'Fortnite', platform: 'PlayStation 5' },
    ]);
    expect(new Set(games.map(game => game.id)).size).toBe(2);
  });

  it('carries through the note, official page and cached cover', () => {
    const [game] = normalizeGames([
      {
        title: 'Ghost of Yotei',
        platform: 'PlayStation 5',
        note: '  Slow   on purpose. ',
        url: 'https://www.playstation.com/en-us/games/ghost-of-yotei/',
        cover: '/media/games/game-ghost-of-yotei.jpg',
      },
    ]);
    expect(game.system).toBe('ps5');
    expect(game.note).toBe('Slow on purpose.');
    expect(game.url).toBe('https://www.playstation.com/en-us/games/ghost-of-yotei/');
    expect(game.cover).toBe('/media/games/game-ghost-of-yotei.jpg');
  });

  it('refuses a non-http link and a relative cover path', () => {
    const [game] = normalizeGames([
      { title: 'Overwatch', platform: 'Nintendo Switch', url: 'javascript:alert(1)', cover: 'media/x.jpg' },
    ]);
    expect(game.url).toBeUndefined();
    expect(game.cover).toBeUndefined();
    expect(game.note).toBeUndefined();
  });
});

describe('gameSystem', () => {
  it('reads the case from the platform name', () => {
    expect(gameSystem('Nintendo Switch')).toBe('switch');
    expect(gameSystem('Switch 2')).toBe('switch');
    expect(gameSystem('PlayStation 5')).toBe('ps5');
    expect(gameSystem('PS5')).toBe('ps5');
    expect(gameSystem('Steam Deck')).toBe('other');
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
