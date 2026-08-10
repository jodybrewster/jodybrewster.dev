/**
 * Display values for skill-written drafts.
 *
 * Drafts land in posts/drafts/ straight from the /daily-post skill and carry no
 * frontmatter, so everything the listing needs is read back out of the body and
 * the filename. Frontmatter wins wherever a draft happens to have it.
 */

/** `# Some title` on the first heading line. */
export function draftTitle(body: string, id: string): string {
  const h1 = body.match(/^#\s+(.+)$/m);
  return h1 ? h1[1].trim() : id;
}

/**
 * First real paragraph, skipping the italic byline block and the `---` rule
 * that follows it.
 */
export function draftDescription(body: string): string {
  const para = body
    .replace(/^#\s+.+$/m, '')
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .find(p => p && !p.startsWith('*') && !p.startsWith('---') && !p.startsWith('#'));
  if (!para) return '';
  const flat = para.replace(/\s+/g, ' ');
  return flat.length > 200 ? `${flat.slice(0, 197).trimEnd()}...` : flat;
}

/** Drafts are named `YYYY-MM-DD-slug.md`; fall back to today if they aren't. */
export function draftDate(id: string): Date {
  const stamp = id.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!stamp) return new Date();
  return new Date(Number(stamp[1]), Number(stamp[2]) - 1, Number(stamp[3]));
}

export function draftReadTime(body: string): string {
  const words = body.split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.ceil(words / 200))} min`;
}

/** How many `[JODY'S TAKE]` slots are still waiting on him. */
export function draftTakeCount(body: string): number {
  return (body.match(/>\s*\*\*\[JODY'S TAKE\]\*\*/g) ?? []).length;
}

export function formatDraftDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
