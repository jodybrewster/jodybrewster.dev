import { describe, expect, it } from 'vitest';
import { createAnnouncer } from '@jodybrewster/gemini-live/core';
import { canAsk, voiceActive, voiceTimeWarning, type AskState } from './a11y';

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

describe('createAnnouncer from the package, as the dock uses it', () => {
  it('builds its region from the document it is given and sets markup as text', () => {
    const parent = new FakeElement('div');
    const a = createAnnouncer(parent as unknown as HTMLElement, { doc: fakeDoc, politeness: 'assertive' });
    expect(parent.children[0].attrs['aria-live']).toBe('assertive');
    a.announce('<img src=x onerror=alert(1)> and <b>bold</b>');
    const node = parent.children[0].children[0];
    expect(node.tag).toBe('p');
    expect(node.text).toBe('<img src=x onerror=alert(1)> and <b>bold</b>');
    a.destroy();
  });
});

describe('voiceTimeWarning', () => {
  it('words each warning for the threshold that fired', () => {
    expect(voiceTimeWarning(60_000)).toBe('One minute of voice time left.');
    expect(voiceTimeWarning(15_000)).toBe('15 seconds of voice time left.');
    expect(voiceTimeWarning(30_000)).toBe('30 seconds of voice time left.');
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
