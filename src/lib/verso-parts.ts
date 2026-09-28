import type { WorkPresentation } from './work-presentation';

// The case-study building blocks Verso can place inline in a conversation. The
// work page renders the same components, so a part here is a section there.
export const WORK_PARTS = ['visual', 'facts', 'summary', 'architecture'] as const;
export type WorkPart = typeof WORK_PARTS[number];

export interface PartSource {
  type: 'work' | 'portfolio';
  slug: string;
  title: string;
  url: string;
  hasPresentation: boolean;
  hasVisual: boolean;
  imageCount: number;
}

export interface PartIndexEntry {
  key: string;
  title: string;
  url: string;
  parts: string[];
}

// The evaluation work has no screenshot; its hero is a drawn diagram instead.
const DRAWN_VISUALS = new Set(['pharmacy-agent-eval']);

/** Whether the case study has a hero figure to show: a screenshot, or a drawn stand-in. */
export function hasCaseVisual(slug: string, presentation?: Pick<WorkPresentation, 'image'>): boolean {
  return Boolean(presentation?.image) || DRAWN_VISUALS.has(slug);
}

/**
 * Which parts an entry can render. VersoPartTemplates renders exactly these as
 * templates and the chat index advertises exactly these, so the two cannot
 * disagree. A work entry without a presentation renders nothing: its facts
 * would lack scale and outcome, and it has no summary or architecture. A
 * portfolio entry is one gallery, so its parts list is empty and the key's
 * presence is the signal.
 */
export function partsFor(source: PartSource): PartIndexEntry[] {
  const { type, slug, title, url } = source;
  if (type === 'portfolio') {
    return source.imageCount > 0 ? [{ key: `screens:${slug}`, title, url, parts: [] }] : [];
  }
  if (!source.hasPresentation) return [];
  const parts = WORK_PARTS.filter(part => part !== 'visual' || source.hasVisual);
  return [{ key: `work:${slug}`, title, url, parts }];
}

/** The DOM id of the template holding a part: `gen-work-<slug>-<part>` or `gen-screens-<slug>`. */
export function partTemplateId(key: string, part?: string): string {
  const [kind, slug] = key.split(':');
  return kind === 'screens' ? `gen-screens-${slug}` : `gen-work-${slug}-${part}`;
}
