import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { dailyAudit } from '../../../lib/audit';
import { env } from '../../../lib/env';
import { sendNotice } from '../../../lib/telegram';

export const prerender = false;

/**
 * The daily audit heartbeat (vercel.json crons): writes yesterday's refusal
 * summary, drops months past retention and sends the newest anchor, with
 * the month's entry count, to Jody's Telegram, outside both Redis and
 * Vercel's day-long logs. Vercel calls it with
 * `Authorization: Bearer $CRON_SECRET`; anything else is refused, and so is
 * a secret under 16 characters. A failure is sent to Telegram too, so a
 * silent log never looks like a quiet day.
 */
export const GET: APIRoute = async ({ request }) => {
  const secret = env('CRON_SECRET') ?? '';
  const given = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const authorized = secret.length >= 16 && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!authorized) return new Response('Unauthorized', { status: 401 });
  try {
    return new Response(await dailyAudit(), { status: 200 });
  } catch (error) {
    await sendNotice(`Audit heartbeat failed: ${error instanceof Error ? error.message : 'unknown error'}`).catch(() => {});
    return new Response('Audit heartbeat failed', { status: 500 });
  }
};
