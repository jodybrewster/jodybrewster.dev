import type { Card } from './verso-tools';

/**
 * Build a card from its template in the dock. Shared by the text chat and the
 * voice session. Every value goes in through textContent or a checked
 * attribute, and links and images must be paths on this site, so nothing a
 * model or a stale index says can inject markup or send a reader elsewhere.
 * Returns null for anything malformed.
 */
const LABELS = { writing: 'Essay', research: 'Research' } as const;
const STATES = ['seedling', 'budding', 'evergreen'];

function sitePath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  try {
    const url = new URL(value, location.origin);
    return url.origin === location.origin ? url.pathname : null;
  } catch { return null; }
}
function formatDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return '';
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) ? '' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

const PART = /^(visual|facts|summary|architecture)$/;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/**
 * A case study part or product-screen gallery, cloned from the templates that
 * the dock renders from the case study page's own components. If a template
 * is missing, the part degrades to a link card to where it lives.
 */
function renderPart(dock: HTMLElement, card: Extract<Card, { kind: 'part' | 'screens' }>): HTMLElement | null {
  const slug = text(card.slug);
  if (!SLUG.test(slug)) return null;
  if (card.kind === 'part' && !PART.test(text(card.part))) return null;
  const id = card.kind === 'part' ? `gen-work-${slug}-${card.part}` : `gen-screens-${slug}`;
  const template = document.getElementById(id);
  const node = template instanceof HTMLTemplateElement ? template.content.firstElementChild?.cloneNode(true) : null;
  if (node instanceof HTMLElement) return node;
  return renderCard(dock, { kind: 'page', url: card.url, title: card.title });
}

export function renderCard(dock: HTMLElement, card: Card): HTMLElement | null {
  if (!card || typeof card !== 'object') return null;
  if (card.kind === 'part' || card.kind === 'screens') return renderPart(dock, card);
  if (card.kind === 'navigate') return renderCard(dock, { kind: 'page', url: card.url, title: card.title });
  const kind = (card as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || !/^(work|article|note|now|page)$/.test(kind)) return null;
  const href = sitePath(card.url);
  const title = text(card.title);
  if (!href || !title) return null;
  const template = dock.querySelector<HTMLTemplateElement>(`#tpl-card-${kind}`);
  const node = template?.content.firstElementChild?.cloneNode(true);
  if (!(node instanceof HTMLAnchorElement)) return null;
  node.href = href;

  const fields: Record<string, string> = { title };
  const dates: Record<string, string> = {};
  if (card.kind === 'work') Object.assign(fields, { summary: text(card.summary), role: text(card.role), duration: text(card.duration), sector: text(card.sector) });
  if (card.kind === 'article') {
    Object.assign(fields, { label: LABELS[card.collection] ?? 'Writing', description: text(card.description), date: formatDate(card.date) });
    dates.date = card.date;
    const image = node.querySelector('img');
    const src = sitePath(card.image);
    if (image && src) image.src = src; else image?.remove();
  }
  if (card.kind === 'note') {
    const status = STATES.includes(card.status) ? card.status : '';
    Object.assign(fields, { date: formatDate(card.date), status });
    dates.date = card.date;
    node.querySelector('[data-field="status"]')?.setAttribute('data-status', status);
  }
  if (card.kind === 'now') {
    const updated = formatDate(card.updated);
    Object.assign(fields, { excerpt: text(card.excerpt), updated: updated && `Updated ${updated}` });
    dates.updated = text(card.updated);
  }
  if (card.kind === 'page') Object.assign(fields, { path: href, quote: text(card.quote), description: text(card.quote) ? '' : text(card.description) });

  for (const slot of node.querySelectorAll<HTMLElement>('[data-field]')) {
    const name = slot.dataset.field!;
    const value = fields[name];
    if (!value) { slot.remove(); continue; }
    slot.textContent = value;
    if (slot instanceof HTMLTimeElement && dates[name]) slot.dateTime = dates[name].slice(0, 10);
    slot.removeAttribute('data-field');
  }
  node.querySelector('.vcard-meta:empty')?.remove();
  return node;
}
