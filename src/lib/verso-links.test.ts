import { describe, expect, it } from 'vitest';
import { linkedPaths, renderAnswer, sitePaths } from './verso-links';

const paths = sitePaths({ '/work/lennar-interactive-maps': {}, '/notes/pro-dev-skillset': {} });

describe('linkedPaths', () => {
  it('returns each real path an answer links to, once', () => {
    const text = 'See [the maps](/work/lennar-interactive-maps), [again](/work/lennar-interactive-maps/) and [about](/about).';
    expect(linkedPaths(text, paths)).toEqual(['/work/lennar-interactive-maps', '/about']);
  });

  it('drops paths the site does not have and anything off-site', () => {
    const text = '[made up](/work/not-a-thing) [evil](https://evil.example/x) [proto](javascript:alert(1))';
    expect(linkedPaths(text, paths)).toEqual([]);
  });
});

describe('renderAnswer', () => {
  const text = 'Jody led [the Lennar maps](/work/lennar-interactive-maps) and [a thing](/work/nope).';

  it('links only confirmed paths and shows the rest as words', () => {
    expect(renderAnswer(text, new Set(['/work/lennar-interactive-maps']))).toBe(
      '<p>Jody led <a href="/work/lennar-interactive-maps">the Lennar maps</a> and a thing.</p>');
  });

  it('draws no links while the answer is still streaming', () => {
    expect(renderAnswer(text)).toBe('<p>Jody led the Lennar maps and a thing.</p>');
  });

  it('keeps italics, paragraphs and line breaks, and drops backticks around paths', () => {
    expect(renderAnswer('He says *less*.\nThen `/work/x`.\n\nNext')).toBe('<p>He says <em>less</em>.<br>Then /work/x.</p><p>Next</p>');
  });

  it('escapes everything the model writes', () => {
    expect(renderAnswer('<img src=x onerror=alert(1)> [<b>](/about)', new Set(['/about']))).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt; <a href="/about">&lt;b&gt;</a></p>');
  });

  it('never turns a quote-breaking path into an attribute', () => {
    expect(renderAnswer('[x](/about"onmouseover="a)', new Set(['/about"onmouseover="a']))).toContain('href="/about&quot;onmouseover=&quot;a"');
  });
});
