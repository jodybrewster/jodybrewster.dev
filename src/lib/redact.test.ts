import { describe, expect, it } from 'vitest';
import { redactText } from '@jodybrewster/gemini-live/server/redact';
import { appendTurn, type RedisLike } from './conversation';

/**
 * The rules themselves are tested in the framework. This checks the site's
 * side: the package resolves with the site's own libphonenumber-js, and the
 * function the call sites import (conversation.ts, operator.ts,
 * transcripts.ts) still removes what the dock says is removed.
 */
describe('redaction through @jodybrewster/gemini-live/server/redact', () => {
  it('removes an email, a phone number and a payment card', () => {
    expect(redactText('Mail jane.doe@example.com or call (415) 555-0132, card 4111 1111 1111 1111.'))
      .toBe('Mail [email] or call [phone], card [card].');
  });

  it('finds an international number with libphonenumber-js', () => {
    expect(redactText('My number is +44 20 7946 0958.')).toBe('My number is [phone].');
  });

  it('keeps ordinary prose', () => {
    const prose = 'Shipped 2019-2024 across three teams; raised $120,000.';
    expect(redactText(prose)).toBe(prose);
  });

  it('is what a stored turn goes through', async () => {
    const pushed: unknown[] = [];
    const redis = {
      rpush: async (_key: string, ...values: unknown[]) => pushed.push(...values),
      expire: async () => 1,
    } as unknown as RedisLike;
    await appendTurn('c1', { r: 'u', t: 'I am jane@example.com, +1 415 555 0132, 4111111111111111', ts: 1 }, redis);
    expect(JSON.parse(pushed[0] as string).t).toBe('I am [email], [phone], [card]');
  });
});
