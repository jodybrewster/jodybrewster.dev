/**
 * Google Tag Manager.
 *
 * The container id is public by design - it ships in the HTML of every page
 * that uses it - so it lives here rather than in the environment, and a deploy
 * needs nothing configured to be tagged. Only production builds carry it, so
 * the dev server never reports traffic.
 *
 * GA4 is configured inside the container, not in this repo.
 */
export const GTM_ID = 'GTM-WH8C4NVF';

export const analyticsEnabled = import.meta.env.PROD;
