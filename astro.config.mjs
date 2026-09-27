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
  // The chat holds its response open while a question waits on a human reply
  // (see src/lib/handoff.ts), so the function needs room for the handoff window
  // plus a model stream after it. This is a ceiling, not a reservation, and it
  // applies to every on-demand route because the adapter emits a single
  // function - Astro has no per-route maxDuration.
  adapter: vercel({ maxDuration: 90 }),
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
  // Three is imported only by /library, so Vite would otherwise discover it
  // on the first visit and re-optimize mid-session. When that re-run is lost,
  // the page keeps requesting bundles that no longer exist (504 Outdated
  // Optimize Dep) and the shelf never boots. Pre-bundling at startup means
  // there is nothing left to discover.
  vite: {
    optimizeDeps: {
      include: [
        'three',
        'three/examples/jsm/geometries/RoundedBoxGeometry.js',
        'three/examples/jsm/renderers/CSS3DRenderer.js',
        'three/examples/jsm/postprocessing/EffectComposer.js',
        'three/examples/jsm/postprocessing/GTAOPass.js',
        'three/examples/jsm/postprocessing/OutputPass.js',
        'three/examples/jsm/postprocessing/RenderPass.js',
        'three/examples/jsm/postprocessing/ShaderPass.js',
      ],
    },
  },
});
