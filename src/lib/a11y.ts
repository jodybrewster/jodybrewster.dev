/**
 * Screen reader support for the chat dock.
 *
 * A site copy of the stream announcer in the gemini-live monorepo's a11y
 * package (the site cannot import it until it ships). Keep the two in step.
 *
 * The visible answer keeps growing in a log that is not live (aria-live="off"),
 * so it is never re-read word by word. What a screen reader hears comes from
 * here instead: a visually hidden polite region that gets each complete
 * sentence once. Text always goes in through textContent, never innerHTML, so
 * markup in a model answer is read as characters and never parsed.
 */

/** Plain words for speech: markdown markers and runs of whitespace removed. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, ' code block ') // code is read on screen
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images: their alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links: their text
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+[.)])\s+/gm, '') // headings, list markers
    .replace(/[*_`~>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The end of the last complete sentence after `from`: a sentence mark
 * followed by whitespace, or a line break. "3.5" and "example.com" do not
 * end a sentence. Returns `from` when there is none yet.
 */
export function lastSentenceEnd(text: string, from = 0): number {
  let end = from;
  const boundary = /[.!?…]+["')\]]*(?=\s)|\n/g;
  boundary.lastIndex = from;
  for (let m = boundary.exec(text); m; m = boundary.exec(text)) end = m.index + m[0].length;
  return end;
}

export interface StreamAnnouncerOptions {
  /** Stop announcing an answer after this many characters (default 1200). */
  maxChars?: number;
  /** Said once when an answer passes maxChars. */
  truncated?: string;
}

export interface StreamAnnouncer {
  /** Pass the whole answer so far, on every delta. */
  update(text: string): void;
  /** The answer is complete: announce whatever is left. */
  end(text: string): void;
  /** A new turn, or the visitor interrupted. */
  reset(): void;
}

export function createStreamAnnouncer(
  announce: (text: string) => void,
  { maxChars = 1200, truncated = 'The rest of the answer is on screen.' }: StreamAnnouncerOptions = {},
): StreamAnnouncer {
  let spoken = 0; // characters of the answer already handled
  let said = 0; // characters announced, against maxChars
  let capped = false;

  const emit = (raw: string) => {
    if (capped) return;
    const words = speakable(raw);
    if (!words) return;
    if (said + words.length > maxChars) {
      capped = true;
      announce(truncated);
      return;
    }
    said += words.length;
    announce(words);
  };

  return {
    update(text) {
      if (text.length < spoken) spoken = 0; // replaced, not grown
      const end = lastSentenceEnd(text, spoken);
      if (end > spoken) {
        emit(text.slice(spoken, end));
        spoken = end;
      }
    },
    end(text) {
      if (text.length < spoken) spoken = 0;
      if (text.length > spoken) emit(text.slice(spoken));
      spoken = text.length;
    },
    reset() {
      spoken = 0;
      said = 0;
      capped = false;
    },
  };
}

export interface Announcer {
  /** Speaks `text` (set as plain text, never HTML). */
  announce(text: string): void;
  /** Removes the live region. */
  destroy(): void;
}

export interface AnnouncerOptions {
  /** "assertive" interrupts; keep it for errors. Default "polite". */
  politeness?: 'polite' | 'assertive';
  /** How long an announcement stays in the region before it is pruned (ms). */
  keepMs?: number;
  /** Where the elements come from; the page's document unless a test passes its own. */
  doc?: Pick<Document, 'createElement'>;
}

// Visually hidden but read by screen readers (the usual sr-only recipe).
const HIDDEN = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';

/**
 * One visually hidden live region. Each announcement is appended as a new
 * node (aria-relevant="additions"), so sentences arriving quickly queue up
 * instead of replacing one another, and a repeated message is still spoken.
 * Old nodes are pruned so the region never grows.
 */
export function createAnnouncer(parent: HTMLElement, { politeness = 'polite', keepMs = 10_000, doc = document }: AnnouncerOptions = {}): Announcer {
  const region = doc.createElement('div');
  region.setAttribute('aria-live', politeness);
  region.setAttribute('aria-relevant', 'additions');
  region.setAttribute('aria-atomic', 'false');
  region.dataset.announcer = politeness;
  region.style.cssText = HIDDEN;
  parent.appendChild(region);
  const timers = new Set<ReturnType<typeof setTimeout>>();

  return {
    announce(text) {
      const line = text.trim();
      if (!line || !region.isConnected) return;
      const node = doc.createElement('p');
      node.textContent = line;
      region.appendChild(node);
      while (region.childElementCount > 20) region.firstElementChild?.remove();
      const t = setTimeout(() => {
        node.remove();
        timers.delete(t);
      }, keepMs);
      timers.add(t);
    },
    destroy() {
      timers.forEach(clearTimeout);
      region.remove();
    },
  };
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * Calls `onWarn(msLeft)` at each threshold before `endsAt` (a session's
 * epoch-ms end, such as the voice session snapshot's endsAt). Thresholds
 * already passed are skipped. Returns a cancel function; call it when the
 * session ends or endsAt changes.
 */
export function scheduleTimeWarnings(
  endsAt: number,
  onWarn: (msLeft: number) => void,
  at: readonly number[] = [60_000, 15_000],
  clock: Clock = realClock,
): () => void {
  const handles = at
    .filter((msLeft) => endsAt - msLeft > clock.now())
    .map((msLeft) => clock.setTimeout(() => onWarn(msLeft), endsAt - msLeft - clock.now()));
  return () => handles.forEach((h) => clock.clearTimeout(h));
}

/** Spoken at the thresholds scheduleTimeWarnings uses by default. */
export function voiceTimeWarning(msLeft: number): string {
  return msLeft >= 60_000 ? 'One minute of voice time left.' : `${Math.round(msLeft / 1000)} seconds of voice time left.`;
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
