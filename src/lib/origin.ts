import { env } from './env';

// Origin checks for the site's API routes. Rate limits live in ./limits.

/**
 * For routes other sites' pages must not call but server-side clients may
 * (MCP): true when an Origin header is present and is not this site's, in
 * production. Server-side clients send no Origin.
 */
export function isForeignOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  const environment = env('VERCEL_ENV');
  if (environment ? environment !== 'production' : env('NODE_ENV') !== 'production') return false;
  return !['https://jodybrewster.dev', 'https://www.jodybrewster.dev'].includes(origin);
}

/**
 * Origin check enforced only in production (so dev over Tailscale / localhost /
 * Vercel preview deployments don't get locked out).
 */
export function isOriginAllowed(request: Request): boolean {
  const environment = env('VERCEL_ENV');
  if (environment ? environment !== 'production' : env('NODE_ENV') !== 'production') {
    return true;
  }
  const origin = request.headers.get('origin');
  const candidate = origin ?? request.headers.get('referer');
  if (!candidate) return false;
  try {
    const url = new URL(candidate);
    if (url.username || url.password) return false;
    if (!['https://jodybrewster.dev', 'https://www.jodybrewster.dev'].includes(url.origin)) return false;
    // Origin is an origin, never a path, query, credentials, or fragment.
    return origin === null || candidate === url.origin;
  } catch { return false; }
}
