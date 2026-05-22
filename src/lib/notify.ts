import { env } from './env';

/**
 * Fire-and-forget Pushover notification. Returns immediately; the fetch runs
 * in the background and any failure is swallowed (logged to console).
 */
export function notifyPushover(title: string, message: string, url?: string): void {
  const token = env('PUSHOVER_API_TOKEN');
  const user = env('PUSHOVER_USER_KEY');
  if (!token || !user) return;

  const body = new URLSearchParams({ token, user, title, message });
  if (url) body.set('url', url);

  void fetch('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }).catch(err => console.error('[pushover]', err));
}
