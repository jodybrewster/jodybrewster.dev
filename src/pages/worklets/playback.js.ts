import { PLAYBACK_WORKLET_SOURCE } from '@jodybrewster/gemini-live/voice';

// The voice playback worklet as a same-origin file, built once. The site's
// policy allows scripts by hash or from this origin (no 'strict-dynamic'),
// so the bundle's default blob: worklet would be refused; src/lib/live/voice.ts
// passes these URLs as the session's audioWorklets.
export const prerender = true;

export const GET = () =>
  new Response(PLAYBACK_WORKLET_SOURCE, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
