/**
 * The projects /work lists: the published briefs, featured first, then the
 * selected interface work from the portfolio. The /library scene prints the
 * same list as case studies, so the two can never disagree about what counts.
 */
import { getCollection } from 'astro:content';
import { workPresentation } from './work-presentation';

export interface WorkProject {
  title: string;
  href: string;
  description: string;
  tags: string[];
  categories: string[];
  image?: string;
  alt: string;
  type: 'Case study' | 'Interface work';
  featured: boolean;
}

export async function workProjects(): Promise<WorkProject[]> {
  const [briefs, portfolio] = await Promise.all([
    getCollection('work', b => !b.data.draft),
    getCollection('portfolio'),
  ]);
  const order = ['jobbyjob', 'agentic-analytics-platform', 'lennar-interactive-maps'];
  const selectedPortfolio: Record<string, { description: string; tags: string[]; categories: string[] }> = {
    'react-native-reporting-portal': { description: 'A single mobile home for Lennar’s internal business dashboards, with search, favorites, and report details.', tags: ['React Native', 'Enterprise', 'Reporting'], categories: ['enterprise', 'data'] },
    'react-okta-sso-portal': { description: 'An agent-facing portal with branded sign-in, self-service registration, and an authenticated dashboard.', tags: ['React', 'Okta', 'Identity', 'Insurance'], categories: ['enterprise', 'web'] },
    'blog-page-update': { description: 'A redesigned article template for Senior Healthcare Direct, applied to a Medicare Advantage enrollment article.', tags: ['Web Design', 'Blog', 'UI Design'], categories: ['web'] },
    'pdf-web-distribution-list': { description: 'A one-page company directory that works as both a printable PDF and a searchable web page.', tags: ['Document Design', 'Print', 'Figma'], categories: ['enterprise'] },
    'senior-healthcare-direct': { description: 'An article experience that brings Medicare information, related video, and subscription journeys together.', tags: ['UX Design', 'Healthcare', 'Web Design'], categories: ['web'] },
  };
  return [
    ...briefs.sort((a, b) => Number(Boolean(workPresentation[b.id]?.featured)) - Number(Boolean(workPresentation[a.id]?.featured)) || order.indexOf(a.id) - order.indexOf(b.id)).map(brief => {
      const presentation = workPresentation[brief.id];
      return {
        title: brief.id === 'lennar-interactive-maps' ? 'Lennar Interactive Maps' : presentation?.title ?? brief.data.title,
        href: `/work/${brief.id}`,
        description: presentation?.description ?? brief.data.sub ?? brief.data.sector,
        tags: presentation?.tags ?? [brief.data.sector],
        categories: presentation?.categories ?? ['enterprise'],
        image: presentation?.image,
        alt: presentation?.alt ?? '',
        type: 'Case study' as const,
        featured: Boolean(presentation?.featured),
      };
    }),
    ...Object.entries(selectedPortfolio).flatMap(([id, summary]) => {
      const project = portfolio.find(item => item.id === id);
      return project ? [{ title: project.data.title, href: `/portfolio/${id}`, ...summary, image: project.data.cover, alt: project.data.images[0]?.alt ?? '', type: 'Interface work' as const, featured: false }] : [];
    }),
  ];
}
