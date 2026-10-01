import { describe, expect, it } from 'vitest';
import { pullQuotes, verifiedQuotes } from './pull-quotes';

const article = [
  '## A heading',
  '',
  'The interesting part is **not** the speed. It is the argument.',
  '',
  '> **Jody:** My first reaction was: this is incredible.',
].join('\n');

describe('verifiedQuotes', () => {
  it('keeps a quote that appears in the text, through markdown emphasis', () => {
    expect(verifiedQuotes(['The interesting part is not the speed.'], article)).toEqual(['The interesting part is not the speed.']);
  });

  it('drops a quote the article does not contain', () => {
    expect(verifiedQuotes(['The interesting part is the speed.', 'It is the argument.'], article)).toEqual(['It is the argument.']);
  });

  it('matches across straight and curly punctuation', () => {
    expect(verifiedQuotes(['My first reaction was: this is incredible.'], article)).toHaveLength(1);
  });
});

describe('pullQuotes', () => {
  it('has nothing for an article that is not in the manifest', () => {
    expect(pullQuotes('no-such-article', article)).toEqual([]);
  });
});
