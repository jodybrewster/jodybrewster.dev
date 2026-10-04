/** Presentation summaries drawn from the corresponding published work briefs. */
export interface WorkPresentation {
  title: string;
  description: string;
  image?: string;
  alt?: string;
  imageNote?: string;
  /** Crops a tall hero to this aspect ratio from the top; the lightbox still opens the whole image. */
  imageAspect?: string;
  tags: string[];
  categories: string[];
  challenge: string;
  solution: string;
  outcome: string;
  scale: string;
  architecture: { title: string; icon: string; items: string[] }[];
}

export const workPresentation: Record<string, WorkPresentation> = {
  'jobbyjob': {
    title: 'JobbyJob',
    description: 'A contacts spreadsheet that grew into a job search system, with an apply queue and a live voice interview coach.',
    image: '/images/work/jobbyjob/01-dashboard.png',
    alt: 'The JobbyJob dashboard: the review queue, the apply queue, brand scores for each lane resume and ten days of activity.',
    imageNote: 'Dashboard · Names replaced with placeholders',
    imageAspect: '4 / 3',
    tags: ['Claude Code', 'AI Agents', 'Astro + React', 'Voice AI'],
    categories: ['ai', 'web', 'data'],
    challenge: 'A senior job search in 2026 is a volume problem that looks like a quality problem. Postings go stale in days, boards misreport remote status and posted dates, and every application wants its own resume, letter and salary answer.',
    solution: 'A self-hosted Teable database, extended with Claude Code, grew into a system that pulls postings overnight, scores them against my profile, tailors materials, fills forms for my review and coaches me for interviews. A model never writes a fact: code copies facts from the posting and every judgment quotes its evidence.',
    outcome: '216 applications, each reviewed before it went out, peaking at 18 in a single day.',
    scale: '1,547 postings tracked from 7 sources; 14 slash commands, 3 skills, 94 scripts, 3 apps.',
    architecture: [
      { title: 'Foundation', icon: 'layers', items: ['Teable on Postgres + Redis', 'Docker, nightly backups', 'API-only access'] },
      { title: 'Intake', icon: 'clock', items: ['1 AM launchd pipeline', '7 posting sources', 'Every field read back'] },
      { title: 'Judgment', icon: 'shield', items: ['Written scoring rubric', 'Red-team objections', 'Calibrated match score'] },
      { title: 'Action', icon: 'code', items: ['Triage app', 'Apply queue + autofill', 'Voice interview coach'] },
    ],
  },
  'agentic-analytics-platform': {
    title: 'Brand Impact Tracker',
    description: 'AI-powered analytics with Snowflake, generative UI, and enterprise integration.',
    image: '/images/work/agentic-analytics-platform/hero.png',
    alt: 'Brand Impact Tracker daily brief showing brand performance signals, an ask-the-data input, and attention cards.',
    imageNote: 'Daily brief interface · Mock data',
    tags: ['Next.js', 'Snowflake', 'AI / LLMs', 'Enterprise'],
    categories: ['ai', 'enterprise', 'web', 'data'],
    challenge: 'Brand performance lived across disconnected tools. Ad-hoc questions entered an analyst backlog measured in weeks, and existing BI tools could not provide a branded experience for the dealer network.',
    solution: 'A custom Next.js application with Snowflake Cortex composes structured answers as live React components. Findings, interactive analyses, and scheduled briefs give operational and executive users different ways into the same data.',
    outcome: 'Question-to-answer time reduced from weeks to seconds in the demonstrated experience.',
    scale: 'Operations users and executives on one platform; proof of concept carried into a billable delivery engagement.',
    architecture: [
      { title: 'Data foundation', icon: 'layers', items: ['Funnel-stage tables', 'Semantic meaning', 'Snowflake warehouse'] },
      { title: 'Intelligence', icon: 'sparkle', items: ['Snowflake Cortex', 'Structured JSON', 'One AI capability layer'] },
      { title: 'Product surface', icon: 'code', items: ['Next.js + React', 'Generative canvas', 'Finding · Analysis · Brief'] },
      { title: 'Enterprise delivery', icon: 'layers', items: ['Existing BI preserved', 'Identity-provider auth', 'Shared component library'] },
    ],
  },
  'lennar-interactive-maps': {
    title: 'Lennar Interactive Mapping Platform',
    description: 'Turning static site plans into a live, data-driven experience.',
    image: '/images/portfolio/lennar-interactive-maps/02.png',
    alt: 'Lennar community site plan with individual lots, available home price pins, sold status, and availability filters.',
    imageNote: 'Community site plan · Shipped product',
    tags: ['GIS / CAD', 'Interactive Maps', 'Platform Architecture', 'Real Estate'],
    categories: ['enterprise', 'web', 'data', 'maps'],
    challenge: 'Every availability change meant another designer-updated PDF. Sales conversations depended on documents that could be stale before a buyer reached the next lot.',
    solution: 'A repeatable GIS and CAD conversion pipeline brought more than a thousand maps into a live platform. Sales managers publish changes through an administration tool, with current prices and availability flowing into the map.',
    outcome: 'Sales managers publish availability directly, removing designers from the update loop.',
    scale: 'More than 1,000 community maps processed and aligned to architectural plans.',
    architecture: [
      { title: 'Source material', icon: 'file', items: ['PDF community maps', 'Architectural plans', 'Lot and feature details'] },
      { title: 'Conversion pipeline', icon: 'layers', items: ['Command line tooling', 'GIS + CAD alignment', 'Documented process'] },
      { title: 'Administration', icon: 'layers', items: ['Live backend sales data', 'Sales manager updates', 'Availability + pricing'] },
      { title: 'Map experience', icon: 'compass', items: ['Regional search', 'Lot-level availability', 'Community features'] },
    ],
  },
};
