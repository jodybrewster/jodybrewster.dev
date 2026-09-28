/**
 * Verso's cards: the tools the model can call to show a piece of the site
 * inline, and the resolver that turns a call into something safe to render.
 *
 * Pure and browser-safe on purpose. The text route resolves calls on the
 * server; the voice session resolves the same calls in the browser against
 * /verso-cards.json. Either way the model only ever names a thing - every
 * title, url and quote on a card comes from the index, never from the model.
 */

import { WORK_PARTS, type WorkPart } from './verso-parts';

export { WORK_PARTS, type WorkPart };

export type Card =
  | { kind: 'work'; slug: string; title: string; url: string; sector: string; role: string; duration: string; summary?: string }
  | { kind: 'article'; collection: 'writing' | 'research'; slug: string; title: string; url: string; description: string; date: string; image: string }
  | { kind: 'note'; slug: string; title: string; url: string; status: 'seedling' | 'budding' | 'evergreen'; date: string }
  | { kind: 'now'; title: string; url: '/now'; excerpt: string; updated?: string }
  | { kind: 'page'; url: string; title: string; description?: string; quote?: string }
  /** A building block of a case study, rendered in the chat from the same
   *  component the case study page uses (see VersoPartTemplates.astro). */
  | { kind: 'part'; slug: string; part: WorkPart; title: string; url: string }
  | { kind: 'screens'; slug: string; title: string; url: string }
  /** Take the visitor to a page. Only when they ask to go somewhere. */
  | { kind: 'navigate'; url: string; title: string };


/**
 * Everything a card can show, keyed the way the tools address it. Plain JSON,
 * so it can be served as a static file and read by the browser.
 *
 * - `work`: case studies by slug.
 * - `articles`: writing and research, keyed `writing:<slug>` / `research:<slug>`.
 * - `notes`: lab notes by slug.
 * - `now`: the Now page, or null when there is none.
 * - `pages`: every published page by site-relative url, with its plain text.
 *   `open_page` checks a quote against `text` before it is shown.
 * - `parts`: what the chat can render inline, keyed `work:<slug>` (with the
 *   case study parts that exist) and `screens:<slug>` (a portfolio gallery).
 */
export interface CardIndex {
  work: Record<string, Card>;
  articles: Record<string, Card>;
  notes: Record<string, Card>;
  now: Card | null;
  pages: Record<string, { title: string; description?: string; text: string }>;
  parts: Record<string, { title: string; url: string; parts: string[] }>;
}

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, { type: 'string'; description: string; enum?: readonly string[] }>; required?: string[] };
}

const ONLY_KNOWN = 'Only use a value that appeared in the provided excerpts or search results; never guess one.';
const SPARINGLY = 'Call it only when that item is the heart of the answer, and show at most two cards per answer.';
const PARTS = [
  'visual: the product screen or preview the case study leads with',
  'facts: the at-a-glance panel (role, sector, timeline, scale, outcome)',
  'summary: the challenge and the solution',
  'architecture: how the system fits together, end to end',
].join('; ');

/** Provider-neutral: the route maps these to Gemini's `parametersJsonSchema`. */
export const VERSO_TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: 'show_case_study',
    description: `Render one part of a case study right here in the conversation, built from the same component as the case study page. This is the main way to show Jody's work: when a visitor asks about a project, show the part that answers them instead of linking away. Call it once per part, up to three parts per answer, in the order they should appear. Parts: ${PARTS}.`,
    parameters: { type: 'object', properties: {
      slug: { type: 'string', description: `The case study slug, from a work source. ${ONLY_KNOWN}` },
      part: { type: 'string', enum: WORK_PARTS, description: 'Which part to show.' },
    }, required: ['slug', 'part'] },
  },
  {
    name: 'show_screens',
    description: 'Render a gallery of real product screens from a portfolio project in the conversation. Use it when a visitor wants to see what something looks like.',
    parameters: { type: 'object', properties: {
      slug: { type: 'string', description: `The portfolio or case study slug. ${ONLY_KNOWN}` },
    }, required: ['slug'] },
  },
  {
    name: 'go_to_page',
    description: 'Take the visitor to a page on the site. Only when they explicitly ask to go somewhere, open or read a page; otherwise show things in the conversation.',
    parameters: { type: 'object', properties: {
      url: { type: 'string', description: `The site-relative url, such as /work/some-slug. ${ONLY_KNOWN}` },
    }, required: ['url'] },
  },
  {
    name: 'show_work',
    description: `Show a compact link card for one of Jody's case studies, for when a visitor wants the full write-up. Prefer show_case_study. ${SPARINGLY}`,
    parameters: { type: 'object', properties: {
      slug: { type: 'string', description: `The case study slug, from a work source. ${ONLY_KNOWN}` },
    }, required: ['slug'] },
  },
  {
    name: 'show_writing',
    description: `Show a card for one of Jody's essays or research pieces. ${SPARINGLY}`,
    parameters: { type: 'object', properties: {
      slug: { type: 'string', description: `The slug of a writing or research source. ${ONLY_KNOWN}` },
    }, required: ['slug'] },
  },
  {
    name: 'show_note',
    description: `Show a card for one of Jody's lab notes. ${SPARINGLY}`,
    parameters: { type: 'object', properties: {
      slug: { type: 'string', description: `The slug of a notes source. ${ONLY_KNOWN}` },
    }, required: ['slug'] },
  },
  {
    name: 'show_now',
    description: `Show a card for Jody's Now page: what he is working on and paying attention to at the moment. ${SPARINGLY}`,
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'open_page',
    description: `Show a link card for a page on Jody's site, optionally with a short passage quoted from it. The quote must be copied word for word from that page's excerpt; anything else is dropped. ${SPARINGLY}`,
    parameters: { type: 'object', properties: {
      url: { type: 'string', description: `The site-relative url of the page, such as /work/some-slug. ${ONLY_KNOWN}` },
      quote: { type: 'string', description: 'Optional. One or two sentences copied exactly from the page.' },
    }, required: ['url'] },
  },
];

