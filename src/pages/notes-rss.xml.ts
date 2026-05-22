import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';

function firstNonHeadingLine(body: string): string {
  const line = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('#'));
  return (line ?? '').slice(0, 240);
}

export const GET: APIRoute = async (context) => {
  const entries = await getCollection('notes', (n) => n.data.publish);
  const sorted = entries.sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
  );

  return rss({
    title: 'Jody Brewster — Notes',
    description: 'Shorter, less finished notes from a working notebook on AI and design.',
    site: context.site!,
    items: sorted.map((entry) => ({
      title: entry.data.title,
      pubDate: entry.data.date,
      description: firstNonHeadingLine(entry.body ?? ''),
      link: `/notes/${entry.id}/`,
    })),
  });
};
