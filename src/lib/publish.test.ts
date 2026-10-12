import { describe, expect, it } from 'vitest';
import { isPublished } from './publish';

describe('isPublished', () => {
  it('publishes true everywhere', () => {
    expect(isPublished(true, false)).toBe(true);
    expect(isPublished(true, true)).toBe(true);
  });

  it('shows a draft on the dev server only', () => {
    expect(isPublished('draft', true)).toBe(true);
    expect(isPublished('draft', false)).toBe(false);
  });

  it('keeps everything else private', () => {
    for (const value of [false, undefined, null, 'true', 'yes', 1]) {
      expect(isPublished(value, true)).toBe(false);
      expect(isPublished(value, false)).toBe(false);
    }
  });
});
