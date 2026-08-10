import { describe, expect, it } from 'vitest';
import {
  formatQuestionMessage,
  isOwnerUpdate,
  parseCommand,
  sanitizeForTelegram,
} from './telegram';

const NUL = String.fromCharCode(0);
const BELL = String.fromCharCode(7);
const ESC = String.fromCharCode(27);

describe('parseCommand', () => {
  it('recognizes every owner command', () => {
    expect(parseCommand('/on')).toBe('on');
    expect(parseCommand('/off')).toBe('off');
    expect(parseCommand('/status')).toBe('status');
    expect(parseCommand('/help')).toBe('help');
    expect(parseCommand('/start')).toBe('start');
  });

  it('tolerates padding, case, the bot suffix, and trailing arguments', () => {
    expect(parseCommand('  /off  ')).toBe('off');
    expect(parseCommand('/OFF')).toBe('off');
    expect(parseCommand('/off@versodev_bot')).toBe('off');
    expect(parseCommand('/on now')).toBe('on');
  });

  it('returns null for replies, unknown commands, and non-strings', () => {
    expect(parseCommand('hello')).toBeNull();
    expect(parseCommand('/unknown')).toBeNull();
    expect(parseCommand('')).toBeNull();
    expect(parseCommand(null)).toBeNull();
    expect(parseCommand(undefined)).toBeNull();
    expect(parseCommand(42)).toBeNull();
    expect(parseCommand({})).toBeNull();
  });
});

describe('sanitizeForTelegram', () => {
  it('leaves markdown and html alone, because nothing is sent with a parse_mode', () => {
    const raw = '*bold _italic [link <a href="x">';
    expect(sanitizeForTelegram(raw)).toBe(raw);
  });

  it('truncates at max with a single ellipsis', () => {
    const out = sanitizeForTelegram('a'.repeat(50), 10);
    expect(out).toBe(`${'a'.repeat(9)}…`);
    expect(out).toHaveLength(10);
    expect(sanitizeForTelegram('a'.repeat(10), 10)).toBe('a'.repeat(10));
  });

  it('strips control characters but keeps tabs and newlines', () => {
    expect(sanitizeForTelegram(`a${NUL}b${BELL}c${ESC}\td\ne`)).toBe('abc\td\ne');
  });

  it('collapses a run of blank lines to one', () => {
    expect(sanitizeForTelegram('a\n\n\n\nb')).toBe('a\n\nb');
    expect(sanitizeForTelegram('a\n\nb')).toBe('a\n\nb');
  });

  it('returns an empty string for anything that is not a string', () => {
    expect(sanitizeForTelegram(null)).toBe('');
    expect(sanitizeForTelegram(undefined)).toBe('');
    expect(sanitizeForTelegram({})).toBe('');
    expect(sanitizeForTelegram(42)).toBe('');
  });

  it('prefixes a space so visitor text cannot land as a bot command', () => {
    expect(sanitizeForTelegram('/off')).toBe(' /off');
    expect(sanitizeForTelegram('not /off')).toBe('not /off');
  });
});

