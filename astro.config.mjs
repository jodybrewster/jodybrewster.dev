import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import remarkWikiLink from 'remark-wiki-link';
import { llmsTxt } from './src/integrations/llms-txt.ts';

const SITE = 'https://jodybrewster.dev';

const wikiLinkPlugin = [remarkWikiLink, {
  hrefTemplate: (permalink) => `/notes/${permalink}`,
  pageResolver: (name) => [name.replace(/ /g, '-').toLowerCase()],
  aliasDivider: '|',
  wikiLinkClassName: 'wiki-link',
  newClassName: 'wiki-link-new',
}];

export default defineConfig({
  site: SITE,
  // 'server' so middleware runs for every request (including pages that would
  // otherwise be statically prerendered). Required by src/middleware.ts to gate
  // the whole site behind Basic Auth during the preview phase. Switch back to
  // 'static' (and delete middleware.ts) when going public.
  output: 'server',
  adapter: vercel(),
  integrations: [
    mdx(),
    sitemap(),
    llmsTxt({ site: SITE }),
  ],
  markdown: {
    remarkPlugins: [wikiLinkPlugin],
  },
});
