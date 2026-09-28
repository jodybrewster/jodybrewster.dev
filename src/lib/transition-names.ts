// A card's image and the lead image on the page it opens share a view-transition name, so the image travels
// between them on navigation. Deriving the name from the page's path keeps both ends in agreement.
export function mediaTransitionName(path: string): string {
  return `media${path.replace(/\/+$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
}