const SITE_ORIGINS = ['https://jodybrewster.dev', 'https://www.jodybrewster.dev'];
const QUOTE_MIN = 12;
const QUOTE_MAX = 320;

const str = (value: unknown) => typeof value === 'string' ? value.trim() : '';
/** Own keys only, so a slug like `constructor` cannot reach the prototype. */
const own = <T>(record: Record<string, T>, key: string): T | undefined =>
  key && Object.hasOwn(record, key) ? record[key] : undefined;

/** A slug, or the path a model sometimes passes in its place. */
function slugArg(value: unknown, collections: string[]): string {
  let slug = str(value).replace(/[?#].*$/, '').replace(/\/+$/, '');
  for (const collection of collections) {
    const prefix = new RegExp(`^/?${collection}/`);
    if (prefix.test(slug)) { slug = slug.replace(prefix, ''); break; }
  }
  return slug;
}

/** Site-relative path for a same-site url, or null for anything off-site. */
export function sitePath(value: unknown): string | null {
  const raw = str(value);
  if (!raw || raw.startsWith('//') || raw.includes('\\')) return null;
  let path: string;
  if (raw.startsWith('/')) path = raw;
  else {
    try {
      const url = new URL(raw);
      if (!SITE_ORIGINS.includes(url.origin) || url.username || url.password) return null;
      path = url.pathname;
    } catch { return null; }
  }
  path = path.replace(/[?#].*$/, '');
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

const FOLD: Record<string, string> = {
  '\u2018': "'", '\u2019': "'", '\u201a': "'", '\u201b': "'", '\u2032': "'", '`': '',
  '\u201c': '"', '\u201d': '"', '\u201e': '"', '\u2033': '"',
  '\u2013': '-', '\u2014': '-', '\u2212': '-', '\u2026': '...', '*': '',
};

/**
 * Lowercased, quote- and dash-folded, whitespace-collapsed text, plus where
 * each folded character came from, so a match can be cut back out of the
 * original in the page's own spelling.
 */
function fold(text: string): { folded: string; at: number[] } {
  let folded = ''; const at: number[] = [];
  let space = true;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (/\s/.test(char)) {
      if (!space) { folded += ' '; at.push(i); space = true; }
      continue;
    }
    const mapped = (FOLD[char] ?? char).toLowerCase();
    for (const out of mapped) { folded += out; at.push(i); }
    if (mapped) space = false;
  }
  if (folded.endsWith(' ')) { folded = folded.slice(0, -1); at.pop(); }
  return { folded, at };
}

/** The passage as it appears on the page, or null if the page does not say it. */
export function verifyQuote(pageText: string, quote: string): string | null {
  const wanted = fold(quote.replace(/^["'\u2018\u2019\u201c\u201d\s]+|["'\u2018\u2019\u201c\u201d\s]+$/g, '')).folded;
  if (wanted.length < QUOTE_MIN || wanted.length > QUOTE_MAX) return null;
  const page = fold(pageText);
  const start = page.folded.indexOf(wanted);
  if (start < 0) return null;
  const original = pageText.slice(page.at[start], page.at[start + wanted.length - 1] + 1);
  return original.replace(/[*`]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Turn a tool call into a card, or null when the call names nothing real:
 * an unknown tool, an unknown slug, an off-site or unpublished url.
 */
export function resolveCard(index: CardIndex, name: string, args: Record<string, unknown>): Card | null {
  const input = args && typeof args === 'object' ? args : {};
  switch (name) {
    case 'show_work': return own(index.work, slugArg(input.slug, ['work'])) ?? null;
    case 'show_writing': {
      const slug = slugArg(input.slug, ['writing', 'research']);
      return own(index.articles, slug && `writing:${slug}`) ?? own(index.articles, slug && `research:${slug}`) ?? null;
    }
    case 'show_note': return own(index.notes, slugArg(input.slug, ['notes'])) ?? null;
    case 'show_now': return index.now;
    case 'show_case_study': {
      const slug = slugArg(input.slug, ['work']);
      const entry = own(index.parts, slug && `work:${slug}`);
      const part = str(input.part) as WorkPart;
      if (!entry || !(WORK_PARTS as readonly string[]).includes(part) || !entry.parts.includes(part)) return null;
      return { kind: 'part', slug, part, title: entry.title, url: entry.url };
    }
    case 'show_screens': {
      const slug = slugArg(input.slug, ['portfolio', 'work']);
      const entry = own(index.parts, slug && `screens:${slug}`);
      return entry ? { kind: 'screens', slug, title: entry.title, url: entry.url } : null;
    }
    case 'go_to_page': {
      const url = sitePath(input.url);
      const page = url ? own(index.pages, url) : undefined;
      return url && page ? { kind: 'navigate', url, title: page.title } : null;
    }
    case 'open_page': {
      const url = sitePath(input.url);
      const page = url ? own(index.pages, url) : undefined;
      if (!url || !page) return null;
      const card: Card = { kind: 'page', url, title: page.title };
      if (page.description) card.description = page.description;
      const quote = str(input.quote) && verifyQuote(page.text, str(input.quote));
      if (quote) card.quote = quote;
      return card;
    }
    default: return null;
  }
}
