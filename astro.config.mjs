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
  output: 'static',
  // The chat streams a grounded model answer and holds itself to a 55s
  // deadline (src/pages/api/chat.ts), so the function needs a little more than
  // that. This is a ceiling, not a reservation, and it applies to every
  // on-demand route because the adapter emits a single function - Astro has no
  // per-route maxDuration.
  adapter: vercel({ maxDuration: 60 }),
  // The site opens on the home page. It is served from /home rather than the
  // root, so the root sends you there; the Vercel adapter turns this into a
  // real redirect at the edge, and it still resolves under `astro dev`.
  // Verso lives in the popup on every page; its old standalone pages send
  // links and indexed URLs home, where the popup is. /resume is the short link
  // to hand out; a 302 so swapping the file never leaves an old one cached.
  redirects: {
    '/': '/home', '/chat': '/home', '/ask': '/home',
    '/resume': { status: 302, destination: '/jodybrewster_resume_2026.pdf' },
  },
  // The shelf is a heavy route. Warming it on hover means the fold has
  // something to land on instead of a blank frame.
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  integrations: [
    mdx(),
    sitemap(),
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
    // No inlined scripts or assets: every processed script becomes a
    // same-origin file, which the security policy allows by origin. Inline
    // module scripts would also make the client router insert a data: script
    // to wait for them, which the policy refuses (scripts/security-headers.ts).
    build: { assetsInlineLimit: 0 },
    optimizeDeps: {
      include: [
        'three',
        'three/examples/jsm/geometries/RoundedBoxGeometry.js',
        'three/examples/jsm/postprocessing/EffectComposer.js',
        'three/examples/jsm/postprocessing/GTAOPass.js',
        'three/examples/jsm/postprocessing/OutputPass.js',
        'three/examples/jsm/postprocessing/RenderPass.js',
        'three/examples/jsm/postprocessing/ShaderPass.js',
      ],
    },
  },
});
