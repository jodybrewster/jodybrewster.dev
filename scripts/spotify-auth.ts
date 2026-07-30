/**
 * One-time helper: mint the SPOTIFY_REFRESH_TOKEN used by scripts/spotify-sync.ts.
 *
 * Uses the redirect URI registered in the Spotify dashboard:
 * https://jodybrewster.dev/callback. That page does not exist on the site, so
 * after approving consent you land on a 404 with the auth code in the address
 * bar. Paste that full URL (or just the code value) back into the terminal.
 *
 * Run: npm run spotify-auth
 * Then put the printed SPOTIFY_REFRESH_TOKEN into .env and the Vercel project
 * env. The token does not expire on its own.
 */
import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { exec } from 'node:child_process';

const REDIRECT_URI = 'https://jodybrewster.dev/callback';

const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env first.');
  process.exit(1);
}

const authUrl = new URL('https://accounts.spotify.com/authorize');
authUrl.search = new URLSearchParams({
  response_type: 'code',
  client_id: clientId,
  scope: 'user-top-read',
  redirect_uri: REDIRECT_URI,
}).toString();

console.log(`Opening the Spotify consent page. If the browser does not open, visit:\n${authUrl}\n`);
console.log(`After approving you will land on ${REDIRECT_URI}?code=... (a 404 page - that is expected).`);
exec(`open "${authUrl}"`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = (await rl.question('\nPaste the full URL from the address bar (or just the code): ')).trim();
rl.close();

let code = answer;
if (answer.includes('code=')) {
  try {
    code = new URL(answer).searchParams.get('code') ?? answer;
  } catch {
    code = answer.split('code=')[1]?.split('&')[0] ?? answer;
  }
}

const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
  method: 'POST',
  headers: {
    Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
});
const token = (await tokenRes.json()) as { refresh_token?: string };

if (!token.refresh_token) {
  console.error('Token exchange failed:', token);
  process.exit(1);
}

console.log('\nAdd this to .env and to the Vercel project env vars:\n');
console.log(`SPOTIFY_REFRESH_TOKEN=${token.refresh_token}\n`);
