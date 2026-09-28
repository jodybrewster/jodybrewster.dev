import { describe, expect, it } from 'vitest';
import { mediaTransitionName } from './transition-names';

describe('mediaTransitionName', () => {
  it('gives a card link and the page it opens the same name', () => {
    expect(mediaTransitionName('/research/vercel-eve-agent-framework')).toBe('media-research-vercel-eve-agent-framework');
    expect(mediaTransitionName('/research/vercel-eve-agent-framework/')).toBe('media-research-vercel-eve-agent-framework');
  });

  it('produces a valid CSS identifier from any path', () => {
    expect(mediaTransitionName('/work/Some Case.Study')).toMatch(/^[a-z0-9-]+$/);
  });
});
