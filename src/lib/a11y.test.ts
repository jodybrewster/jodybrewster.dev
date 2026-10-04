import { describe, expect, it, vi } from 'vitest';
import {
  canAsk, createAnnouncer, createStreamAnnouncer, lastSentenceEnd, scheduleTimeWarnings, speakable, voiceActive, voiceTimeWarning,
  type AskState, type Clock,
} from './a11y';

function stream(deltas: string[], opts?: Parameters<typeof createStreamAnnouncer>[1]) {
  const said: string[] = [];
  const a = createStreamAnnouncer(t => said.push(t), opts);
  let text = '';
  for (const d of deltas) { text += d; a.update(text); }
  a.end(text);
  return said;
}

describe('lastSentenceEnd', () => {
  it('ends at sentence marks followed by space and at line breaks', () => {
    expect(lastSentenceEnd('One. Two! Thr')).toBe(9);
    expect(lastSentenceEnd('A list\n- item')).toBe(7);
    expect(lastSentenceEnd('He said "hi." Then')).toBe(13);
  });
  it('does not end at decimals, domains or a final mark with nothing after it yet', () => {
    expect(lastSentenceEnd('Costs 3.5 dollars at example.com')).toBe(0);
    expect(lastSentenceEnd('Done.')).toBe(0);
  });
});

describe('speakable', () => {
  it('drops markdown and keeps the words', () => {
    expect(speakable('## Title\n- **bold** and `code`, see [docs](https://x.y)')).toBe('Title bold and code, see docs');
    expect(speakable('Run:\n```sh\nrm -rf /\n```\nthen stop.')).toBe('Run: code block then stop.');
  });
});

describe('createStreamAnnouncer', () => {
  it('announces each sentence once, however the deltas split it', () => {
    expect(stream(['Hel', 'lo there. How', ' are', ' you? I\'m', ' fine'])).toEqual(['Hello there.', 'How are you?', 'I\'m fine']);
  });
  it('never repeats text as the answer grows', () => {
    const said = stream('The quick brown fox. Jumps over the lazy dog. The end'.split(''));
    expect(said).toEqual(['The quick brown fox.', 'Jumps over the lazy dog.', 'The end']);
  });
  it('stops after maxChars with one line saying the rest is on screen', () => {
    const said = stream(['One two three. ', 'Four five six. ', 'Seven eight nine.'], { maxChars: 30, truncated: 'More on screen.' });
    expect(said).toEqual(['One two three.', 'Four five six.', 'More on screen.']);
  });
  it('says the default truncation line once', () => {
    const said = stream([`${'word '.repeat(300)}end. `, 'More text. ', 'Even more.']);
    expect(said.filter(line => line === 'The rest of the answer is on screen.')).toHaveLength(1);
  });
  it('starts over after reset and when the text is replaced', () => {
    const said: string[] = [];
    const a = createStreamAnnouncer(t => said.push(t));
    a.update('First answer. ');
    a.reset();
    a.update('Second. ');
    a.update('New');
    a.end('New text.');
    expect(said).toEqual(['First answer.', 'Second.', 'New text.']);
  });
});

/** The few DOM parts the announcer touches. innerHTML throws, so any use of it fails the test. */
class FakeElement {
  children: FakeElement[] = [];
  attrs: Record<string, string> = {};
  dataset: Record<string, string> = {};
  style = { cssText: '' };
  parent: FakeElement | null = null;
  text = '';
  constructor(readonly tag: string) {}
  get isConnected(): boolean { return this.parent !== null; }
  get childElementCount(): number { return this.children.length; }
  get firstElementChild(): FakeElement | null { return this.children[0] ?? null; }
  get textContent(): string { return this.text; }
  set textContent(value: string) { this.text = value; }
  set innerHTML(_: string) { throw new Error('announcer must not parse HTML'); }
  setAttribute(name: string, value: string): void { this.attrs[name] = value; }
  appendChild(child: FakeElement): FakeElement { child.parent = this; this.children.push(child); return child; }
  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter(c => c !== this);
    this.parent = null;
  }
}
const fakeDoc = { createElement: (tag: string) => new FakeElement(tag) } as unknown as Document;
const asParent = (el: FakeElement) => el as unknown as HTMLElement;

