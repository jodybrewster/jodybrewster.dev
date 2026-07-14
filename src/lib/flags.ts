/**
 * Build-time feature flags. The site is static, so flipping a flag
 * requires a rebuild/deploy. Flags gate every surface of a feature:
 * nav links, pages, docks, API routes, and prose mentions.
 */
export const flags = {
  /** The chat feature: /chat page, site-wide ask bar, /api/chat, nav link. */
  chat: false,
} as const;
