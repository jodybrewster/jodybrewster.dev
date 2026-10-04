import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { auditHead, sendAnchor } from '../../../lib/audit';
import { env } from '../../../lib/env';

export const prerender = false;

/**
 * The daily audit heartbeat (vercel.json crons): sends the newest entry's
 * anchor to Jody's Telegram, outside both Redis and Vercel's day-long logs,
 * so `npm run audit:verify` can prove nothing before it was trimmed or
 * rewritten. Vercel calls it with `Authorization: Bearer $CRON_SECRET`;
 * anything else is refused, and so is a secret under 16 characters.
 */
export const GET: APIRoute = async ({ request }) => {
  const secret = env('CRON_SECRET') ?? '';
  const given = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const authorized = secret.length >= 16 && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!authorized) return new Response('Unauthorized', { status: 401 });
  const head = await auditHead().catch(() => null);
  if (!head) return new Response('No audit entries', { status: 200 });
  await sendAnchor(head, 'daily');
  return new Response('Anchor sent', { status: 200 });
};
