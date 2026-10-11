import { describe, expect, it } from 'vitest';
import { ARC, arcPose, arrange, isFilter, layoutTrack, pageOf, pagerWindow, paginate } from './arc';
import { normalizeAlbums, normalizeBooks, normalizeFolios, normalizeGames } from './media';

const books = normalizeBooks([
  { title: 'Book One', author: 'A' },
  { title: 'Book Two', author: 'B' },
  { title: 'Book Three', author: 'C' },
]);
const albums = normalizeAlbums([{ name: 'Album One', artist: 'X' }]);
const games = normalizeGames([{ title: 'Game One', platform: 'Nintendo Switch' }]);
const cases = normalizeFolios('case', [
  { title: 'Case One', url: '/work/one' },
  { title: 'Case Two', url: '/work/two' },
]);
const items = [...books, ...albums, ...games, ...cases];

describe('arrange', () => {
  it('deals one of each kind in turn for All, work first', () => {
    expect(arrange(items, 'all').map(item => item.title)).toEqual([
      'Case One',
      'Book One',
      'Album One',
      'Game One',
      'Case Two',
      'Book Two',
      'Book Three',
    ]);
  });

  it('keeps every item exactly once', () => {
    const dealt = arrange(items, 'all');
    expect(dealt).toHaveLength(items.length);
    expect(new Set(dealt.map(item => item.id)).size).toBe(items.length);
  });

  it('keeps curated order within a single kind', () => {
    expect(arrange(items, 'book').map(item => item.title)).toEqual(['Book One', 'Book Two', 'Book Three']);
    expect(arrange(items, 'note')).toEqual([]);
  });
});

describe('isFilter', () => {
  it('accepts the sidebar filters only', () => {
    expect(isFilter('all')).toBe(true);
    expect(isFilter('case')).toBe(true);
    expect(isFilter('podcast')).toBe(false);
    expect(isFilter(undefined)).toBe(false);
  });
});

describe('layoutTrack', () => {
  it('spaces items edge to edge with the gap between', () => {
    expect(layoutTrack([2, 1, 3], 0.5)).toEqual({ centres: [1, 3, 5.5], length: 7 });
    expect(layoutTrack([], 0.5)).toEqual({ centres: [], length: 0 });
  });
});

describe('paginate', () => {
  it('fills each page up to the lane and centres it', () => {
    const pages = paginate([2, 2, 2, 2, 2], 1, 8);
    expect(pages.map(page => [page.start, page.end])).toEqual([[0, 3], [3, 5]]);
    // Three items of 2 with gaps of 1 span 8: centres at -3, 0 and 3.
    expect(pages[0].centres).toEqual([-3, 0, 3]);
    expect(pages[1].centres).toEqual([-1.5, 1.5]);
  });

  it('gives an item wider than the lane a page of its own', () => {
    expect(paginate([10, 1], 0.5, 4).map(page => [page.start, page.end])).toEqual([[0, 1], [1, 2]]);
  });

  it('has no pages for nothing', () => {
    expect(paginate([], 1, 8)).toEqual([]);
  });
});

describe('pageOf', () => {
  it('finds the page holding an index', () => {
    const pages = paginate([2, 2, 2, 2, 2], 1, 8);
    expect(pageOf(pages, 0)).toBe(0);
    expect(pageOf(pages, 4)).toBe(1);
    expect(pageOf(pages, 99)).toBe(0);
  });
});

describe('pagerWindow', () => {
  it('shows every page when there are few', () => {
    expect(pagerWindow(0, 4)).toEqual([0, 1, 2, 3]);
  });

  it('keeps the ends and the neighbours, eliding the rest', () => {
    expect(pagerWindow(9, 19)).toEqual([0, null, 8, 9, 10, null, 18]);
    expect(pagerWindow(0, 19)).toEqual([0, 1, null, 18]);
  });

  it('shows a single skipped page instead of an ellipsis', () => {
    expect(pagerWindow(3, 19)).toEqual([0, 1, 2, 3, 4, null, 18]);
  });
});

describe('arcPose', () => {
  it('sits lowest, furthest back and square at the centre', () => {
    expect(arcPose(0, 6)).toEqual({ y: 0, z: 0, yaw: -0 });
  });

  it('rises, comes forward and turns in symmetrically at the ends', () => {
    const left = arcPose(-6, 6);
    const right = arcPose(6, 6);
    expect(left.y).toBeCloseTo(ARC.sag);
    expect(left.z).toBeCloseTo(ARC.depth);
    expect(left.y).toBeCloseTo(right.y);
    expect(left.yaw).toBeCloseTo(-right.yaw);
    // The left end turns its face right, toward the middle.
    expect(left.yaw).toBeGreaterThan(0);
  });

  it('holds its pose well off screen', () => {
    expect(arcPose(600, 6)).toEqual(arcPose(6 * ARC.reach, 6));
  });
});
