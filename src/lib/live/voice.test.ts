import { describe, expect, it, vi } from 'vitest';
import { createVoiceConfig, createVoiceTools, type VoiceToolDeps } from './voice';
import { VERSO_TOOL_DECLARATIONS, type CardIndex } from '../verso-tools';
import { VOICE_MODEL, VOICE_PROMPT } from '../verso-voice';

const work = { kind: 'work', slug: 'lennar-interactive-maps', title: 'Lennar maps', url: '/work/lennar-interactive-maps', sector: 'Homebuilding', role: 'Lead', duration: '2 years' } as const;
const index = { work: { [work.slug]: work }, articles: {}, notes: {}, now: null, pages: {} } as unknown as CardIndex;

function deps(overrides: Partial<VoiceToolDeps> = {}): VoiceToolDeps {
  return {
    searchSite: vi.fn().mockResolvedValue([{ type: 'work', slug: work.slug, title: work.title, url: work.url, text: 'excerpt' }]),
    cardIndex: vi.fn().mockResolvedValue(index),
    ...overrides,
  };
}
const byName = (tools: ReturnType<typeof createVoiceTools>, name: string) => tools.find(tool => tool.name === name)!;

describe('createVoiceTools', () => {
  it('offers search_site plus every card tool the text path has', () => {
    const names = createVoiceTools(deps()).map(tool => tool.name);
    expect(names).toEqual(['search_site', ...VERSO_TOOL_DECLARATIONS.map(tool => tool.name)]);
  });

  it('keeps declarations identical to the ones the token locks', () => {
    const tools = createVoiceTools(deps());
    for (const declaration of VERSO_TOOL_DECLARATIONS) {
      const definition = byName(tools, declaration.name).getDefinition() as { parameters: { properties: unknown; required: unknown } };
      expect(definition.parameters.properties).toEqual(declaration.parameters.properties);
      expect(definition.parameters.required).toEqual(declaration.parameters.required ?? []);
    }
  });

  it('feeds search results to the model without rendering them', async () => {
    const d = deps();
    const search = byName(createVoiceTools(d), 'search_site');
    expect(search.render).toBe(false);
    await expect(search.runFunction({ query: '  lennar  ' })).resolves.toEqual({ results: [expect.objectContaining({ slug: work.slug })] });
    expect(d.searchSite).toHaveBeenCalledWith('lennar');
  });

  it('does not search for an empty query', async () => {
    const d = deps();
    await expect(byName(createVoiceTools(d), 'search_site').runFunction({ query: 42 })).resolves.toEqual({ results: [] });
    expect(d.searchSite).not.toHaveBeenCalled();
  });

  it('resolves a real slug to its card and declines an invented one', async () => {
    const show = byName(createVoiceTools(deps()), 'show_work');
    expect(show.render).not.toBe(false);
    await expect(show.runFunction({ slug: work.slug })).resolves.toMatchObject({ kind: 'work', url: work.url });
    await expect(show.runFunction({ slug: 'made-up' })).resolves.toBeNull();
  });
});

describe('createVoiceConfig', () => {
  it('matches the locked token on model and prompt', () => {
    const config = createVoiceConfig([]);
    expect(config.model).toBe(VOICE_MODEL);
    expect(config.systemInstructions).toBe(VOICE_PROMPT);
    expect(config.inputAudioTranscription && config.outputAudioTranscription).toBe(true);
  });
});
