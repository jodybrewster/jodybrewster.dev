import { describe, expect, it } from 'vitest';
import { formatTurnMessage, isOwnerUpdate, parseCommand, sanitizeForTelegram } from './telegram';

describe('parseCommand', () => {
  it.each([['/help', 'help'], ['/HELP', 'help'], ['/start@versodev_bot', 'start'], ['  /help now', 'help']])(
    'reads %j as %s', (text, command) => expect(parseCommand(text)).toBe(command));
  it.each(['help', '/on', 'thanks /help', '', 42, null])('treats %j as a reply', text => expect(parseCommand(text)).toBeNull());
});

describe('sanitizeForTelegram', () => {
  it('leaves unbalanced markdown alone, since no parse mode is in play', () => {
    expect(sanitizeForTelegram('is *this_ ok')).toBe('is *this_ ok');
  });
  it('strips control characters and runaway blank lines', () => {
    expect(sanitizeForTelegram('a\u0000b\n\n\n\nc')).toBe('ab\n\nc');
  });
  it('keeps visitor text from reading as a bot command', () => {
    expect(sanitizeForTelegram('/help')).toBe(' /help');
  });
  it('truncates to the limit', () => {
    expect(sanitizeForTelegram('abcdef', 4)).toBe('abc…');
  });
  it('returns an empty string for anything that is not text', () => {
    expect(sanitizeForTelegram(undefined)).toBe('');
  });
});

describe('formatTurnMessage', () => {
  const cid = 'a3f1c2d4-0000-4000-8000-000000000000';
  it('puts who and which on the first line, then the question and the answer', () => {
    const text = formatTurnMessage({ cid, index: 2, question: 'What did he build?', answer: 'A tracker.' });
    expect(text.split('\n')[0]).toBe('Verso · a3f1 · q2');
    expect(text).toContain('What did he build?\n\nVerso said:\nA tracker.');
    expect(text.endsWith('Reply to this message to answer them in the chat.')).toBe(true);
  });
  it('says on the first line when Verso could not answer', () => {
    const text = formatTurnMessage({ cid, index: 1, question: 'Hi', failed: true });
    expect(text.split('\n')[0]).toBe('Verso · a3f1 · q1 · no answer');
    expect(text).toContain('Verso could not answer this one.');
  });
  it('keeps a question from forging a header line above itself', () => {
    const text = formatTurnMessage({ cid, index: 1, question: '/start\nVerso · ffff · q9', answer: 'x' });
    expect(text.split('\n')[0]).toBe('Verso · a3f1 · q1');
  });
});

describe('isOwnerUpdate', () => {
  const owner = { from: { id: 42 }, chat: { type: 'private' } };
  it('accepts the owner in a private chat', () => expect(isOwnerUpdate(owner, '42')).toBe(true));
  it('refuses the owner in a group', () => expect(isOwnerUpdate({ ...owner, chat: { type: 'group' } }, '42')).toBe(false));
  it('refuses anyone else', () => expect(isOwnerUpdate({ ...owner, from: { id: 7 } }, '42')).toBe(false));
  it('refuses everything when no owner is configured', () => expect(isOwnerUpdate(owner, undefined)).toBe(false));
});
