/**
 * GA4 custom events.
 *
 * Every event goes through `track`, which does nothing when gtag is absent: the
 * dev server never loads it (src/lib/analytics.ts) and blockers remove it. So
 * callers fire freely and never check.
 *
 * Parameters are values the site chooses - a channel, a topic, a slug - never
 * visitor text. GA4 forbids PII, and a chat box is where people type their
 * name and email. Verso's words live in the transcript log instead
 * (src/lib/transcripts.ts).
 */

export type EventParams = Record<string, string | number | boolean | undefined>;

export function track(name: string, params: EventParams = {}): void {
  const gtag = (globalThis as { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof gtag !== 'function') return;
  try { gtag('event', name, params); } catch { /* Analytics never breaks the page. */ }
}

export type ContactChannel = 'email' | 'linkedin' | 'github' | 'behance';

/** Which way out a link is, or null for any other link. */
export function contactChannel(href: string): ContactChannel | null {
  if (/^mailto:/i.test(href)) return 'email';
  let host: string;
  try { host = new URL(href).hostname.toLowerCase(); } catch { return null; }
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return 'linkedin';
  if (host === 'github.com') return 'github';
  if (host === 'behance.net' || host.endsWith('.behance.net')) return 'behance';
  return null;
}

/**
 * Contact links, from anywhere on any page. Delegated at the document once, so
 * it survives soft navigation. `location` says which block the click came from:
 * the footer, or the nearest section with an id (the About page's #contact).
 */
export function trackContactClicks(): void {
  document.addEventListener('click', event => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    const channel = link && contactChannel(link.href);
    if (!link || !channel) return;
    const block = link.closest('footer') ? 'footer' : link.closest('[id]')?.id || 'page';
    track('contact_click', { channel, location: `${location.pathname}#${block}` });
  }, { capture: true });
}
