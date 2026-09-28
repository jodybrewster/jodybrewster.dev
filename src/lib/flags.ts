/**
 * Build-time feature flags. The site is static, so flipping a flag
 * requires a rebuild/deploy. Flags gate every surface of a feature:
 * nav links, pages, docks, API routes, and prose mentions.
 */
export const flags = {
  /** Verso: the site-wide popup chat, /api/chat, /api/live-token, /api/corpus. */
  chat: true,
} as const;
