import { describe, expect, it } from 'vitest';
import { voiceErrorMessage } from './voice-dock';

describe('voiceErrorMessage', () => {
  it('says voice is paused when the token route answers 503 (switched off or briefly unavailable)', () => {
    expect(voiceErrorMessage(new Error('Token fetch failed: 503'))).toBe('Voice is paused right now. You can keep typing.');
  });

  it('keeps the daily-limit and microphone messages', () => {
    expect(voiceErrorMessage(new Error('Token fetch failed: 429'))).toMatch(/voice time for today/);
    expect(voiceErrorMessage(Object.assign(new Error('x'), { name: 'NotAllowedError' }))).toMatch(/microphone is blocked/);
    expect(voiceErrorMessage(new Error('anything else'))).toBe('Voice could not start. You can keep typing.');
  });
});
