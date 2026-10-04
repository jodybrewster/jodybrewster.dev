import type { APIRoute } from 'astro';
import { Modality } from '@google/genai';
import { voiceTokenRouteFromEnv, type VoiceTokenRouteOptions } from '@jodybrewster/gemini-live/server';
import { createSwitches } from '@jodybrewster/gemini-live/server/switches';
import { VOICE_MODEL, VOICE_NAME, VOICE_PROMPT, VOICE_SESSION_MS, SEARCH_SITE_DECLARATION } from '../../lib/verso-voice';
import { VERSO_TOOL_DECLARATIONS } from '../../lib/verso-tools';
import { env } from '../../lib/env';
import { flags } from '../../lib/flags';
import { isCanonicalHost, otherHost } from '../../lib/origin';
import { audit, auditRefusal, auditSwitchChanges } from '../../lib/audit';

export const prerender = false;

/**
 * Mints a single-use Gemini Live token for one voice session, through the
 * framework's handler (`createVoiceTokenHandler`, M1 1.4) with the site's
 * settings.
 *
 * The browser talks to Google directly, so this token is the only lever the
 * site has over what a session can do. It is locked to Verso's model, prompt
 * and tools, it can open one session within a minute, and it dies a minute
 * after the session cap. `lockAdditionalFields` stays unset on purpose: that
 * locks the whole config, and it is the only form Google accepts with `tools`
 * in it (`[]` fails with "field_mask is invalid"). The cost is that the
 * client's own activity-detection settings are ignored for server defaults.
 *
 * The handler checks the origin (the site's own, plus the preview URL on a
 * preview), caps sessions at 3 per visitor and 40 site-wide per UTC day on
 * Upstash (the visitor is Vercel's client IP, IPv6 by /64), refuses with 503
 * when Redis or the key is missing or the store fails, and obeys the voice
 * switch, which comes from SWITCH_VOICE alone (off or force-off; nothing in
 * Redis can change it).
 */

const SITE_ORIGINS = ['https://jodybrewster.dev', 'https://www.jodybrewster.dev'];
const DEV_ORIGINS = ['http://localhost:4321', 'http://127.0.0.1:4321'];
const KEYS = [
  'GEMINI_API_KEY', 'NODE_ENV', 'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_BRANCH_URL',
  'RATE_LIMIT_STORE', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
  'VOICE_ALLOWED_ORIGINS', 'VOICE_SESSIONS_PER_VISITOR_PER_DAY', 'VOICE_SESSIONS_PER_DAY', 'SWITCH_VOICE',
] as const;

type Env = Record<string, string | undefined>;

/**
 * The environment the handler reads, from Astro's and Vercel's sources, with
 * the site's defaults: on Vercel the limit store is Upstash and the allowed
 * origins are the site's own (plus this preview's URLs on a preview); in
 * `astro dev` NODE_ENV is development, so the handler allows the dev origins
 * and keeps counts in memory.
 */
export function voiceEnv(read: (key: string) => string | undefined = env): Env {
  const out: Env = Object.fromEntries(KEYS.map(key => [key, read(key)]));
  out.NODE_ENV ??= import.meta.env.DEV ? 'development' : 'production';
  if (out.VERCEL) {
    out.RATE_LIMIT_STORE ??= 'upstash';
    const preview = out.VERCEL_ENV === 'production' ? [] : [out.VERCEL_URL, out.VERCEL_BRANCH_URL].filter(Boolean).map(host => `https://${host}`);
    out.VOICE_ALLOWED_ORIGINS ??= [...SITE_ORIGINS, ...preview].join(',');
  }
  return out;
}

const constraints = () => ({
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
});

/** The route, built from an environment; `mint` stands in for Google in tests. */
export function createLiveTokenRoute(source: Env, mint?: VoiceTokenRouteOptions['mint']): (req: Request) => Promise<Response> {
  const voice = createSwitches({ env: source });
  return voiceTokenRouteFromEnv({
    app: 'site',
    constraints,
    sessionMs: VOICE_SESSION_MS,
    devOrigins: DEV_ORIGINS,
    perVisitorPerDay: 3,
    sitePerDay: 40,
    enabled: () => voice.isOn('voice'),
    env: source,
    mint,
  });
}

let route: ((req: Request) => Promise<Response>) | null = null;
const handle: APIRoute = async ({ request }) => {
  if (!flags.chat) return new Response('Not found', { status: 404 });
  if (!isCanonicalHost(request)) return otherHost();
  await auditSwitchChanges();
  route ??= createLiveTokenRoute(voiceEnv());
  const response = await route(request);
  // A minted token, or a refusal (throttled), never the visitor's address.
  if (request.method === 'POST') {
    if (response.ok) await audit({ action: 'voice.token', outcome: 'allow' });
    else await auditRefusal('voice.token', String(response.status));
  }
  return response;
};

export const POST = handle;
export const OPTIONS = handle;
