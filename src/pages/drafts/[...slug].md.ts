import type { APIRoute } from 'astro';
import { getCollection, getEntry } from 'astro:content';
import { readFile } from 'node:fs/promises';

// Backs the article layout's "View as .md" link for drafts. Dev only, for the
// same reason as the page route: no paths means nothing lands in dist/.
export async function getStaticPaths() {
  if (!import.meta.env.DEV) return [];
  const entries = await getCollection('drafts');
  return entries.map(entry => ({ params: { slug: entry.id } }));
}

export const GET: APIRoute = async ({ params }) => {
  const entry = params.slug ? await getEntry('drafts', params.slug) : undefined;
  if (!entry?.filePath) return new Response('Not found', { status: 404 });
  return new Response(await readFile(entry.filePath, 'utf-8'), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
};
