import { describe, expect, it } from 'vitest';
import { WORK_PARTS, hasCaseVisual, partTemplateId, partsFor, type PartSource } from './verso-parts';
import { workPresentation } from './work-presentation';

const work = (over: Partial<PartSource> = {}): PartSource => ({
  type: 'work', slug: 'lennar-interactive-maps', title: 'Lennar', url: '/work/lennar-interactive-maps',
  hasPresentation: true, hasVisual: true, imageCount: 0, ...over,
});

describe('WORK_PARTS', () => {
  it('lists the four case-study parts in page order', () => {
    expect(WORK_PARTS).toEqual(['visual', 'facts', 'summary', 'architecture']);
  });
});

describe('hasCaseVisual', () => {
  it('is true for a case study with a screenshot', () => {
    expect(hasCaseVisual(workPresentation['lennar-interactive-maps'])).toBe(true);
  });

  it('is false without one', () => {
    expect(hasCaseVisual({ image: undefined })).toBe(false);
    expect(hasCaseVisual()).toBe(false);
  });
});

describe('partsFor', () => {
  it('gives a presented work entry every part', () => {
    expect(partsFor(work())).toEqual([{
      key: 'work:lennar-interactive-maps', title: 'Lennar', url: '/work/lennar-interactive-maps',
      parts: ['visual', 'facts', 'summary', 'architecture'],
    }]);
  });

  it('drops the visual when there is none', () => {
    expect(partsFor(work({ hasVisual: false }))[0].parts).toEqual(['facts', 'summary', 'architecture']);
  });

  it('renders nothing for a work entry without a presentation', () => {
    expect(partsFor(work({ hasPresentation: false }))).toEqual([]);
  });

  it('gives a portfolio entry with images one screens key and no parts', () => {
    expect(partsFor({ ...work(), type: 'portfolio', url: '/portfolio/lennar-interactive-maps', imageCount: 2 })).toEqual([{
      key: 'screens:lennar-interactive-maps', title: 'Lennar', url: '/portfolio/lennar-interactive-maps', parts: [],
    }]);
  });

  it('skips a portfolio entry without images', () => {
    expect(partsFor({ ...work(), type: 'portfolio', imageCount: 0 })).toEqual([]);
  });
});

describe('partTemplateId', () => {
  it('names work and screens templates', () => {
    expect(partTemplateId('work:lennar-interactive-maps', 'facts')).toBe('gen-work-lennar-interactive-maps-facts');
    expect(partTemplateId('screens:react-okta-sso-portal')).toBe('gen-screens-react-okta-sso-portal');
  });
});
