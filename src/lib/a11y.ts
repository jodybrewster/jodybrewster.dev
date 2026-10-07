/**
 * Screen reader support for the chat dock: the parts that describe the
 * site's own dock. The announcers, sentence helpers and time warnings come
 * from `@jodybrewster/gemini-live/core`.
 */
import { MESSAGES } from '@jodybrewster/gemini-live/core';

/** Spoken at the thresholds scheduleTimeWarnings uses by default. */
export function voiceTimeWarning(msLeft: number): string {
  if (msLeft >= 60_000) return MESSAGES.voice_minute_left;
  const seconds = Math.round(msLeft / 1000);
  return seconds === 15 ? MESSAGES.voice_seconds_left : `${seconds} seconds of voice time left.`;
}

/** What the dock knows when a typed question is submitted. */
export interface AskState {
  requesting: boolean;
  /** Holding a question for Jody. */
  waiting: boolean;
  /** The mic was tapped and the session is still loading or connecting. */
  voiceStarting: boolean;
  /** The voice session's snapshot, once the voice code has loaded. */
  voice: { isConnected: boolean; connectionStatus: string } | null;
}

/** Whether a voice session is live or connecting. */
export function voiceActive({ voiceStarting, voice }: Pick<AskState, 'voiceStarting' | 'voice'>): boolean {
  return voiceStarting || Boolean(voice && (voice.isConnected || voice.connectionStatus === 'connecting'));
}

/**
 * A typed question runs only when nothing else is going on: no other request,
 * no wait for Jody and no voice session. The composer stays focusable
 * (aria-disabled, not disabled), so this check is what keeps a typed answer
 * and a voice session apart.
 */
export function canAsk(state: AskState): boolean {
  return !state.requesting && !state.waiting && !voiceActive(state);
}
