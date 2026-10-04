/**
 * Verso's voice mode in the browser: one Gemini Live session per page load,
 * held at module scope so it survives Astro's soft navigation the same way the
 * dock's DOM does. Nothing here touches the DOM; the dock subscribes to the
 * session and renders from its snapshot (src/lib/live/voice-dock.ts).
 *
 * The token route locks model, prompt and tools server-side, so the config
 * below only has to agree with it. It is still sent in full because the
 * client builds its setup message and tool dispatch table from it.
 */

import {
  GeminiLiveSession, createFunctionTool,
  type FunctionTool, type GeminiLiveConfig,
} from '@jodybrewster/gemini-live/voice';
import { VERSO_TOOL_DECLARATIONS, resolveCard, type CardIndex } from '../verso-tools';
import { SEARCH_SITE_DECLARATION, VOICE_MODEL, VOICE_NAME, VOICE_PROMPT, VOICE_SESSION_MS } from '../verso-voice';

export interface CorpusResult { type: string; slug: string; title: string; url: string; text: string }
export interface VoiceToolDeps {
  searchSite: (query: string) => Promise<CorpusResult[]>;
  cardIndex: () => Promise<CardIndex>;
}

type Declaration = { name: string; description: string; parameters: { properties?: Record<string, unknown>; required?: readonly string[] } };
const tool = (declaration: Declaration, run: (args: Record<string, unknown>) => Promise<unknown>, render: boolean): FunctionTool =>
  createFunctionTool(declaration.name, declaration.description,
    { ...(declaration.parameters.properties ?? {}) }, [...(declaration.parameters.required ?? [])], run, { render });

/**
 * `search_site` feeds the model and never renders. The show_* tools render the
 * card they resolve and decline (null, so nothing renders) when the model
 * names a slug that doesn't exist; the model hears which happened.
 */
export function createVoiceTools(deps: VoiceToolDeps): FunctionTool[] {
  const search = tool(SEARCH_SITE_DECLARATION, async args => {
    const query = typeof args.query === 'string' ? args.query.trim().slice(0, 600) : '';
    if (!query) return { results: [] };
    return { results: await deps.searchSite(query) };
  }, false);
  const cards = VERSO_TOOL_DECLARATIONS.map(declaration => tool(declaration as Declaration, async args =>
    resolveCard(await deps.cardIndex(), declaration.name, args), true));
  return [search, ...cards];
}

export function createVoiceConfig(functions: FunctionTool[]): GeminiLiveConfig {
  return {
    model: VOICE_MODEL,
    systemInstructions: VOICE_PROMPT,
    voiceName: VOICE_NAME,
    temperature: 0.7,
    googleGrounding: false,
    inputAudioTranscription: true,
    outputAudioTranscription: true,
    activityHandling: 'ACTIVITY_HANDLING_UNSPECIFIED',
    automaticActivityDetection: {
      disabled: false,
      silence_duration_ms: 600,
      prefix_padding_ms: 300,
      end_of_speech_sensitivity: 'END_SENSITIVITY_UNSPECIFIED',
      start_of_speech_sensitivity: 'START_SENSITIVITY_UNSPECIFIED',
    },
    functions,
  };
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return await res.json() as T;
}

let index: Promise<CardIndex> | null = null;
const browserDeps: VoiceToolDeps = {
  searchSite: async query => (await postJson<{ results: CorpusResult[] }>('/api/corpus', { query })).results,
  cardIndex: () => {
    index ??= fetch('/verso-cards.json').then(res => {
      if (!res.ok) throw new Error('card index unavailable');
      return res.json() as Promise<CardIndex>;
    });
    // A failed fetch must not poison every later card for the session.
    index.catch(() => { index = null; });
    return index;
  },
};

let session: GeminiLiveSession | null = null;
export function voiceSession(): GeminiLiveSession {
  // The audio worklets load from this origin (src/pages/worklets/): the
  // security policy allows scripts by hash or from the site, not blob: URLs.
  session ??= new GeminiLiveSession({
    tokenEndpoint: '/api/live-token',
    maxSessionMs: VOICE_SESSION_MS,
    systemMessages: false,
    audioWorklets: { playback: '/worklets/playback.js', capture: '/worklets/capture.js' },
  });
  return session;
}

/**
 * Start talking. Must be called from the click handler itself: iOS only lets
 * an AudioContext start inside the user gesture, so the unlock happens before
 * the first await.
 */
export async function startVoice(): Promise<void> {
  const live = voiceSession();
  live.unlockAudio();
  if (!live.getSnapshot().isConnected) await live.connect(createVoiceConfig(createVoiceTools(browserDeps)));
  if (!live.getSnapshot().media.audio.isStreaming) await live.toggleAudio();
}

export function stopVoice(): void {
  session?.disconnect();
}