describe('createAnnouncer', () => {
  it('appends one node per announcement, as a polite region by default', () => {
    const parent = new FakeElement('div');
    const a = createAnnouncer(asParent(parent), { doc: fakeDoc });
    const region = parent.children[0];
    expect(region.attrs['aria-live']).toBe('polite');
    expect(region.attrs['aria-relevant']).toBe('additions');
    a.announce('First.');
    a.announce('First.');
    expect(region.children.map(c => c.text)).toEqual(['First.', 'First.']);
  });

  it('sets markup as text, never parses it as HTML', () => {
    const parent = new FakeElement('div');
    const a = createAnnouncer(asParent(parent), { doc: fakeDoc });
    a.announce('<img src=x onerror=alert(1)> and <b>bold</b>');
    const node = parent.children[0].children[0];
    expect(node.tag).toBe('p');
    expect(node.text).toBe('<img src=x onerror=alert(1)> and <b>bold</b>');
    expect(node.children).toHaveLength(0);
  });

  it('can be assertive, prunes old lines and removes itself', () => {
    vi.useFakeTimers();
    const parent = new FakeElement('div');
    const a = createAnnouncer(asParent(parent), { doc: fakeDoc, politeness: 'assertive', keepMs: 1000 });
    const region = parent.children[0];
    expect(region.attrs['aria-live']).toBe('assertive');
    for (let i = 0; i < 25; i++) a.announce(`Line ${i}`);
    expect(region.childElementCount).toBe(20);
    vi.advanceTimersByTime(1000);
    expect(region.childElementCount).toBe(0);
    a.destroy();
    expect(parent.childElementCount).toBe(0);
    vi.useRealTimers();
  });

  it('ignores empty text', () => {
    const parent = new FakeElement('div');
    createAnnouncer(asParent(parent), { doc: fakeDoc }).announce('   ');
    expect(parent.children[0].childElementCount).toBe(0);
  });
});

function fakeClock(start: number) {
  let now = start;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let id = 0;
  const clock: Clock = {
    now: () => now,
    setTimeout: (fn, ms) => (timers.push({ at: now + ms, fn, id: ++id }), id),
    clearTimeout: h => {
      const i = timers.findIndex(t => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    timers.filter(t => t.at <= now).forEach(t => (timers.splice(timers.indexOf(t), 1), t.fn()));
  };
  return { clock, advance };
}

describe('scheduleTimeWarnings', () => {
  it('warns one minute and 15 seconds before the end', () => {
    const { clock, advance } = fakeClock(0);
    const warned: number[] = [];
    scheduleTimeWarnings(300_000, ms => warned.push(ms), undefined, clock);
    advance(239_999);
    expect(warned).toEqual([]);
    advance(1);
    expect(warned).toEqual([60_000]);
    advance(45_000);
    expect(warned).toEqual([60_000, 15_000]);
  });
  it('skips thresholds already passed and stops when cancelled', () => {
    const { clock, advance } = fakeClock(0);
    const warned: number[] = [];
    const cancel = scheduleTimeWarnings(30_000, ms => warned.push(ms), undefined, clock);
    cancel();
    advance(30_000);
    expect(warned).toEqual([]);
    scheduleTimeWarnings(60_000, ms => warned.push(ms), undefined, clock);
    advance(30_000);
    expect(warned).toEqual([15_000]);
  });
  it('words each warning for the threshold that fired', () => {
    expect(voiceTimeWarning(60_000)).toBe('One minute of voice time left.');
    expect(voiceTimeWarning(15_000)).toBe('15 seconds of voice time left.');
  });
});

describe('canAsk', () => {
  const idle: AskState = { requesting: false, waiting: false, voiceStarting: false, voice: null };
  const snapshot = (isConnected: boolean, connectionStatus: string) => ({ isConnected, connectionStatus });

  it('allows a question when nothing else is running', () => {
    expect(canAsk(idle)).toBe(true);
    expect(canAsk({ ...idle, voice: snapshot(false, 'disconnected') })).toBe(true);
  });
  it('refuses while a voice session is live, connecting or being started', () => {
    expect(canAsk({ ...idle, voice: snapshot(true, 'connected') })).toBe(false);
    expect(canAsk({ ...idle, voice: snapshot(false, 'connecting') })).toBe(false);
    expect(canAsk({ ...idle, voiceStarting: true })).toBe(false);
    expect(voiceActive({ voiceStarting: false, voice: snapshot(true, 'connected') })).toBe(true);
  });
  it('refuses a second question and one asked while waiting for Jody', () => {
    expect(canAsk({ ...idle, requesting: true })).toBe(false);
    expect(canAsk({ ...idle, waiting: true })).toBe(false);
  });
});
