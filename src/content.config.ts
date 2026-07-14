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
    draft: z.boolean().default(false),
  }),
});

const research = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './content/research' }),
  schema: z.object({
    title: z.string(),
    pubDate: z.coerce.date(),
    description: z.string(),
    pillar: z.string().optional(),
    tags: z.array(z.string()).default([]),
    publish: z.boolean().default(true),
    slug: z.string().optional(),
  }),
});

const portfolio = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './content/portfolio' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string(),
    tags: z.array(z.string()).default([]),
    tools: z.array(z.string()).default([]),
    cover: z.string(),
    behance: z.string().url().optional(),
    images: z.array(z.object({
      src: z.string(),
      alt: z.string(),
      caption: z.string().optional(),
    })).default([]),
  }),
});

export const collections = { writing, notes, work, research, portfolio };
