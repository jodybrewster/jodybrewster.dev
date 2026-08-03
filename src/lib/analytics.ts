/**
 * Google Analytics 4, loaded directly rather than through a tag manager.
 *
 * A container earns its keep when tags change without a deploy, or when there
 * are several of them. There is one tag here and one person who would change
 * it, so the container was 100KB and a Google UI standing between this repo and
 * a single measurement ID. This keeps the whole setup in git, where it can be
 * read and reviewed.
 *
 * The id is public by design - it ships in the HTML of every page that uses it
 * - so it lives here rather than in the environment, and a deploy needs nothing
 * configured to be tagged. Only production builds carry it, so the dev server
 * never reports traffic.
 */
export const GA_ID = 'G-4DLGJN6CZ5';

export const analyticsEnabled = import.meta.env.PROD;
