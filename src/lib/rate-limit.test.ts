import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isOriginAllowed } from './rate-limit';

function request(origin?: string, referer?: string): Request {
  const headers = new Headers();
  if (origin !== undefined) headers.set('origin', origin);
  if (referer !== undefined) headers.set('referer', referer);
  return new Request('https://jodybrewster.dev/api/chat', { headers });
}

beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('NODE_ENV', 'production');
});
afterEach(() => vi.unstubAllEnvs());

describe('isOriginAllowed', () => {
  it.each(['https://jodybrewster.dev', 'https://www.jodybrewster.dev'])(
    'accepts the exact public origin %s', origin => {
      expect(isOriginAllowed(request(origin))).toBe(true);
    },
  );

  it.each([
    'https://jodybrewster.dev.attacker.invalid',
    'https://attacker.invalid/jodybrewster.dev',
    'https://attacker.invalid?site=jodybrewster.dev',
    'https://jodybrewster.dev@attacker.invalid',
    'https://attacker@jodybrewster.dev',
    'http://jodybrewster.dev',
    'https://jodybrewster.dev:444',
    'https://jodybrewster.dev/path',
    'https://jodybrewster.dev?bad=1',
    'https://jodybrewster.dev#fragment',
    'jodybrewster.dev',
    'null',
    '',
  ])('rejects malformed or lookalike origin %s even with a valid referrer', origin => {
    expect(isOriginAllowed(request(origin, 'https://jodybrewster.dev/home'))).toBe(false);
  });

  it('uses a parsed same-origin referrer only when Origin is absent', () => {
    expect(isOriginAllowed(request(undefined, 'https://jodybrewster.dev/home?q=1'))).toBe(true);
    expect(isOriginAllowed(request(undefined, 'https://jodybrewster.dev.attacker.invalid/home'))).toBe(false);
    expect(isOriginAllowed(request(undefined, 'https://attacker.invalid/jodybrewster.dev'))).toBe(false);
    expect(isOriginAllowed(request(undefined, 'broken'))).toBe(false);
    expect(isOriginAllowed(request())).toBe(false);
  });

  it('allows preview deployments even when Node runs in production mode', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(isOriginAllowed(request('https://a-preview.vercel.app'))).toBe(true);
  });

  it('allows development origins', () => {
    vi.stubEnv('VERCEL_ENV', 'development');
    vi.stubEnv('NODE_ENV', 'development');
    expect(isOriginAllowed(request('http://localhost:4321'))).toBe(true);
  });

  it('still enforces production when no Vercel environment is present', () => {
    vi.stubEnv('VERCEL_ENV', '');
    expect(isOriginAllowed(request('https://elsewhere.invalid'))).toBe(false);
  });
});
