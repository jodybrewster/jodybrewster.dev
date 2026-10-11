/**
 * Where things float in the /library scene.
 *
 * A page of items floats on a shallow smile that curves past the camera: its
 * ends come forward and turn in toward the middle, so the row reads as a
 * gallery you stand inside rather than a strip laid across the screen. The
 * pager turns from one page to the next. The maths is kept here, pure, so the
 * scene only has to ask where an item belongs.
 */

import type { MediaKind, ShelfItem } from './media';

export type LibraryFilter = 'all' | MediaKind;

export const FILTERS: ReadonlyArray<{ id: LibraryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'book', label: 'Books' },
  { id: 'game', label: 'Games' },
  { id: 'album', label: 'Music' },
  { id: 'article', label: 'Articles' },
  { id: 'note', label: 'Notes' },
  { id: 'case', label: 'Case Studies' },
];

export function isFilter(value: unknown): value is LibraryFilter {
  return FILTERS.some(filter => filter.id === value);
}

/**
 * The order "All" deals the kinds in. Work and writing lead because they say
 * the most about how Jody works; the reading pile, the largest by far, runs
 * on alone once the others are dealt out.
 */
const DEAL_ORDER: readonly MediaKind[] = ['case', 'article', 'book', 'album', 'game', 'note'];

/**
 * The items a filter shows, in ribbon order. A single kind keeps its own
 * curated order. "All" deals one of each kind in turn, so the opening screen
 * holds a bit of everything instead of the first twenty books.
 */
export function arrange(items: readonly ShelfItem[], filter: LibraryFilter): ShelfItem[] {
  if (filter !== 'all') return items.filter(item => item.kind === filter);

  const queues = DEAL_ORDER.map(kind => items.filter(item => item.kind === kind));
  const dealt: ShelfItem[] = [];
  for (let round = 0; dealt.length < items.length; round += 1) {
    let took = false;
    for (const queue of queues) {
      const item = queue[round];
      if (item) {
        dealt.push(item);
        took = true;
      }
    }
    // Only kinds outside DEAL_ORDER could be left, and there are none; this
    // keeps a future kind from hanging the loop instead of being dropped.
    if (!took) break;
  }
  return dealt;
}

/** Centres along the ribbon for items of the given widths, `gap` apart. */
export function layoutTrack(widths: readonly number[], gap: number): { centres: number[]; length: number } {
  const centres: number[] = [];
  let at = 0;
  widths.forEach((width, index) => {
    if (index > 0) at += gap;
    centres.push(at + width / 2);
    at += width;
  });
  return { centres, length: at };
}

export interface Page {
  /** Index of the page's first item in the arranged order. */
  start: number;
  /** One past its last item. */
  end: number;
  /** Each item's centre, measured from the middle of the lane. */
  centres: number[];
}

/**
 * Splits items of the given widths into pages that each fit `laneWidth`, with
 * every page centred in the lane. A page always takes at least one item, so
 * something wider than the lane still gets a page of its own.
 */
export function paginate(widths: readonly number[], gap: number, laneWidth: number): Page[] {
  const pages: Page[] = [];
  let start = 0;
  while (start < widths.length) {
    let end = start + 1;
    let used = widths[start];
    while (end < widths.length && used + gap + widths[end] <= laneWidth) {
      used += gap + widths[end];
      end += 1;
    }
    const { centres, length } = layoutTrack(widths.slice(start, end), gap);
    pages.push({ start, end, centres: centres.map(centre => centre - length / 2) });
    start = end;
  }
  return pages;
}

/** The page holding the item at `index`, or 0 when there is none. */
export function pageOf(pages: readonly Page[], index: number): number {
  const found = pages.findIndex(page => index >= page.start && index < page.end);
  return found === -1 ? 0 : found;
}

/**
 * The page numbers a pager shows: always the first and last, the current one
 * and its neighbours, and `null` for each run that is left out.
 */
export function pagerWindow(current: number, count: number): Array<number | null> {
  const keep = new Set([0, count - 1, current - 1, current, current + 1].filter(n => n >= 0 && n < count));
  // A gap of one page is shown as that page; an ellipsis would take the same room.
  for (const n of [...keep]) {
    if (keep.has(n + 2) && !keep.has(n + 1)) keep.add(n + 1);
  }
  const sorted = [...keep].sort((a, b) => a - b);
  const out: Array<number | null> = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push(null);
    out.push(n);
  });
  return out;
}

export const ARC = {
  /** Rise at the lane's ends, in world units: the smile. */
  sag: 0.8,
  /** How far the ends come toward the camera. */
  depth: 1.9,
  /** Radians the ends turn in toward the middle. */
  turn: 0.42,
  /** Past this many half-widths off centre, nothing changes: an item flying in
   *  from well off screen holds its pose instead of climbing out of the frame. */
  reach: 1.6,
} as const;

export interface ArcPose {
  y: number;
  z: number;
  /** Rotation about the vertical axis, positive turning the face to the right. */
  yaw: number;
}

/** The pose for an item `x` world units from the middle of a lane `halfWidth` wide. */
export function arcPose(x: number, halfWidth: number): ArcPose {
  const n = halfWidth > 0 ? Math.max(-ARC.reach, Math.min(ARC.reach, x / halfWidth)) : 0;
  return { y: ARC.sag * n * n, z: ARC.depth * n * n, yaw: -ARC.turn * n };
}
