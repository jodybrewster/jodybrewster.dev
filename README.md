# jodybrewster.dev

Personal site for Jody Brewster — writing, digital garden notes, and anonymized work briefs on agentic interface design, AI-native experiences, and twenty years of design craft.

Built with [Astro 5](https://astro.build), deployed to [Vercel](https://vercel.com).

## Stack

- **Framework:** Astro 5 (SSR via `@astrojs/vercel`)
- **Content:** Markdown files synced from an Obsidian vault
- **Fonts:** Fraunces (display), Inter (body), JetBrains Mono (mono)
- **Search:** Pagefind (static index, generated post-build)
- **AI/Chat:** Anthropic Claude API + Upstash Vector (RAG over site content)
- **Agent surface:** MCP server, `.md` URL pattern, `llms.txt`, A2A agent card

## Commands

```bash
npm run dev        # start dev server at http://localhost:4321
npm run build      # production build (runs pagefind after)
npm run preview    # preview production build
npm run sync       # sync content from Obsidian vault → content/
```

## Content

Content lives in two places:

1. **Obsidian vault** at `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Sheikah Slate/personal/projects/jodybrewster.dev` — the authoring source
2. **`content/`** — populated by `npm run sync`

Run `npm run sync` before building to pull the latest from the vault. Notes require `publish: true` in frontmatter to be included.

| Collection | Path | Key frontmatter |
|---|---|---|
| `writing` | `content/writing/` | `title`, `date`, `description`, `tags[]`, `status` |
| `notes` | `content/notes/` | `title`, `date`, `status` (seedling/budding/evergreen), `publish` |
| `work` | `content/work/` | `title`, `sector`, `role`, `duration`, `pillar` |

## Design system

Design tokens and visual language are documented in [`DESIGN.md`](DESIGN.md). Strategic context (users, principles, anti-references) is in [`PRODUCT.md`](PRODUCT.md). The `index.html` at the project root is a living prototype; design tokens in `src/styles/global.css` are extracted from it.

## Environment variables

Copy `.env.example` to `.env` and fill in keys to run the full feature set locally:

```
ANTHROPIC_API_KEY=     # Claude API — chat interface
VOYAGE_API_KEY=        # Embeddings for RAG
UPSTASH_VECTOR_*=      # Vector store
UPSTASH_REDIS_*=       # Rate limiting / caching
PUSHOVER_*=            # Push notifications on chat use
PREVIEW_PASSWORD=      # Basic auth gate (remove for public launch)
```
