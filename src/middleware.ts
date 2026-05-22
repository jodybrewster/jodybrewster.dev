/**
 * Site-wide Basic Auth gate for the preview phase.
 *
 * Active only when PREVIEW_PASSWORD env var is set. When unset (e.g. local dev
 * without the var), middleware is a no-op so `astro dev` stays open.
 *
 * Username is hardcoded to "preview"; password comes from env. Browsers cache
 * the credential for the session, so visitors get the login dialog once.
 *
 * To remove the gate: delete this file and switch astro.config.mjs back to
 * output: 'static'.
 */
import { defineMiddleware } from 'astro:middleware';
import { env } from './lib/env';

const USERNAME = 'preview';
const REALM = 'jodybrewster.dev preview';

function ok(auth: string | null, password: string): boolean {
  if (!auth?.startsWith('Basic ')) return false;
  try {
    const decoded = atob(auth.slice(6));
    const idx = decoded.indexOf(':');
    if (idx < 0) return false;
    const user = decoded.slice(0, idx);
    const pass = decoded.slice(idx + 1);
    return user === USERNAME && pass === password;
  } catch {
    return false;
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  const password = env('PREVIEW_PASSWORD');
  if (!password) return next();

  // Always let the .well-known files through so MCP / A2A discovery isn't gated.
  // (They contain no secrets; the gate is for the editorial content.)
  const path = context.url.pathname;
  if (path.startsWith('/.well-known/')) return next();

  if (ok(context.request.headers.get('authorization'), password)) {
    return next();
  }

  // Tiny HTML body so Astro's response post-processing doesn't choke on a
  // non-HTML 401 (it tries to inject scripts/transitions and errors otherwise).
  return new Response(
    '<!doctype html><html><head><meta charset="utf-8"><title>Preview</title></head><body><p>Authentication required.</p></body></html>',
    {
      status: 401,
      headers: {
        'WWW-Authenticate': `Basic realm="${REALM}"`,
        'Content-Type': 'text/html; charset=utf-8',
      },
    },
  );
});
