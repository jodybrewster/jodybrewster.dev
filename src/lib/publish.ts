/**
 * The `publish` flag on research and notes.
 *
 * `true` publishes everywhere. `draft` shows the piece on the dev server only,
 * so it can be read in the real layout before it goes live; a production build
 * leaves it out of every page, feed, llms.txt and Verso's corpus. Anything else
 * keeps it private.
 *
 * Every reader of the flag goes through here. A loose truthiness check would
 * let a draft through, since 'draft' is a truthy string.
 */

export type Publish = boolean | 'draft';

export function isPublished(publish: unknown, dev: boolean): boolean {
  return publish === true || (dev && publish === 'draft');
}
