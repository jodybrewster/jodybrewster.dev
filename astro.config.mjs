import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import remarkWikiLink from 'remark-wiki-link';
import { llmsTxt } from './src/integrations/llms-txt.ts';
import { flags } from './src/lib/flags.ts';

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
  output: 'static',
  adapter: vercel(),
  // The site opens on the home page. It is served from /home rather than the
  // root, so the root sends you there; the Vercel adapter turns this into a
  // real redirect at the edge, and it still resolves under `astro dev`.
  redirects: { '/': '/home' },
  // The shelf is a heavy route. Warming it on hover means the fold has
  // something to land on instead of a blank frame.
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  integrations: [
    mdx(),
    sitemap({
      filter: (page) => flags.chat || !new URL(page).pathname.startsWith('/chat'),
    }),
    llmsTxt({ site: SITE }),
  ],
  markdown: {
    remarkPlugins: [wikiLinkPlugin],
  },
});
