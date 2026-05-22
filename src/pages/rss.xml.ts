import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async (context) => {
  const entries = await getCollection('writing', (e) => e.data.status === 'published');
  const sorted = entries.sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
  );

  return rss({
    title: 'Jody Brewster — Writing',
    description:
      'Essays on AI experience architecture, runtime design, and the unfinished discipline of designing for agentic systems.',
    site: context.site!,
    items: sorted.map((entry) => ({
      title: entry.data.title,
      pubDate: entry.data.date,
      description: entry.data.description,
      link: `/writing/${entry.id}/`,
    })),
  });
};
