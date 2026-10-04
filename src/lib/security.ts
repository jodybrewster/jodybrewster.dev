import { GEMINI_LIVE_ORIGIN, type HeaderOptions } from '@jodybrewster/gemini-live/server/headers';

/**
 * What the site may load, as the security headers preset's options (M1 1.9,
 * site step S6). scripts/security-headers.ts turns them, with a hash of
 * every inline script in the build, into the headers Vercel sends.
 *
 * `img`, `font` and `connect` are the exfiltration controls, so they list
 * exact hosts. GA4's hosts are an accepted risk (Jody, 2026-10-04): they
 * are shared-tenant, so an HTML injection could load someone else's tag or
 * send to someone else's GA4 property. The `/gtag/` path narrows the script
 * host but is no boundary.
 */
const GA4 = [
  'https://www.google-analytics.com',
  'https://region1.google-analytics.com',
  'https://region1.analytics.google.com',
  'https://www.googletagmanager.com',
];

export const SECURITY: HeaderOptions = {
  env: { NODE_ENV: 'production' },
  connect: [GEMINI_LIVE_ORIGIN, ...GA4],
  // Album covers on the library shelf come from Spotify's image CDN, which
  // no one else can read requests to.
  img: [...GA4, 'https://i.scdn.co'],
  style: ['https://fonts.googleapis.com'],
  font: ['https://fonts.gstatic.com'],
  script: ['https://www.googletagmanager.com/gtag/'],
  // Pagefind compiles its search index as WebAssembly.
  wasm: true,
  // Voice uses the microphone; nothing uses the camera or the screen.
  media: { microphone: true },
};
