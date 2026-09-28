// One image per article, shared by the index cards and the article's own lead figure so the two always match.

export type ArticleKind = 'writing' | 'research';

const researchImages: Record<string, string> = {
  'ai-design-skills-comparison': '/images/research/ai-design-skills-comparison.webp',
  'diverge-converge-workflows': '/images/research/diverge-converge-workflows.webp',
  'snowflake-cortex-learning-customization-charts': '/images/research/snowflake-cortex-learning-customization-charts.webp',
  'claude-md-design-md-patterns-ai-agents': '/images/research/claude-md-design-md-patterns-ai-agents.webp',
  'pro-claude-code-agentic-stack': '/images/research/pro-claude-code-agentic-stack.webp',
  'vercel-eve-agent-framework': '/images/research/vercel-eve-agent-framework.webp',
  'technical-writing-doc-skills-claude-codex': '/images/research/technical-writing-doc-skills-claude-codex.webp',
  'claude-code-codebase-audit-commands': '/images/research/claude-code-codebase-audit-commands.webp',
  'design-engineer-portfolios-field-guide': '/images/research/design-engineer-portfolios-field-guide.webp',
  'evaluating-conversational-ai-quality': '/images/research/evaluating-conversational-ai-quality.webp',
  'pkm-alternatives-obsidian-mcp': '/images/research/pkm-alternatives-obsidian-mcp.webp',
};

const writingImages: Record<string, string> = {
  'the-model-that-wont-talk-a-teardown-of-jev': '/images/research/jev-structured-model.webp',
};

// Articles without a dedicated image get a studio illustration chosen from the slug, so a piece keeps the same one
// wherever it appears and does not change when newer articles shift the list.
export const fallbackImages = [
  '/images/studio/research-systems.webp',
  '/images/studio/research-building.webp',
  '/images/studio/research-exploration.webp',
];

export function articleImage(kind: ArticleKind, slug: string): string {
  const dedicated = (kind === 'research' ? researchImages : writingImages)[slug];
  if (dedicated) return dedicated;
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return fallbackImages[hash % fallbackImages.length];
}
