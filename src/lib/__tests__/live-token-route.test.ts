import { beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  getRedis: vi.fn(), getVoiceIpLimiter: vi.fn(), getVoiceGlobalLimiter: vi.fn(),
  create: vi.fn(), env: vi.fn(),
}));
vi.mock('../redis', () => ({ getRedis: dependencies.getRedis }));
vi.mock('../rate-limit', () => ({
  getVoiceIpLimiter: dependencies.getVoiceIpLimiter, getVoiceGlobalLimiter: dependencies.getVoiceGlobalLimiter,
  clientIp: () => 'test-ip', isOriginAllowed: () => true,
}));
vi.mock('../flags', () => ({ flags: { chat: true } }));
vi.mock('../env', () => ({ env: dependencies.env }));
vi.mock('../verso-tools', () => ({ VERSO_TOOL_DECLARATIONS: [
  { name: 'show_work', description: 'Show a case study.', parameters: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] } },
] }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class { authTokens = { create: dependencies.create }; },
  Modality: { AUDIO: 'AUDIO' },
}));

import { POST } from '../../pages/api/live-token';

const post = async () => await POST({ request: new Request('https://jodybrewster.dev/api/live-token', { method: 'POST' }) } as Parameters<typeof POST>[0]) as Response;
const limiter = (success: boolean) => ({ limit: vi.fn().mockResolvedValue({ success }) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  dependencies.getRedis.mockReturnValue({});
  dependencies.env.mockImplementation((key: string) => key === 'GEMINI_API_KEY' ? 'test-key' : key === 'VERCEL_ENV' ? 'production' : undefined);
  dependencies.getVoiceIpLimiter.mockReturnValue(limiter(true));
  dependencies.getVoiceGlobalLimiter.mockReturnValue(limiter(true));
  dependencies.create.mockResolvedValue({ name: 'auth_tokens/abc' });
});

describe('POST /api/live-token', () => {
  it('mints a single-use token locked to Verso\'s model, prompt and tools', async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect((await response.json()).token).toBe('auth_tokens/abc');
    const { config } = dependencies.create.mock.lastCall![0];
    expect(config.uses).toBe(1);
    // Unset locks every field; Google rejects `[]` once tools are locked.
    expect(config).not.toHaveProperty('lockAdditionalFields');
    const locked = config.liveConnectConstraints;
    expect(locked.model).toMatch(/^gemini-.*live/);
    expect(locked.config.systemInstruction).toContain('Verso');
    expect(locked.config.responseModalities).toEqual(['AUDIO']);
    const names = locked.config.tools[0].functionDeclarations.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(['search_site', 'show_work']);
    expect(locked.config.tools[0].functionDeclarations[1].parametersJsonSchema.required).toEqual(['slug']);
    // A new session must start within a minute; the token dies after the cap.
    const opens = Date.parse(config.newSessionExpireTime) - Date.now();
    expect(opens).toBeGreaterThan(0);
    expect(opens).toBeLessThanOrEqual(60_000);
  });

  it('refuses a visitor past their daily voice sessions without minting', async () => {
    dependencies.getVoiceIpLimiter.mockReturnValue(limiter(false));
    const response = await post();
    expect(response.status).toBe(429);
    expect(dependencies.create).not.toHaveBeenCalled();
  });

  it('refuses once the site-wide voice cap is spent', async () => {
    dependencies.getVoiceGlobalLimiter.mockReturnValue(limiter(false));
    expect((await post()).status).toBe(429);
    expect(dependencies.create).not.toHaveBeenCalled();
  });

  it('refuses in production without Redis, since nothing could meter it', async () => {
    dependencies.getRedis.mockReturnValue(null);
    expect((await post()).status).toBe(503);
    expect(dependencies.create).not.toHaveBeenCalled();
  });

  it('answers 503 without a key or when minting fails, never leaking the error', async () => {
    dependencies.create.mockRejectedValue(new Error('upstream said test-key is bad'));
    const failed = await post();
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain('test-key');
    dependencies.env.mockImplementation(() => undefined);
    expect((await post()).status).toBe(503);
  });

  it('bounds a hanging limiter with a 503', async () => {
    vi.useFakeTimers();
    dependencies.getVoiceIpLimiter.mockReturnValue({ limit: () => new Promise(() => {}) });
    let response: Response | undefined;
    void post().then(value => { response = value; });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(response?.status).toBe(503);
    vi.useRealTimers();
  });
});