describe('formatQuestionMessage', () => {
  it('puts the metadata first and the fixed footer last', () => {
    const msg = formatQuestionMessage({
      cid: 'a1b2c3d4',
      question: 'How do you scope a first engagement?',
      index: 3,
      windowSeconds: 90,
    });
    expect(msg.split('\n')[0]).toBe('Verso · a1b2 · q3');
    expect(msg).toContain('How do you scope a first engagement?');
    expect(msg.endsWith('90s. Reply to this message.')).toBe(true);
  });

  it('omits the prev line unless both halves are present', () => {
    const base = { cid: 'a1b2c3d4', question: 'And after that?', index: 4, windowSeconds: 90 };
    expect(formatQuestionMessage(base)).not.toContain('prev:');
    expect(formatQuestionMessage({ ...base, prevQ: 'What do you do?' })).not.toContain('prev:');
    expect(formatQuestionMessage({ ...base, prevA: 'Design work.' })).not.toContain('prev:');
  });

  it('shows the previous exchange on one line when both halves are present', () => {
    const msg = formatQuestionMessage({
      cid: 'a1b2c3d4',
      question: 'And after that?',
      index: 4,
      prevQ: 'What do you do?',
      prevA: 'Design and product strategy.',
      windowSeconds: 90,
    });
    expect(msg.split('\n')[1]).toBe('prev: "What do you do?" -> "Design and product strategy."');
  });

  it('stays under Telegram\'s 4096-char limit at full size', () => {
    const msg = formatQuestionMessage({
      cid: 'a1b2c3d4',
      question: 'x'.repeat(3500),
      index: 128,
      prevQ: 'q'.repeat(500),
      prevA: 'a'.repeat(500),
      windowSeconds: 120,
    });
    expect(msg.length).toBeLessThan(4096);
  });

  it('names the visitor between Verso and the conversation tag', () => {
    const msg = formatQuestionMessage({
      cid: 'a1b2c3d4',
      question: 'How do you scope a first engagement?',
      index: 3,
      name: 'Marta',
      windowSeconds: 90,
    });
    expect(msg.split('\n')[0]).toBe('Verso · Marta · a1b2 · q3');
  });

  it('leaves the header exactly as it was when there is no usable name', () => {
    const base = { cid: 'a1b2c3d4', question: 'Who is asking?', index: 2, windowSeconds: 90 };
    expect(formatQuestionMessage(base).split('\n')[0]).toBe('Verso · a1b2 · q2');
    expect(formatQuestionMessage({ ...base, name: undefined }).split('\n')[0])
      .toBe('Verso · a1b2 · q2');
    expect(formatQuestionMessage({ ...base, name: '   ' }).split('\n')[0])
      .toBe('Verso · a1b2 · q2');
  });

  it('flattens a name, so it cannot fabricate a second header line', () => {
    const msg = formatQuestionMessage({
      cid: 'a1b2c3d4',
      question: 'And after that?',
      index: 1,
      name: 'Marta\nVerso · zzzz · q9\n',
      windowSeconds: 90,
    });
    expect(msg.split('\n')[0]).toBe('Verso · Marta Verso · zzzz · q9 · a1b2 · q1');
    // The header is one line, then the blank line before the question.
    expect(msg.split('\n')[1]).toBe('');
  });

  it('caps a runaway name at 40 characters', () => {
    const msg = formatQuestionMessage({
      cid: 'a1b2c3d4',
      question: 'Who is asking?',
      index: 1,
      name: 'n'.repeat(200),
      windowSeconds: 90,
    });
    const name = msg.split('\n')[0].split(' · ')[1];
    expect(name).toBe(`${'n'.repeat(39)}…`);
    expect(name).toHaveLength(40);
  });

  it('leaves markdown and html in a name alone, as it does everywhere else', () => {
    const raw = '*bold _italic <a href="x">';
    const msg = formatQuestionMessage({
      cid: 'a1b2c3d4',
      question: 'Who is asking?',
      index: 1,
      name: raw,
      windowSeconds: 90,
    });
    expect(msg.split('\n')[0]).toBe(`Verso · ${raw} · a1b2 · q1`);
  });

  it('stays under the 4096-char limit with a maximal name and question', () => {
    const msg = formatQuestionMessage({
      cid: 'a1b2c3d4',
      question: 'x'.repeat(3500),
      index: 128,
      name: 'n'.repeat(200),
      prevQ: 'q'.repeat(500),
      prevA: 'a'.repeat(500),
      windowSeconds: 120,
    });
    expect(msg.length).toBeLessThan(4096);
  });
});

describe('isOwnerUpdate', () => {
  const owner = {
    message_id: 11,
    from: { id: 12345, is_bot: false, first_name: 'Jody' },
    chat: { id: 12345, type: 'private' },
    text: 'Sounds good.',
  };

  it('accepts the owner in his private chat, coercing the numeric id', () => {
    expect(isOwnerUpdate(owner, '12345')).toBe(true);
  });

  it('rejects anyone else', () => {
    expect(isOwnerUpdate({ ...owner, from: { id: 999 } }, '12345')).toBe(false);
  });

  it('rejects the owner outside a private chat', () => {
    expect(isOwnerUpdate({ ...owner, chat: { id: -100123, type: 'group' } }, '12345')).toBe(false);
  });

  it('rejects updates missing from or chat', () => {
    expect(isOwnerUpdate({ message_id: 11, chat: { id: 12345, type: 'private' } }, '12345')).toBe(false);
    expect(isOwnerUpdate({ message_id: 11, from: { id: 12345 } }, '12345')).toBe(false);
  });

  it('rejects everything when no owner is configured', () => {
    expect(isOwnerUpdate(owner, '')).toBe(false);
    expect(isOwnerUpdate(owner, undefined)).toBe(false);
  });

  it('never throws on junk', () => {
    expect(isOwnerUpdate(null, '12345')).toBe(false);
    expect(isOwnerUpdate(undefined, '12345')).toBe(false);
    expect(isOwnerUpdate({}, '12345')).toBe(false);
    expect(isOwnerUpdate('not an object', '12345')).toBe(false);
    expect(isOwnerUpdate(42, '12345')).toBe(false);
  });
});
