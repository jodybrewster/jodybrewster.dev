# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Behavioral Guidelines

**Think before coding.** State assumptions explicitly. If multiple interpretations exist, present them — don't pick silently. If something is unclear, stop and ask rather than guessing.

**Simplicity first.** Minimum code that solves the problem. No features beyond what was asked, no abstractions for single-use code, no speculative flexibility. If it could be 50 lines, don't write 200.

**Surgical changes.** Touch only what the task requires. Don't improve adjacent code, refactor things that aren't broken, or match a different style than what's already there. If your changes create orphaned imports/variables, remove those — but leave pre-existing dead code alone unless asked.

**Verify before reporting done.** For multi-step tasks, define success criteria upfront and confirm each step. Clarifying questions come before implementation, not after mistakes.

**Parallelize with subagents.** When the work splits into independent pieces (separate files, distinct features, isolated checks), spawn multiple subagents in a single message rather than working sequentially. Use the `general-purpose` agent for parallel writes/builds, and the `Explore` agent for parallel investigation. Brief each subagent on the existing context it needs (which components/layouts/styles to read) so it doesn't re-explore the whole repo. Skip subagents for trivially small work where their setup overhead outweighs the parallelism gain.

**Verify before inventing.** If uncertain about a file path, function signature, library version, or API, use Read/Grep/search first. Say "I don't know" rather than fabricating. Never invent imports, function names, or citation sources.

**Before any UI change, read `DESIGN.md`.** Use only the tokens, fonts, spacing, and components defined there. Do not introduce hex values, font families, or radius values outside the system.

## Commands

```bash
npm run dev        # start dev server (http://localhost:4321)
npm run build      # production build (runs pagefind after)
npm run preview    # preview production build
npm run sync       # sync content from Obsidian vault → content/
npm run spotify    # refresh Spotify listening cache → content/listening.json (also runs on prebuild)
npm run books      # resolve book catalog links + cache covers → content/library.json, public/media/
npm test           # vitest run
```

Unit tests live next to their subject (`src/lib/**/*.test.ts`) and cover the shelf's pure logic only.
Type-check with `npx astro check`.

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

Routes: `/` (redirects to `/home`), `/home` (the editorial home page), `/library` (the shelf), `/writing`, `/writing/[slug]`, `/notes`, `/notes/[slug]`, `/work`, `/work/[slug]`, `/chat`, `/now`. The `/chat` page calls API routes in `src/pages/api/` that use the Anthropic SDK + Upstash Vector for RAG over the site's own content.

The site opens on `/home`; the root redirects there (`redirects` in `astro.config.mjs`, which the Vercel adapter turns into a real redirect and which also resolves under `astro dev`). `/library` is a separate surface from the rest of the site: its own full-bleed document with no global `Nav`/`Footer`, pinned to the light palette, and the only page that loads Three.js. See below. Everything else hangs off `/home`, which is where the `Nav` logo mark points.

The `src/pages/` subdirectories exist but are mostly empty — pages are actively being built out from the `index.html` prototype.

### The /library shelf

A Three.js shelving unit at `/library`, built from `content/library.json` (89 books), `content/listening.json` (the rolling album snapshot), and the newest `writing`/`research`/`notes` entries as spiral notebooks.

- `src/lib/shelf/media.ts` normalizes all three sources into `ShelfItem`s with stable ids. Pure, never throws, drops bad rows individually.
- `src/lib/shelf/scene-state.ts` holds hover/active selection. Canvas and DOM dispatch into the same store, which is what keeps them in sync.
- `src/lib/shelf/textures.ts` draws wood, spines, plaques, and ruled notebook pages on canvas. Only real jackets and album art come from files.
- `src/lib/shelf/scene.ts` owns the renderer, procedural geometry, raycasting, and the scroll-driven camera.
- `src/components/LibraryShelf.astro` renders a complete, linked, image-bearing shelf in HTML. Three.js progressively enhances it; that markup is the whole experience on phones, without WebGL, and for assistive tech.

The `jodybrewster.dev` notebook is the way into the rest of the site. It holds a live iframe of `/home`, loaded once when the shelf boots and kept alive for the whole session. Opening the notebook grows that iframe until it fills the window; the scene stays live behind it and the URL never changes. The `Library` link inside the iframe posts `shelf:close` to the parent instead of navigating, which folds the page back onto the notebook and closes it onto the shelf.

Three rules keep that iframe alive, and breaking any one of them silently reloads the site every time the book opens:

1. Never move it in the DOM. Reparenting an iframe tears its document down. Docking is done in place, by pinning it to the viewport with its own styles while CSS3D stops stamping it.
2. Never hide it with `display: none`. Blink drops a `display:none` iframe's document and loads it again when display returns, which is why the page always looked blank at the moment the book opened. `#updatePage` keeps the CSS3D object visible and gates the element on `visibility` instead.
3. The `.library__dock` plaster is the 3D layer's sibling, so a `z-index` on the page alone cannot lift it above the dock - the whole CSS3D layer has to be raised while docked.

The scene runs at every width, including phones. It used to bail below 861px or on a coarse pointer, because fitting the unit's full width across a narrow viewport pushed the camera back far enough to show every shelf at once and make none of them legible. `#resize` now caps how far the width may push the camera (`MAX_WIDTH_FIT`) so a phone stands at roughly the desktop distance, and the width it can no longer show is reached by dragging: the canvas takes `touch-action: pan-y`, so sideways drags pan the camera and vertical ones stay a page scroll with the browser's own momentum. Close-ups are framed by height and then pulled back if the frame is too narrow for the item's width, or a book fills a portrait screen edge to edge.

Gotchas: book covers load only when a book is opened (89 jackets at once is too much texture memory); a drag past `DRAG_SLOP` must not also register as a click on whatever it ended over; and the page must stay on the light palette because the birch and plaster are baked into the textures. Devices without WebGL still get the semantic shelf.

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

## Common Pitfalls

- Design tokens live in `global.css` but are **extracted from `index.html`** — update the prototype first, then re-extract. Never manually edit the `/* Extracted from prototype */` block in `global.css`.
- Fraunces must always carry `font-variation-settings: "opsz" <value>`. Omitting `opsz` silently renders at opsz 14 regardless of size — visually wrong at display scale.
- `npm run sync` is required before `npm run build` to pull content from the Obsidian vault. Without it, content changes won't appear.
- Don't add new npm packages without first checking if the dependency already exists in `package.json`.
- Don't commit `.env` or any secrets file. Don't push to `main` without confirming with the user.
