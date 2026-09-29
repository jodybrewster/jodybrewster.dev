/**
 * Links inside Verso's answers.
 *
 * Verso writes a page it mentions as a Markdown link, `[Lennar maps](/work/lennar-interactive-maps)`.
 * The model can misremember a slug, so a link is only ever drawn for a path
 * the site really has: the route checks every path in the finished answer
 * against the card index and sends back the ones that exist, and the dock
 * links those and shows the rest as plain words. Nothing here trusts the
 * model with an href.
 *
 * Browser-safe and pure, so the route, the dock and the tests share it.
 */

/** A Markdown link to a path on this site. External links are not drawn at all. */
const LINK = /\[([^\]\n]{1,160})\]\((\/[^\s)]{0,200})\)/g;

/** Section pages that are not documents, so the card index does not list them. */
const SECTION_PATHS = ['/home', '/about', '/work', '/writing', '/notes', '/research', '/portfolio', '/now', '/library'];

const normalize = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path);

/** Every path a link in an answer may point to. */
export function sitePaths(pages: Record<string, unknown>): Set<string> {
  return new Set([...Object.keys(pages), ...SECTION_PATHS].map(normalize));
}

/** The paths an answer links to that exist on the site, each once. */
export function linkedPaths(text: string, paths: Set<string>): string[] {
  const found = new Set<string>();
  for (const [, , path] of text.matchAll(LINK)) {
    const clean = normalize(path);
    if (paths.has(clean)) found.add(clean);
  }
  return [...found];
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * An answer as HTML: paragraphs, italics and links. `allowed` is the list the
 * route confirmed; until it arrives (while the answer streams) links show as
 * their words alone, so no half-written Markdown flashes on screen and no
 * unchecked href is ever drawn.
 */
export function renderAnswer(text: string, allowed: ReadonlySet<string> | null = null): string {
  return text.split(/\n{2,}/).filter(Boolean).map(paragraph => {
    let html = '';
    let last = 0;
    for (const match of paragraph.matchAll(LINK)) {
      const [whole, label, path] = match;
      html += inline(paragraph.slice(last, match.index));
      const clean = normalize(path);
      html += allowed?.has(clean) ? `<a href="${escape(clean)}">${inline(label)}</a>` : inline(label);
      last = match.index! + whole.length;
    }
    html += inline(paragraph.slice(last));
    return `<p>${html}</p>`;
  }).join('');
}

/** Escaped text with *italics* and line breaks. Backticks around a path are dropped: Verso is not writing code. */
function inline(text: string): string {
  return escape(text).replace(/`([^`\n]+)`/g, '$1').replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/\n/g, '<br>');
}
