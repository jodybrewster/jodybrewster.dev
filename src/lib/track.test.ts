import { afterEach, describe, expect, it, vi } from 'vitest';
import { contactChannel, track } from './track';

describe('contactChannel', () => {
  it.each([
    ['mailto:jody@jodybrewster.dev', 'email'],
    ['https://www.linkedin.com/in/jodybrewster', 'linkedin'],
    ['https://github.com/jodybrewster', 'github'],
    ['https://www.behance.net/jodybrewster', 'behance'],
  ])('reads %s as %s', (href, channel) => expect(contactChannel(href)).toBe(channel));

  it.each(['https://jodybrewster.dev/work', 'https://notgithub.com/x', 'https://github.com.evil.io/', '/about', ''])(
    'ignores %j', href => expect(contactChannel(href)).toBeNull());
});

describe('track', () => {
  afterEach(() => { delete (globalThis as { gtag?: unknown }).gtag; });

  it('sends an event through gtag', () => {
    const gtag = vi.fn();
    (globalThis as { gtag?: unknown }).gtag = gtag;
    track('chat_new', { topic: 'work' });
    expect(gtag).toHaveBeenCalledWith('event', 'chat_new', { topic: 'work' });
  });

  it('does nothing without gtag, and never throws from it', () => {
    expect(() => track('chat_new')).not.toThrow();
    (globalThis as { gtag?: unknown }).gtag = () => { throw new Error('blocked'); };
    expect(() => track('chat_new')).not.toThrow();
  });
});
