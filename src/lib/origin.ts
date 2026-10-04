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

const SITE_HOSTS = ['jodybrewster.dev', 'www.jodybrewster.dev'];

/**
 * In production, true only for requests to the site's own domains. Every
 * production deployment keeps a permanent URL with the environment it was
 * built with, so an old one would ignore a switch set since (and could make
 * the audit log record a switch change back); refusing other hosts makes
 * old deployments' API routes dead. Elsewhere (previews, astro dev) true.
 */
export function isCanonicalHost(request: Request): boolean {
  if (env('VERCEL_ENV') !== 'production') return true;
  const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host).toLowerCase().replace(/:\d+$/, '');
  return SITE_HOSTS.includes(host);
}

/** The answer for a request to an old deployment's URL: as if the route did not exist. */
export const otherHost = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
