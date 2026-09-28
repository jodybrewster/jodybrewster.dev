import { describe, expect, it } from 'vitest';
import {
  MAX_HISTORY_CHARS,
  MAX_HISTORY_TURNS,
  buildMessages,
  isValidConversationId,
  normalizeTurns,
  retrievalQuery,
  type ConversationTurn,
} from './verso';

const turn = (r: 'u' | 'a', t: string, ts = 0): ConversationTurn => ({ r, t, ts });

/** The one text part every prompt message carries. */
const text = (message: { parts: [{ text: string }] }): string => message.parts[0].text;

describe('isValidConversationId', () => {
  it('accepts a canonical UUID', () => {
    expect(isValidConversationId(crypto.randomUUID())).toBe(true);
    expect(isValidConversationId('3F2504E0-4F89-11D3-9A0C-0305E82C3301')).toBe(true);
  });

  it('rejects anything that could reshape a Redis key', () => {
    expect(isValidConversationId('')).toBe(false);
    expect(isValidConversationId('*')).toBe(false);
    expect(isValidConversationId('a:b')).toBe(false);
    expect(isValidConversationId('x'.repeat(200))).toBe(false);
    expect(isValidConversationId(null)).toBe(false);
    expect(isValidConversationId(undefined)).toBe(false);
    expect(isValidConversationId(123)).toBe(false);
    expect(isValidConversationId({})).toBe(false);
  });

  it('rejects a UUID with anything appended', () => {
    expect(isValidConversationId(`${crypto.randomUUID()}:latest`)).toBe(false);
  });
});

describe('normalizeTurns', () => {
  it('folds consecutive same-role turns into one', () => {
    const turns = normalizeTurns([
      turn('u', 'first'),
      turn('u', 'second'),
      turn('a', 'answer'),
    ]);
    expect(turns.map(entry => entry.r)).toEqual(['u', 'a']);
    expect(turns[0].t).toBe('first\n\nsecond');
  });

  it('drops a leading assistant turn', () => {
    const turns = normalizeTurns([turn('a', 'greeting'), turn('u', 'ask'), turn('a', 'answer')]);
    expect(turns.map(entry => entry.t)).toEqual(['ask', 'answer']);
  });

  it('drops a trailing question that was never answered', () => {
    const turns = normalizeTurns([turn('u', 'ask'), turn('a', 'answer'), turn('u', 'aborted')]);
    expect(turns.map(entry => entry.t)).toEqual(['ask', 'answer']);
  });

  it('returns nothing when the log holds only one side of an exchange', () => {
    expect(normalizeTurns([turn('u', 'ask')])).toEqual([]);
    expect(normalizeTurns([turn('a', 'answer')])).toEqual([]);
    expect(normalizeTurns([])).toEqual([]);
  });

  it('never throws on junk and keeps the real turns', () => {
    const turns = normalizeTurns([
      null,
      'not an object',
      42,
      turn('u', 'ask'),
      { r: 'a', t: '   ', ts: 0 },
      { r: 'x', t: 'bad role', ts: 0 },
      turn('a', 'answer'),
      { r: 'u', ts: 0 },
    ] as unknown as ConversationTurn[]);
    expect(turns.map(entry => entry.t)).toEqual(['ask', 'answer']);
  });

  it('drops fields a stored turn should not carry', () => {
    const stored = { r: 'a', t: 'answer', ts: 1, by: 'human' } as unknown as ConversationTurn;
    const turns = normalizeTurns([turn('u', 'ask'), stored]);
    expect(turns[1]).toEqual({ r: 'a', t: 'answer', ts: 1 });
  });
});

describe('retrievalQuery', () => {
  it('returns the query untouched when nothing came before it', () => {
    expect(retrievalQuery([], 'what is runtime design?')).toBe('what is runtime design?');
    expect(retrievalQuery([turn('a', 'answer')], 'follow up')).toBe('follow up');
  });

  it('prepends the last question so a bare follow-up has something to match', () => {
    const history = [turn('u', 'which essays cover evaluation?'), turn('a', 'three of them')];
    expect(retrievalQuery(history, 'what about the second one?')).toBe(
      'which essays cover evaluation?\nwhat about the second one?',
    );
  });

  it('reaches past the assistant to the most recent question', () => {
    const history = [
      turn('u', 'first question'),
      turn('a', 'first answer'),
      turn('u', 'second question'),
      turn('a', 'second answer'),
    ];
    expect(retrievalQuery(history, 'and?')).toBe('second question\nand?');
  });
});

describe('buildMessages', () => {
  const BLOCK = '[Source 1] (writing) "Runtime is the new design surface"\nbody text';

  it('alternates strictly and closes on the question being asked', () => {
    const messages = buildMessages(
      [turn('u', 'one'), turn('a', 'two'), turn('u', 'three'), turn('a', 'four')],
      'five',
      BLOCK,
    );
    expect(messages.map(message => message.role)).toEqual([
      'user', 'model', 'user', 'model', 'user',
    ]);
    expect(text(messages[messages.length - 1])).toBe(
      `Question: five\n\nExcerpts from Jody's published writing:\n\n${BLOCK}`,
    );
  });

  it('keeps only the last six turns', () => {
    const history = Array.from({ length: 10 }, (_, i) =>
      turn(i % 2 === 0 ? 'u' : 'a', `turn ${i}`, i));
    const messages = buildMessages(history, 'now', BLOCK);
    expect(messages).toHaveLength(MAX_HISTORY_TURNS + 1);
    expect(text(messages[0])).toBe('turn 4');
    expect(messages[0].role).toBe('user');
  });

  it('drops the oldest turns first when the transcript outgrows the budget', () => {
    const history = Array.from({ length: 6 }, (_, i) =>
      turn(i % 2 === 0 ? 'u' : 'a', String(i).repeat(800), i));
    const messages = buildMessages(history, 'now', BLOCK);
    const kept = messages.slice(0, -1);
    expect(kept.reduce((total, message) => total + text(message).length, 0))
      .toBeLessThanOrEqual(MAX_HISTORY_CHARS);
    // Trimming stranded turn 3, an assistant turn, at the head. It has to go.
    expect(kept.map(message => message.role)).toEqual(['user', 'model']);
    expect(text(kept[0]).startsWith('4')).toBe(true);
  });

  it('attaches the excerpts to the final message and nowhere else', () => {
    const history = Array.from({ length: 4 }, (_, i) =>
      turn(i % 2 === 0 ? 'u' : 'a', `turn ${i}`, i));
    const messages = buildMessages(history, 'now', BLOCK);
    expect(messages.filter(message => text(message).includes(BLOCK))).toHaveLength(1);
    expect(text(messages[messages.length - 1])).toContain(BLOCK);
    for (const message of messages.slice(0, -1)) {
      expect(text(message)).not.toContain(BLOCK);
      expect(text(message)).not.toContain('Excerpts from Jody');
    }
  });

  it('sends the question alone when there is no usable history', () => {
    const messages = buildMessages([], 'first question', BLOCK);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
  });
});
