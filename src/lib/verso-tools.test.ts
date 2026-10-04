import { describe, expect, it } from 'vitest';
import { VERSO_TOOL_DECLARATIONS, resolveCard, sitePath, verifyQuote, type CardIndex } from './verso-tools';

const index: CardIndex = {
  work: { 'lennar-interactive-maps': {
    kind: 'work', slug: 'lennar-interactive-maps', title: 'Lennar Interactive Mapping Platform', url: '/work/lennar-interactive-maps',
    sector: 'Homebuilding', role: 'Lead Developer / Architect', duration: '~ 3 months, 2024', summary: 'Maps.',
  } },
  articles: {
    'writing:jev': { kind: 'article', collection: 'writing', slug: 'jev', title: 'Jev', url: '/writing/jev', description: 'A teardown.', date: '2026-09-27', image: '/a.webp' },
    'research:eve': { kind: 'article', collection: 'research', slug: 'eve', title: 'Eve', url: '/research/eve', description: 'Agents.', date: '2026-07-13', image: '/b.webp' },
  },
  notes: { 'adding-research': { kind: 'note', slug: 'adding-research', title: 'Adding research', url: '/notes/adding-research', status: 'seedling', date: '2026-05-23' } },
  now: { kind: 'now', title: 'Now', url: '/now', excerpt: 'Building a shelf.', updated: '2026-07-30' },
  pages: {
    '/work/lennar-interactive-maps': {
      title: 'Lennar', description: 'Maps.',
      text: 'Sales managers walked buyers through availability using documents that could be out of date before the conversation ended.\n\nThe **real** work was the \u201cpipeline\u201d \u2014 not the map.',
    },
    '/now': { title: 'Now', text: 'Building a shelf.' },
  },
  parts: {
    'work:lennar-interactive-maps': { title: 'Lennar Interactive Mapping Platform', url: '/work/lennar-interactive-maps', parts: ['visual', 'facts', 'summary', 'architecture'] },
    'work:facts-only-case': { title: 'Facts-only case', url: '/work/facts-only-case', parts: ['facts'] },
    'screens:lennar-interactive-maps': { title: 'Lennar Interactive Maps', url: '/portfolio/lennar-interactive-maps', parts: [] },
  },
};

describe('VERSO_TOOL_DECLARATIONS', () => {
  it('declares every tool as a JSON Schema object, with case study parts first', () => {
    expect(VERSO_TOOL_DECLARATIONS.map(tool => tool.name)).toEqual(['show_case_study', 'show_screens', 'go_to_page', 'show_work', 'show_writing', 'show_note', 'show_now', 'open_page']);
    for (const tool of VERSO_TOOL_DECLARATIONS) {
      expect(tool.parameters.type).toBe('object');
      for (const required of tool.parameters.required ?? []) expect(tool.parameters.properties).toHaveProperty(required);
    }
    for (const name of ['show_work', 'show_writing', 'show_note', 'show_now', 'open_page']) {
      expect(VERSO_TOOL_DECLARATIONS.find(t => t.name === name)!.description).toMatch(/at most two/);
    }
    expect(VERSO_TOOL_DECLARATIONS.find(t => t.name === 'show_case_study')!.parameters.properties.part.enum)
      .toEqual(['visual', 'facts', 'summary', 'architecture']);
    expect(JSON.stringify(VERSO_TOOL_DECLARATIONS)).not.toContain('\u2014');
  });

  it('tells the model to use only slugs and urls it was given', () => {
    for (const name of ['show_work', 'show_writing', 'show_note']) {
      const tool = VERSO_TOOL_DECLARATIONS.find(t => t.name === name)!;
      expect(tool.parameters.properties.slug.description).toMatch(/appeared in the provided excerpts or search results/);
    }
    expect(VERSO_TOOL_DECLARATIONS.find(t => t.name === 'open_page')!.parameters.properties.url.description)
      .toMatch(/appeared in the provided excerpts or search results/);
  });
});

