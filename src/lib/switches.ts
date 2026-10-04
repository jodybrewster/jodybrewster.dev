import { createSwitches, envSwitchKey, type SwitchName } from '@jodybrewster/gemini-live/server/switches';
import { env } from './env';

/**
 * The site's kill switches (M1 1.6, site step S5), from the environment
 * alone (Jody, 2026-10-04): `SWITCH_CHAT`, `SWITCH_VOICE`,
 * `SWITCH_TOOL_SEARCH_SITE`, `SWITCH_TOOL_ASK_JODY`, each `off` or
 * `force-off`, unset meaning on. Nothing in Redis can change them, so a
 * leaked route token cannot turn one back on; flipping one is an env change
 * and a redeploy (`npm run switch`). The first request after a redeploy
 * records the change in the audit log (src/lib/audit.ts).
 */
export const SWITCHES = ['chat', 'voice', 'tool:search_site', 'tool:ask_jody'] as const satisfies readonly SwitchName[];

export function switchEnv(): Record<string, string | undefined> {
  return Object.fromEntries(SWITCHES.map(name => [envSwitchKey(name), env(envSwitchKey(name))]));
}

let switches: ReturnType<typeof createSwitches> | null = null;

/** Whether a switch is on. An unreadable state counts as off. */
export async function isOn(name: (typeof SWITCHES)[number]): Promise<boolean> {
  switches ??= createSwitches({ env: switchEnv() });
  return switches.isOn(name).catch(() => false);
}

export const CHAT_OFF = 'Chat is paused right now. Please try again later.';
export const SEARCH_OFF = 'Search is paused right now.';
export const ASK_OFF = 'ask_jody is paused right now. The other tools still work.';
