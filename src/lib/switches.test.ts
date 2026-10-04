import { beforeEach, describe, expect, it, vi } from 'vitest';

const environment = vi.hoisted(() => ({ values: {} as Record<string, string | undefined> }));
vi.mock('./env', () => ({ env: (key: string) => environment.values[key] }));

async function load() {
  vi.resetModules();
  return import('./switches');
}

beforeEach(() => { environment.values = {}; });

describe('site switches', () => {
  it('are on when unset', async () => {
    const { isOn, SWITCHES } = await load();
    for (const name of SWITCHES) expect(await isOn(name)).toBe(true);
  });

  it('turn off with off or force-off in the environment', async () => {
    environment.values = { SWITCH_CHAT: 'off', SWITCH_TOOL_ASK_JODY: 'force-off' };
    const { isOn } = await load();
    expect(await isOn('chat')).toBe(false);
    expect(await isOn('tool:ask_jody')).toBe(false);
    expect(await isOn('voice')).toBe(true);
  });

  it('read the environment only: no store is ever consulted', async () => {
    const { switchEnv } = await load();
    expect(Object.keys(switchEnv())).toEqual(['SWITCH_CHAT', 'SWITCH_VOICE', 'SWITCH_TOOL_SEARCH_SITE', 'SWITCH_TOOL_ASK_JODY']);
  });
});