describe('resolveCard', () => {
  it('resolves each kind from the index', () => {
    expect(resolveCard(index, 'show_work', { slug: 'lennar-interactive-maps' })).toMatchObject({ kind: 'work', role: 'Lead Developer / Architect' });
    expect(resolveCard(index, 'show_writing', { slug: 'jev' })).toMatchObject({ collection: 'writing', url: '/writing/jev' });
    expect(resolveCard(index, 'show_writing', { slug: 'eve' })).toMatchObject({ collection: 'research', url: '/research/eve' });
    expect(resolveCard(index, 'show_note', { slug: 'adding-research' })).toMatchObject({ kind: 'note', status: 'seedling' });
    expect(resolveCard(index, 'show_now', {})).toMatchObject({ kind: 'now', url: '/now' });
  });

  it('accepts a path where a slug was asked for', () => {
    expect(resolveCard(index, 'show_work', { slug: '/work/lennar-interactive-maps/' })?.kind).toBe('work');
    expect(resolveCard(index, 'show_writing', { slug: 'research/eve' })?.kind).toBe('article');
  });

  it('returns null for unknown tools, slugs and malformed arguments', () => {
    expect(resolveCard(index, 'delete_site', { slug: 'jev' })).toBeNull();
    expect(resolveCard(index, 'show_work', { slug: 'made-up' })).toBeNull();
    expect(resolveCard(index, 'show_work', { slug: 42 })).toBeNull();
    expect(resolveCard(index, 'show_work', {})).toBeNull();
    expect(resolveCard(index, 'show_work', { slug: 'constructor' })).toBeNull();
    expect(resolveCard(index, 'show_note', { slug: '__proto__' })).toBeNull();
    expect(resolveCard(index, 'show_writing', { slug: '' })).toBeNull();
    expect(resolveCard(index, 'show_work', null as unknown as Record<string, unknown>)).toBeNull();
    expect(resolveCard({ ...index, now: null }, 'show_now', {})).toBeNull();
  });

  it('opens only known pages on this site', () => {
    expect(resolveCard(index, 'open_page', { url: '/work/lennar-interactive-maps' })).toEqual({
      kind: 'page', url: '/work/lennar-interactive-maps', title: 'Lennar', description: 'Maps.',
    });
    expect(resolveCard(index, 'open_page', { url: 'https://jodybrewster.dev/now/?x=1#y' })?.url).toBe('/now');
    expect(resolveCard(index, 'open_page', { url: 'https://evil.example/work/lennar-interactive-maps' })).toBeNull();
    expect(resolveCard(index, 'open_page', { url: '//evil.example/now' })).toBeNull();
    expect(resolveCard(index, 'open_page', { url: 'javascript:alert(1)' })).toBeNull();
    expect(resolveCard(index, 'open_page', { url: '/work/unknown' })).toBeNull();
    expect(resolveCard(index, 'open_page', { url: '/constructor' })).toBeNull();
  });

  it('keeps a quote only when the page says it', () => {
    const card = resolveCard(index, 'open_page', {
      url: '/work/lennar-interactive-maps',
      quote: '"Sales managers walked buyers through availability using documents that could be out of date"',
    });
    expect(card).toMatchObject({ quote: 'Sales managers walked buyers through availability using documents that could be out of date' });
    const invented = resolveCard(index, 'open_page', { url: '/work/lennar-interactive-maps', quote: 'Jody believes maps should be free.' });
    expect(invented).toMatchObject({ kind: 'page', url: '/work/lennar-interactive-maps' });
    expect(invented).not.toHaveProperty('quote');
  });

  it('matches quotes through curly quotes, dashes, emphasis, case and whitespace, and shows the page spelling', () => {
    const card = resolveCard(index, 'open_page', { url: '/work/lennar-interactive-maps', quote: 'the REAL work was the "pipeline" - not   the map' });
    expect(card).toMatchObject({ quote: 'The real work was the \u201cpipeline\u201d \u2014 not the map' });
  });

  it('drops quotes that are too short to mean anything or too long to be a quote', () => {
    expect(resolveCard(index, 'open_page', { url: '/work/lennar-interactive-maps', quote: 'the map' })).not.toHaveProperty('quote');
    expect(resolveCard(index, 'open_page', { url: '/work/lennar-interactive-maps', quote: 'x'.repeat(400) })).not.toHaveProperty('quote');
  });
});

describe('case study parts', () => {
  it('names a part that exists, with its title and home from the index', () => {
    expect(resolveCard(index, 'show_case_study', { slug: 'lennar-interactive-maps', part: 'facts' })).toEqual({
      kind: 'part', slug: 'lennar-interactive-maps', part: 'facts', title: 'Lennar Interactive Mapping Platform', url: '/work/lennar-interactive-maps',
    });
    expect(resolveCard(index, 'show_case_study', { slug: '/work/lennar-interactive-maps', part: 'visual' })).toMatchObject({ part: 'visual' });
  });

  it('refuses unknown slugs, unknown parts and parts a case study does not have', () => {
    expect(resolveCard(index, 'show_case_study', { slug: 'made-up', part: 'facts' })).toBeNull();
    expect(resolveCard(index, 'show_case_study', { slug: 'lennar-interactive-maps', part: 'budget' })).toBeNull();
    expect(resolveCard(index, 'show_case_study', { slug: 'facts-only-case', part: 'visual' })).toBeNull();
    expect(resolveCard(index, 'show_case_study', { slug: 'constructor', part: 'facts' })).toBeNull();
  });

  it('shows product screens only for a gallery that exists', () => {
    expect(resolveCard(index, 'show_screens', { slug: 'lennar-interactive-maps' })).toEqual({
      kind: 'screens', slug: 'lennar-interactive-maps', title: 'Lennar Interactive Maps', url: '/portfolio/lennar-interactive-maps',
    });
    expect(resolveCard(index, 'show_screens', { slug: 'facts-only-case' })).toBeNull();
  });

  it('navigates only to published pages on this site', () => {
    expect(resolveCard(index, 'go_to_page', { url: '/now' })).toEqual({ kind: 'navigate', url: '/now', title: 'Now' });
    expect(resolveCard(index, 'go_to_page', { url: 'https://evil.example/now' })).toBeNull();
    expect(resolveCard(index, 'go_to_page', { url: '/admin' })).toBeNull();
  });
});

describe('helpers', () => {
  it('sitePath normalises same-site urls and refuses the rest', () => {
    expect(sitePath('/work/x/')).toBe('/work/x');
    expect(sitePath('/')).toBe('/');
    expect(sitePath('https://www.jodybrewster.dev/notes/a')).toBe('/notes/a');
    expect(sitePath('https://user:pw@jodybrewster.dev/notes/a')).toBeNull();
    expect(sitePath('/\\evil.example')).toBeNull();
    expect(sitePath(undefined)).toBeNull();
  });

  it('verifyQuote returns null when the passage is not on the page', () => {
    expect(verifyQuote('Plain page text about maps and pipelines.', 'about maps and pipelines')).toBe('about maps and pipelines');
    expect(verifyQuote('Plain page text about maps and pipelines.', 'about maps and trains')).toBeNull();
  });
});
