import type { APIRoute } from 'astro';
import { GoogleGenAI, Modality } from '@google/genai';
import { getVoiceIpLimiter, getVoiceGlobalLimiter, clientIp, isOriginAllowed } from '../../lib/rate-limit';
import { getRedis } from '../../lib/redis';
import { VOICE_MODEL, VOICE_NAME, VOICE_PROMPT, VOICE_SESSION_MS, SEARCH_SITE_DECLARATION } from '../../lib/verso-voice';
import { VERSO_TOOL_DECLARATIONS } from '../../lib/verso-tools';
import { env } from '../../lib/env';
import { flags } from '../../lib/flags';
import { withDeadline } from '../../lib/deadline';

export const prerender = false;
const UNAVAILABLE = 'Voice is temporarily unavailable. Try typing instead.';
const json = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Mints a single-use Gemini Live token for one voice session.
 *
 * The browser talks to Google directly, so this token is the only lever the
 * site has over what a session can do. It is locked to Verso's model, prompt
 * and tools, it can open one session within a minute, and it dies shortly
 * after the session cap. `lockAdditionalFields` stays unset on purpose: that
 * locks the whole config, and it is the only form Google accepts with `tools`
 * in it (`[]` fails with "field_mask is invalid"). The cost is that the
 * client's own activity-detection settings are ignored for server defaults.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!flags.chat) return new Response('Not found', { status: 404 });
  if (!isOriginAllowed(request)) return new Response('Forbidden', { status: 403 });
  if (!getRedis() && env('VERCEL_ENV') === 'production') return json({ error: UNAVAILABLE }, 503);
  const key = env('GEMINI_API_KEY');
  if (!key) return json({ error: UNAVAILABLE }, 503);
  try {
    const denied = await withDeadline(async signal => {
      const ipLimiter = getVoiceIpLimiter();
      if (ipLimiter) {
        const result = await ipLimiter.limit(clientIp(request));
        signal.throwIfAborted();
        if (result.reason === 'timeout') return json({ error: UNAVAILABLE }, 503);
        if (!result.success) return json({ error: 'That is all the voice time for today. You can keep typing.' }, 429);
      }
      const globalLimiter = getVoiceGlobalLimiter();
      if (globalLimiter) {
        const result = await globalLimiter.limit('global');
        signal.throwIfAborted();
        if (result.reason === 'timeout') return json({ error: UNAVAILABLE }, 503);
        if (!result.success) return json({ error: 'Voice has hit its daily cap. You can keep typing.' }, 429);
      }
      return null;
    }, 4000, request.signal);
    if (denied) return denied;
  } catch {
    return json({ error: UNAVAILABLE }, 503);
  }
  try {
    const now = Date.now();
    const ai = new GoogleGenAI({ apiKey: key, httpOptions: { apiVersion: 'v1alpha' } });
    const token = await withDeadline(signal => ai.authTokens.create({ config: {
      uses: 1,
      newSessionExpireTime: new Date(now + 60_000).toISOString(),
      expireTime: new Date(now + VOICE_SESSION_MS + 60_000).toISOString(),
      liveConnectConstraints: {
        model: VOICE_MODEL,
        config: {
          systemInstruction: VOICE_PROMPT,
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: [SEARCH_SITE_DECLARATION, ...VERSO_TOOL_DECLARATIONS].map(
            ({ name, description, parameters }) => ({ name, description, parametersJsonSchema: parameters })) }],
        },
      },
      abortSignal: signal,
    } }), 8000, request.signal);
    if (!token.name) throw new Error('No token');
    return json({ token: token.name, expiresAt: new Date(now + VOICE_SESSION_MS + 60_000).toISOString() });
  } catch {
    console.error('[live-token] mint failed');
    return json({ error: UNAVAILABLE }, 503);
  }
};
