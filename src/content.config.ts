import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const writing = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './content/writing' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string(),
    tags: z.array(z.string()).default([]),
    pillar: z.string().optional(),
    status: z.enum(['draft', 'published']).default('published'),
  }),
});

const notes = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './content/notes' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    status: z.enum(['seedling', 'budding', 'evergreen']),
    publish: z.boolean().default(false),
    tags: z.array(z.string()).default([]),
  }),
});

const work = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './content/work' }),
  schema: z.object({
    title: z.string(),
    sector: z.string(),
    role: z.string(),
    duration: z.string(),
    pillar: z.string().optional(),
    sub: z.string().optional(),
  }),
});

export const collections = { writing, notes, work };
