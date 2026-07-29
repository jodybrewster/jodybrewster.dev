import type { APIRoute } from 'astro';
import { buildShelfPayload } from '../lib/shelf/payload';

/**
 * The shelf's data as a static file.
 *
 * Lets the scene be warmed from any page on the site without first loading the
 * shelf at /, which is what keeps the shelf alive in memory and both directions
 * of the transition instant.
 */
export const GET: APIRoute = async () => {
  const payload = await buildShelfPayload();
  return new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
