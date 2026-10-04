/**
 * Renders the voice session into the dock's conversation: what the visitor
 * said, what Verso said, and the cards it showed, in the order they happened.
 *
 * The session's message list only ever grows, and a transcript streams in as
 * fragments merged into its last message, so rendering is: create an element
 * for each new message, and refresh the text of the last one. Voice turns are
 * never sent to the server; the text chat cannot see them (see CLAUDE.md).
 */

import type { ChatMessage, SessionSnapshot } from '@jodybrewster/gemini-live/voice';
import type { Card } from '../verso-tools';
import { renderCard } from '../card-render';

export interface VoiceDockHooks {
  dock: HTMLElement;
  conversation: HTMLElement;
  appendTemplate: (id: string) => HTMLElement;
  beforeRender: () => void;
  scroll: () => void;
  /** go_to_page: the visitor asked to be taken somewhere. */
  navigate: (url: string) => void;
}

/** Why a session could not start or ended early, in words a visitor can act on. */
export function voiceErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'The microphone is blocked. Allow it for this site to talk, or keep typing.';
  if (name === 'NotFoundError') return 'No microphone found. You can keep typing.';
  if (/\b429\b/.test(message)) return 'That is all the voice time for today. You can keep typing.';
  // Switched off (SWITCH_VOICE) or briefly unavailable: the token route answers 503 for both.
  if (/\b503\b/.test(message)) return 'Voice is paused right now. You can keep typing.';
  return 'Voice could not start. You can keep typing.';
}

export function endedMessage(reason: SessionSnapshot['endReason']): string | null {
  if (reason === 'limit') return 'Voice sessions end after five minutes. Tap the mic to start another.';
  if (reason === 'goAway' || reason === 'closed' || reason === 'error') return 'The voice session ended. Tap the mic to start another.';
  return null;
}

export function createVoiceRenderer(hooks: VoiceDockHooks) {
  let rendered = 0;
  let lastNode: HTMLElement | null = null;
  let lastType: ChatMessage['type'] | null = null;
  let siteTurn: HTMLElement | null = null;
  let siteHasText = false;

  function newSiteTurn(): HTMLElement {
    const turn = hooks.appendTemplate('#tpl-site');
    turn.querySelector('.answer')!.replaceChildren();
    siteTurn = turn; siteHasText = false;
    return turn;
  }

  function render(message: ChatMessage): void {
    if (message.type === 'user-transcript' || message.type === 'user') {
      const turn = hooks.appendTemplate('#tpl-you');
      lastNode = turn.querySelector<HTMLElement>('.said');
      lastNode!.textContent = message.text.trim();
      siteTurn = null;
    } else if (message.type === 'assistant') {
      // A card that opened this turn already made the turn; its words join it.
      const turn = siteTurn && !siteHasText ? siteTurn : newSiteTurn();
      lastNode = turn.querySelector<HTMLElement>('.answer');
      lastNode!.textContent = message.text.trim();
      siteHasText = true;
    } else if (message.type === 'tool-ui' && message.toolData) {
      const data = message.toolData as unknown as Card;
      if (data.kind === 'navigate') hooks.navigate(data.url);
      const card = renderCard(hooks.dock, data);
      if (!card) return;
      const turn = siteTurn ?? newSiteTurn();
      turn.querySelector('.said')!.append(card);
      lastNode = null;
    }
    lastType = message.type;
  }

  return {
    /** Forget earlier sessions' messages, e.g. after New chat cleared the DOM. */
    reset(messages: readonly ChatMessage[]): void {
      rendered = messages.length; lastNode = null; lastType = null; siteTurn = null; siteHasText = false;
    },
    update(messages: readonly ChatMessage[]): void {
      if (messages.length < rendered) this.reset(messages);
      let changed = false;
      // The last message keeps growing while it streams.
      const last = messages[rendered - 1];
      if (last && lastNode && last.type === lastType && (last.type === 'assistant' || last.type === 'user-transcript')) {
        const text = last.text.trim();
        if (lastNode.textContent !== text) { lastNode.textContent = text; changed = true; }
      }
      if (rendered < messages.length) hooks.beforeRender();
      for (; rendered < messages.length; rendered++) {
        const message = messages[rendered];
        if (message.type === 'system') continue;
        render(message); changed = true;
      }
      if (changed) hooks.scroll();
    },
  };
}
