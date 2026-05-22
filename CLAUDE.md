# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Behavioral Guidelines

**Think before coding.** State assumptions explicitly. If multiple interpretations exist, present them — don't pick silently. If something is unclear, stop and ask rather than guessing.

**Simplicity first.** Minimum code that solves the problem. No features beyond what was asked, no abstractions for single-use code, no speculative flexibility. If it could be 50 lines, don't write 200.

**Surgical changes.** Touch only what the task requires. Don't improve adjacent code, refactor things that aren't broken, or match a different style than what's already there. If your changes create orphaned imports/variables, remove those — but leave pre-existing dead code alone unless asked.

**Verify before reporting done.** For multi-step tasks, define success criteria upfront and confirm each step. Clarifying questions come before implementation, not after mistakes.

**Parallelize with subagents.** When the work splits into independent pieces (separate files, distinct features, isolated checks), spawn multiple subagents in a single message rather than working sequentially. Use the `general-purpose` agent for parallel writes/builds, and the `Explore` agent for parallel investigation. Brief each subagent on the existing context it needs (which components/layouts/styles to read) so it doesn't re-explore the whole repo. Skip subagents for trivially small work where their setup overhead outweighs the parallelism gain.

## Commands

```bash
npm run dev        # start dev server (http://localhost:4321)
npm run build      # production build (runs pagefind after)
npm run preview    # preview production build
npm run sync       # sync content from Obsidian vault → content/
```

No test suite. Type-check with `npx astro check`.

## Architecture

This is an **Astro 5 static site** deployed to Vercel. It's a personal site for Jody Brewster (jodybrewster.dev) with writing, digital garden notes, work briefs, and an AI chat interface.

### Content pipeline

Content lives in two places:
1. **Obsidian vault** at `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Sheikah Slate/personal/projects/jodybrewster.dev` — the authoring source
2. **`content/`** — the Astro content layer source, populated by `npm run sync`

`scripts/sync-vault.ts` copies files from the vault into `content/{writing,notes,work}` and `content/now.md`. Notes require `publish: true` in frontmatter to be synced. Running `npm run sync` before editing or building is necessary to have current content.

### Content collections (`src/content.config.ts`)

| Collection | Path | Key frontmatter |
|---|---|---|
| `writing` | `content/writing/` | `title`, `date`, `description`, `tags[]`, `status` (draft/published) |
| `notes` | `content/notes/` | `title`, `date`, `status` (seedling/budding/evergreen), `publish` |
| `work` | `content/work/` | `title`, `sector`, `role`, `duration` |

`content/now.md` is a standalone file (not a collection), read directly by the Now page.

### Pages

Routes: `/` (home), `/writing`, `/writing/[slug]`, `/notes`, `/notes/[slug]`, `/work`, `/work/[slug]`, `/chat`, `/now`. The `/chat` page calls API routes in `src/pages/api/` that use the Anthropic SDK + Upstash Vector for RAG over the site's own content.

The `src/pages/` subdirectories exist but are mostly empty — pages are actively being built out from the `index.html` prototype.

### Design system

`index.html` is a **living prototype** for the full Astro build, not a throwaway file. Design tokens are extracted from it into `src/styles/global.css` (marked with `/* Extracted from prototype index.html — do not manually edit design tokens */`). When updating the visual design, update `index.html` first and re-extract to `global.css`.

Fonts: **Fraunces** (display/editorial serif), **Inter** (body/UI sans), **JetBrains Mono** (mono). Accent color: `#2d5d4f` (forest green).

Wiki-links (`[[note-name]]`) in markdown are resolved to `/notes/note-name` via `remark-wiki-link`.

### Search

`pagefind` runs after `astro build` (via `postbuild` script) to generate a static search index in `dist/`. The `@pagefind/default-ui` package provides the client-side search widget.

### AI / RAG (env vars required)

The chat page and search features use:
- `ANTHROPIC_API_KEY` — Claude API for the chat interface
- `VOYAGE_API_KEY` — embeddings (via `scripts/embed.ts`)
- `UPSTASH_VECTOR_*` — vector store for semantic search over content
- `UPSTASH_REDIS_*` — caching/rate limiting
- `PUSHOVER_*` — push notifications when someone uses the chat

Copy `.env.example` to `.env` and fill in keys to use these features locally.
