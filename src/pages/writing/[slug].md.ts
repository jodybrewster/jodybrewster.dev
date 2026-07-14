import type { APIRoute } from 'astro';
import { getCollection, getEntry } from 'astro:content';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function getStaticPaths() {
  const essays = await getCollection('writing', ({ data }) => data.status !== 'draft');
  return essays.map((entry) => ({ params: { slug: entry.id } }));
}

export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug;
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) {
    return new Response('Bad request', { status: 400 });
  }
  const entry = await getEntry('writing', slug);
  if (!entry || entry.data.status === 'draft') {
    return new Response('Not found', { status: 404 });
  }
  // entry.filePath is the absolute path when available; fall back to the
  // committed content/ dir using the (validated) slug.
  const filePath = entry.filePath ?? resolve(`content/writing/${slug}.md`);
  const raw = await readFile(filePath, 'utf-8');

  return new Response(raw, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
