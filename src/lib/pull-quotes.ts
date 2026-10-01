// Pull quotes set in the margin beside an article's text, chosen by hand in content/pull-quotes.json.
// Each one must appear verbatim in the article, checked the same way Verso checks a quote before showing it, so the
// margin can repeat the piece but never misquote it. A quote that no longer matches is dropped, not shown.

import manifest from '../../content/pull-quotes.json';
import { plainText } from './cards';
import { verifyQuote } from './verso-tools';

const quotesBySlug: Record<string, string[]> = manifest;

/** The quotes that still appear in `markdown`, in the article's own wording. */
export function verifiedQuotes(quotes: string[], markdown: string): string[] {
  const text = plainText(markdown);
  return quotes.flatMap(quote => verifyQuote(text, quote) ?? []);
}

export function pullQuotes(slug: string, markdown: string): string[] {
  return Object.hasOwn(quotesBySlug, slug) ? verifiedQuotes(quotesBySlug[slug], markdown) : [];
}
