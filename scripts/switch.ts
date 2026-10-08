/**
 * Flips one of the site's kill switches (src/lib/switches.ts) in Vercel's
 * Production environment with the Vercel CLI. It never deploys: the change
 * applies at the next `npx vercel --prod`, and the first request after that
 * records it in the audit log. It needs no audit key or Redis token. Chat
 * off pauses the chat with friendly copy; chat force-off also removes the
 * dock from the site at that build.
 *
 *   npm run switch -- chat off          # or: voice, search_site, ask_jody
 *   npm run switch -- voice force-off   # same effect, marked as a break-glass
 *   npm run switch -- chat on           # removes the variable (unset means on)
 */
import { spawnSync } from 'node:child_process';
import { envSwitchKey, type SwitchName } from '@jodybrewster/gemini-live/server/switches';

const NAMES: Record<string, SwitchName> = { chat: 'chat', voice: 'voice', search_site: 'tool:search_site', ask_jody: 'tool:ask_jody' };
const STATES = ['on', 'off', 'force-off'] as const;

// Pinned, so the lockfile-free npx run is still a known CLI on the machine
// that holds the Vercel login.
const VERCEL_CLI = 'vercel@62.2.0';

function vercel(args: string[], input?: string): number {
  const result = spawnSync('npx', ['--yes', VERCEL_CLI, ...args], { input, stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'] });
  return result.status ?? 1;
}

function main(): void {
  const [name, state] = process.argv.slice(2);
  const switchName = NAMES[name ?? ''];
  if (!switchName || !STATES.includes(state as (typeof STATES)[number])) {
    console.error(`Usage: npm run switch -- <${Object.keys(NAMES).join('|')}> <${STATES.join('|')}>`);
    process.exit(1);
  }
  const key = envSwitchKey(switchName);
  if (state === 'on') {
    // Unset means on. A failed removal leaves the switch as it was.
    if (vercel(['env', 'rm', key, 'production', '--yes']) !== 0) {
      console.error(`Could not remove ${key}; the switch is unchanged. Check \`npx ${VERCEL_CLI} env ls\`.`);
      process.exit(1);
    }
  } else if (vercel(['env', 'add', key, 'production', '--force'], state) !== 0) {
    // An upsert: there is never a moment with the variable unset (on).
    console.error(`Could not set ${key}; it keeps its previous value. Check \`npx ${VERCEL_CLI} env ls\`.`);
    process.exit(1);
  }
  console.log(`${key} is now ${state === 'on' ? 'unset (on)' : state} for Production. Run \`npx vercel --prod\` to apply it; the first request after the deploy records the change in the audit log.`);
}

main();
