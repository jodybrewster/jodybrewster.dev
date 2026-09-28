import { describe, expect, it } from 'vitest';
import { articleImage, fallbackImages } from './article-images';

describe('articleImage', () => {
  it('returns the dedicated image for a mapped article', () => {
    expect(articleImage('research', 'vercel-eve-agent-framework')).toBe('/images/research/vercel-eve-agent-framework.webp');
    expect(articleImage('writing', 'the-model-that-wont-talk-a-teardown-of-jev')).toBe('/images/research/jev-structured-model.webp');
  });

  it('does not look up a slug in the other collection', () => {
    expect(fallbackImages).toContain(articleImage('writing', 'vercel-eve-agent-framework'));
  });

  it('gives an unmapped article the same fallback every time', () => {
    const first = articleImage('writing', 'some-new-essay');
    expect(fallbackImages).toContain(first);
    expect(articleImage('writing', 'some-new-essay')).toBe(first);
  });
});
