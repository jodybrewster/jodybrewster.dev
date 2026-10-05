import { describe, expect, it } from 'vitest';
import { scriptJson } from './script-json';

describe('scriptJson', () => {
  it('cannot close the script element it is written into', () => {
    const hostile = { title: '</script><script>fetch("//evil")</script>', artist: 'A & B <x>' };
    const out = scriptJson(hostile);
    expect(out).not.toMatch(/<|>/);
    expect(out.toLowerCase()).not.toContain('</script');
    expect(JSON.parse(out)).toEqual(hostile);
  });

  it('escapes the line separators older parsers choke on', () => {
    expect(scriptJson('a\u2028b\u2029c')).toBe('"a\\u2028b\\u2029c"');
  });
});
