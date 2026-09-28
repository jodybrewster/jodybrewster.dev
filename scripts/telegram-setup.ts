/**
 * One-time helper: point the Telegram bot at the site's webhook and register
 * its command menu. The webhook receives Jody's replies to Verso's turns.
 *
 * Run: npm run telegram:setup
 *   --url <url>  register a different URL, for a tunnel or a preview deploy
 *   --info       print getWebhookInfo instead and exit. Fastest way to see why
 *                deliveries are failing: last_error_message and
 *                pending_update_count say it plainly.
 *   --delete     unregister the webhook
 *
 * Needs TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in .env. The same secret
 * must be set in the Vercel project env, or every delivery is rejected 401 by
 * the route and Telegram retries it forever.
 */
import 'dotenv/config';

const API_ROOT = 'https://api.telegram.org';
const DEFAULT_URL = 'https://jodybrewster.dev/api/telegram';

/** Shown in Telegram's own command menu, so each one has to read on a phone. */
const COMMANDS = [
  { command: 'help', description: 'How replies reach visitors' },
];

function requireEnv(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Set ${name} in .env first. ${hint}`);
    process.exit(1);
  }
  return value;
}

const token = requireEnv(
  'TELEGRAM_BOT_TOKEN',
  'BotFather issues it: /newbot for a new bot, /token for one you already have.',
);

async function api<T = unknown>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${API_ROOT}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; result?: T; description?: string }
    | null;

  if (!res.ok || !body?.ok) {
    console.error(`${method} failed (${res.status}): ${body?.description ?? 'no response body'}`);
    process.exit(1);
  }
  return body.result as T;
}

const args = process.argv.slice(2);

if (args.includes('--info')) {
  console.log(JSON.stringify(await api('getWebhookInfo'), null, 2));
  process.exit(0);
}

if (args.includes('--delete')) {
  await api('deleteWebhook');
  console.log('Webhook deleted. The bot receives nothing until this script runs again.');
  process.exit(0);
}

const urlFlag = args.indexOf('--url');
if (urlFlag !== -1 && !args[urlFlag + 1]) {
  console.error('--url needs a URL, e.g. --url https://xyz.ngrok.app/api/telegram');
  process.exit(1);
}
const url = urlFlag !== -1 ? args[urlFlag + 1] : DEFAULT_URL;

const secret = requireEnv(
  'TELEGRAM_WEBHOOK_SECRET',
  'Any long random string; Telegram sends it back on every delivery so the route can tell it is really Telegram.',
);

// Pending updates are dropped because they were queued against the old target
// and are already stale: a reply from then would land in a stranger's chat late.
await api('setWebhook', {
  url,
  secret_token: secret,
  allowed_updates: ['message'],
  drop_pending_updates: true,
});
console.log(`Webhook set to ${url}`);
console.log('  allowed_updates: message');
console.log('  pending updates: dropped');

await api('setMyCommands', { commands: COMMANDS });
console.log(`Commands registered: ${COMMANDS.map(c => `/${c.command}`).join(' ')}`);

console.log('\nSend /start to the bot from your own account once, or every send fails with 403.');
console.log('Check delivery health any time with: npm run telegram:setup -- --info');
