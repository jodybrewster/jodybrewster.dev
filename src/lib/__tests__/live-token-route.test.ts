import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../verso-tools', () => ({ VERSO_TOOL_DECLARATIONS: [
  { name: 'show_work', description: 'Show a case study.', parameters: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] } },
] }));

import type { VoiceTokenRequest } from '@jodybrewster/gemini-live/server';
import { createLiveTokenRoute, voiceEnv } from '../../pages/api/live-token';

const DEV = 'http://localhost:4321';
// astro dev: counts in memory, the dev origins allowed, one visitor bucket.
const devEnv = (extra: Record<string, string> = {}) => ({ NODE_ENV: 'development', GEMINI_API_KEY: 'test-key', ...extra });
const request = (origin: string | null = DEV, method = 'POST') => new Request('https://jodybrewster.dev/api/live-token', {
  method, headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: method === 'POST' ? '{}' : undefined,
});

let mint: ReturnType<typeof vi.fn<(request: VoiceTokenRequest) => Promise<{ name?: string }>>>;
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mint = vi.fn<(request: VoiceTokenRequest) => Promise<{ name?: string }>>().mockResolvedValue({ name: 'auth_tokens/abc' });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('POST /api/live-token', () => {
  it("mints a single-use token locked to Verso's model, prompt and tools", async () => {
    const response = await createLiveTokenRoute(devEnv(), mint)(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body.token).toBe('auth_tokens/abc');
    const config = mint.mock.lastCall![0];
    expect(config.uses).toBe(1);
    // Unset locks every field; Google rejects `[]` once tools are locked.
    expect(config).not.toHaveProperty('lockAdditionalFields');
    // The shape the site sends, read without the SDK's wide union types.
    const locked = config.liveConnectConstraints as unknown as {
      model: string;
      config: { systemInstruction: string; responseModalities: string[]; tools: { functionDeclarations: { name: string; parametersJsonSchema: { required: string[] } }[] }[] };
    };
    expect(locked.model).toMatch(/^gemini-.*live/);
    expect(locked.config.systemInstruction).toContain('Verso');
    expect(locked.config.responseModalities).toEqual(['AUDIO']);
    const names = locked.config.tools[0].functionDeclarations.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(['search_site', 'show_work']);
    expect(locked.config.tools[0].functionDeclarations[1].parametersJsonSchema.required).toEqual(['slug']);
    // A new session must start within a minute; the token dies a minute after the five-minute cap.
    const opens = Date.parse(config.newSessionExpireTime) - Date.now();
    expect(opens).toBeGreaterThan(0);
    expect(opens).toBeLessThanOrEqual(60_000);
    expect(Date.parse(config.expireTime) - Date.now()).toBeLessThanOrEqual(6 * 60_000);
    expect(Date.parse(body.expiresAt)).toBe(Date.parse(config.expireTime));
  });

  it('refuses a visitor past their 3 daily voice sessions without minting', async () => {
    const route = createLiveTokenRoute(devEnv(), mint);
    for (let i = 0; i < 3; i++) expect((await route(request())).status).toBe(200);
    const refused = await route(request());
    expect(refused.status).toBe(429);
    expect((await refused.json()).message).toMatch(/voice time for today/);
    expect(mint).toHaveBeenCalledTimes(3);
  });

  it('refuses once the site-wide voice cap is spent', async () => {
    const route = createLiveTokenRoute(devEnv({ VOICE_SESSIONS_PER_DAY: '1' }), mint);
    expect((await route(request())).status).toBe(200);
    expect((await route(request())).status).toBe(429);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('refuses on Vercel without Redis, since nothing could meter it', async () => {
    const response = await createLiveTokenRoute(voiceEnv(key => ({ VERCEL: '1', VERCEL_ENV: 'production', NODE_ENV: 'production', GEMINI_API_KEY: 'k' } as Record<string, string>)[key]), mint)(request('https://jodybrewster.dev'));
    expect(response.status).toBe(503);
    expect(mint).not.toHaveBeenCalled();
  });

  it('answers 503 without a key or when minting fails, never leaking the error', async () => {
    expect((await createLiveTokenRoute({ NODE_ENV: 'development' })(request())).status).toBe(503);
    mint.mockRejectedValue(new Error('upstream detail: secret'));
    const failed = await createLiveTokenRoute(devEnv(), mint)(request());
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain('secret');
  });

  it('refuses other origins, and requests with none', async () => {
    const route = createLiveTokenRoute(devEnv(), mint);
    expect((await route(request('https://evil.example'))).status).toBe(403);
    expect((await route(request(null))).status).toBe(403);
    expect(mint).not.toHaveBeenCalled();
  });

  it('obeys the voice switch from the environment', async () => {
    for (const value of ['off', 'force-off']) {
      const response = await createLiveTokenRoute(devEnv({ SWITCH_VOICE: value }), mint)(request());
      expect(response.status).toBe(503);
      expect((await response.json()).error).toBe('voice_off');
    }
    expect(mint).not.toHaveBeenCalled();
  });

  it('sends the locked config through the real SDK (fetch stubbed): no field mask', async () => {
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      sent.push(String(init?.body));
      return new Response(JSON.stringify({ name: 'auth_tokens/real' }), { headers: { 'content-type': 'application/json' } });
    }));
    const response = await createLiveTokenRoute(devEnv())(request());
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('Verso');
    expect(sent[0]).toContain('search_site');
    expect(sent[0]).not.toMatch(/fieldMask/);
  });
});

describe('voiceEnv', () => {
  const read = (values: Record<string, string>) => (key: string) => values[key];

  it("allows only the site's origins in production, on Upstash", () => {
    const out = voiceEnv(read({ VERCEL: '1', VERCEL_ENV: 'production', NODE_ENV: 'production' }));
    expect(out.VOICE_ALLOWED_ORIGINS).toBe('https://jodybrewster.dev,https://www.jodybrewster.dev');
    expect(out.RATE_LIMIT_STORE).toBe('upstash');
  });

  it("adds a preview's own URLs on a preview", () => {
    const out = voiceEnv(read({ VERCEL: '1', VERCEL_ENV: 'preview', NODE_ENV: 'production', VERCEL_URL: 'site-abc.vercel.app', VERCEL_BRANCH_URL: 'site-git-x.vercel.app' }));
    expect(out.VOICE_ALLOWED_ORIGINS).toBe('https://jodybrewster.dev,https://www.jodybrewster.dev,https://site-abc.vercel.app,https://site-git-x.vercel.app');
  });

  it('lets an explicit setting win, and leaves local dev to the dev origins', () => {
    expect(voiceEnv(read({ VERCEL: '1', VOICE_ALLOWED_ORIGINS: 'https://other.example', RATE_LIMIT_STORE: 'upstash' })).VOICE_ALLOWED_ORIGINS).toBe('https://other.example');
    const dev = voiceEnv(read({ NODE_ENV: 'development' }));
    expect(dev.VOICE_ALLOWED_ORIGINS).toBeUndefined();
    expect(dev.RATE_LIMIT_STORE).toBeUndefined();
  });
});
