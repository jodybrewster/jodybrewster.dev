import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { scanHtml, securityHeaders } from './security-headers';

const sha = (s: string) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

describe('scanHtml', () => {
  it('hashes inline scripts exactly, skipping external scripts and data blocks', () => {
    const html = '<script>window.a=1</script><script src="/x.js"></script><script type="application/ld+json">{"@type":"Person"}</script><script type="module">import("/y.js")</script>';
    expect(scanHtml(html).hashes).toEqual([sha('window.a=1'), sha('import("/y.js")')]);
  });

  it('finds inline event handlers, which a hashed policy cannot allow', () => {
    expect(scanHtml('<button onclick="go()">x</button><form onsubmit="return false">').handlers).toEqual(['onclick', 'onsubmit']);
    expect(scanHtml('<a data-on="x" href="/one">one</a>').handlers).toEqual([]);
  });
});

describe('securityHeaders', () => {
  it('allows scripts by origin and hash only, styles with inline attributes, and nothing may frame the site', () => {
    const h = securityHeaders([sha('a'), sha('a'), sha('b')]);
    const policy = h['content-security-policy'];
    const script = policy.split('; ').find(d => d.startsWith('script-src ')) ?? '';
    expect(script).toBe(`script-src 'self' https://www.googletagmanager.com/gtag/ 'wasm-unsafe-eval' ${[sha('a'), sha('b')].sort().join(' ')}`);
    expect(policy).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("connect-src 'self' wss://generativelanguage.googleapis.com");
    expect(policy).not.toMatch(/'unsafe-eval'|\*/);
    expect(h['strict-transport-security']).toBe('max-age=63072000; includeSubDomains');
    expect(h['permissions-policy']).toContain('microphone=(self)');
    expect(h['x-frame-options']).toBe('DENY');
  });
});
