# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this site is for

Everything here serves one goal: conveying what it is like to work with Jody, and who he is. It is not a portfolio that lists what he has done, and not a blog that happens to carry his name. A reader should come away with a sense of how he thinks, what he notices, and what having him on a team would actually be like.

That goal settles the decisions that would otherwise come down to taste. When a call is genuinely close, take the option that reveals more of the person:

- Specific over general. One real constraint from real work says more than a well-phrased principle.
- Working over finished. The research notes, the annotated drafts, the numbered briefs, the visible seedling and draft states: these exist because how the work happens is the point, not a byproduct of it.
- Voice over polish. A page that reads like a person wrote it beats one that reads like a template, even when the template is tidier.
- Nothing that could sit unchanged on someone else's site.

This is also why the anti-references in `PRODUCT.md` are what they are. The generic portfolio, the SaaS landing page and the AI startup aesthetic all fail the same test: each one would describe anybody.

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
npm run games      # cache box art named in content/games.json → public/media/games/
npm run article-images  # generate the ink illustrations named in content/article-images.json → public/images/articles/ (OpenAI gpt-image-2, needs OPENAI_API_KEY)
npm run conversations  # download the last 7 days of Verso transcripts → .conversations/ (--days, --digest, --vault)
npm test           # vitest run
```

Unit tests live under `src/lib/**/*.test.ts` and cover the shelf, Verso transport/routes, conversation history, origins and corpus. Route tests belong in `src/lib/__tests__`, never under `src/pages` where Astro would publish them.
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

Routes: `/` (redirects to `/home`), `/home` (the editorial home page), `/library` (the shelf), `/writing`, `/writing/[slug]`, `/notes`, `/notes/[slug]`, `/work`, `/work/[slug]`, `/now`. Verso, the chat, is a popup on every page (not a route; `/chat` and `/ask` redirect home). It calls `src/pages/api/chat.ts`, which uses Gemini + Upstash Vector for RAG over the site's own content.

The Studio interior surfaces (`/about`, `/work`, `/research`, `/writing`, `/notes`, `/now`, and their detail pages) share `src/layouts/Studio.astro` and the dark token set in `src/styles/studio.css`. Article imagery is chosen by slug in `src/lib/article-images.ts`, which both the index cards (`src/components/WritingIndex.astro`) and each article's lead figure (`src/layouts/Essay.astro`) read, so every writing and research page shows the same image as its card. The images are ink illustrations generated from the subjects, grounds and framing in `content/article-images.json` by `scripts/article-images.ts`, which holds the fixed house style; the `article-image` skill walks through making one for a new piece. A piece missing from the manifest gets one of the fallback illustrations, picked from its slug. Beside the body, wide screens show three or four pull quotes per piece from `content/pull-quotes.json`, kept by hand because synced frontmatter would be overwritten; `src/lib/pull-quotes.ts` drops any quote that no longer appears verbatim in the article, using the same check as Verso's `open_page`.

`/drafts` exists only on the dev server. It lists `posts/drafts/` in the real article layout so skill-written posts can be read before they are published. It is a rest-param route whose `getStaticPaths` returns an empty array outside dev, so a production build emits nothing and the URL 404s. Use that shape for any local-only surface: a plain `index.astro` still ships an HTML file in a static build.

The site opens on `/home`; the root redirects there (`redirects` in `astro.config.mjs`, which the Vercel adapter turns into a real redirect and which also resolves under `astro dev`). `/library` is a separate surface from the rest of the site: its own full-bleed document with no global `Nav`/`Footer`, pinned to the light palette, and the only page that loads Three.js. See below. Everything else hangs off `/home`, which is where the `Nav` logo mark points.

The `src/pages/` subdirectories exist but are mostly empty — pages are actively being built out from the `index.html` prototype.

### Verso (the chat)

The chat persona is named Verso. `/api/chat` answers with Google Gemini (`gemini-3.8-flash`, via `@google/genai`), grounded in the site's own corpus: each question is embedded, the top excerpts from Upstash Vector ride on the final user message, and the answer streams back over SSE. The route holds itself to a 55-second deadline inside `maxDuration: 60` in `astro.config.mjs`, which is adapter-level because Astro has no per-route override and the adapter emits one function for every dynamic route.

Verso is an AI and never waits for a person. Jody reads along on Telegram: after each text turn, `/api/chat` sends the question and answer to his phone (`src/lib/operator.ts`, bounded to 3 seconds, before the `done` frame so the send survives the function freezing). If he swipe-replies, `/api/telegram` adds a `{ r: 'j' }` turn to that conversation and the dock picks it up from `/api/replies`, polling for 30 minutes after the last question. His replies render as "Jody", never as Verso, and `normalizeTurns` keeps them out of the prompt. A reply also makes the conversation live with him for 2 minutes (`chat:live:<cid>`, `LIVE_WINDOW_MS`), restarted by each reply: the route then holds the visitor's next question for him (`chat:held:<cid>`, a `{ hold: { until } }` frame, no model call) and the dock waits with a countdown. When the time runs out or the visitor taps "Ask Verso now", the dock re-asks with `fallback: true`, which clears the held question first and answers normally. The dock says Verso is an AI and that Jody sees what's asked and sometimes replies; nothing may suggest Jody writes Verso's answers. The ask-bar placeholder ("Ask Verso about my work") is a deliberate exception, chosen by him. `npm run telegram:setup` registers the webhook (`-- --info` shows delivery errors); the three `TELEGRAM_*` vars are set in Vercel for Production only. The webhook must be on `www` (the bare domain redirects, which Telegram counts as a failure). Production deploys use `npx vercel --prod`; the project has no Git integration, and `.vercelignore` keeps `.env` out of the upload.

Layering: `src/lib/verso.ts` is pure (persona, prompt, history assembly into Gemini `Content`). `src/lib/conversation.ts` is the Redis history store under `chat:conv:<cid>`, distinct from the `rl:*` prefixes the rate limiter owns. The route is deliberately thin so the decisions stay unit-testable.

Rate limits all live in `src/lib/limits.ts`, on the framework's limiter (`@jodybrewster/gemini-live/server/limits`): Upstash on Vercel (`RATE_LIMIT_STORE` defaults to `upstash` there; no Redis refuses with 503), memory in `astro dev`. Every limiter fails closed. Chat: 5 a minute per visitor and 75 answers a day site-wide (a quota checked at setup and spent just before the model call); voice search shares the chat's per-visitor counter; MCP: 20 tool calls a minute per visitor, and `ask_jody` 5 an hour per visitor, 50 calls a day and 250,000 tokens a day (each call reserves its worst case before calling Claude and settles from the reported usage); reply polling: 60 a minute per visitor. The visitor is Vercel's trusted client IP, IPv6 by /64. Windows are fixed, a UTC day on Upstash, so up to twice a daily cap can pass around midnight UTC. Origin checks are in `src/lib/origin.ts`.

The conversation ID lives in `sessionStorage` under `verso:cid`. New chat clears it.

The server enforces an independent 55-second request deadline, plus shorter setup/retrieval/model/persistence deadlines. The browser times out after 60 seconds, supports Stop and Retry, and consumes `done` as a terminal frame. Stage logs contain message IDs and timing, never question text. A timed-out rate-limit fallback is refused.

On phones, one fixed safe-area-aware composer replaces the header button, hero action and introduction card. The panel expands above it; 16px inputs prevent iPhone focus zoom. Conversation DOM is persisted across Astro navigation.

`npm run embed -- --dry-run` validates the complete five-collection corpus without network access. Production Vercel builds refresh it after the application build: stage a new namespace, verify all vectors, then atomically switch `chat:corpus:active`. Never reset the active namespace. See `docs/verso-evaluation.md` for rollback and answer-quality checks.

Gotchas: conversation history is read server-side from Redis and never accepted from the client, or a caller could fabricate assistant turns into the prompt. An *unreachable* Redis is not the same as an absent one: a deleted database throws a DNS error out of the rate limiter, which is why those calls are wrapped and answer 503 in production rather than a bare 500.

**Cards.** The model can show the site's own content inline: `show_work`, `show_writing`, `show_note`, `show_now` and `open_page`, declared once in `src/lib/verso-tools.ts` (pure, browser-safe) and used by both the text route and voice. `resolveCard` only returns cards for slugs and urls that exist in the card index (`src/lib/cards.ts`, served statically at `/verso-cards.json`), and `open_page` keeps a quote only if it appears verbatim in that page, so the model can pick a card but never invent one or put words in Jody's mouth. The text route runs at most two tool rounds, sends each card as a `{ card }` SSE frame and only takes the model fallback before anything, text or card, has been sent. Cards render from `<template>`s in `ChatDock.astro` through `src/lib/card-render.ts`, text via `textContent` only. Verso also links pages inline as Markdown (`[title](/work/slug)`); the route checks each path against the card index and sends the real ones as a `{ links }` frame before `done`, and `src/lib/verso-links.ts` draws only those, so an invented slug shows as plain words. The old "Explore the sources" list is gone. Following any link in the conversation collapses the dock.

**Voice.** The mic in the dock opens a Gemini Live session (`gemini-3.8-live`) that runs browser to Google, using `@jodybrewster/gemini-live` (built from the gemini-live-nextjs repo). The server's only lever is the ephemeral token from `/api/live-token`, minted by the framework's `voiceTokenRouteFromEnv` (`@jodybrewster/gemini-live/server`): single use, locked to Verso's model, voice prompt (`src/lib/verso-voice.ts`) and tools, capped at 3 per visitor (Vercel's client IP, IPv6 by /64) and 40 site-wide per UTC day on Upstash (`rl:voice:site:*`), allowed only from the site's origins (plus the preview's own URL on a preview; `VOICE_ALLOWED_ORIGINS` overrides), refused with 503 when Redis, the key or the store is missing, and switched off by `SWITCH_VOICE=off` or `force-off` in the environment (nothing in Redis can turn it back on; a change needs a redeploy). Local dev counts in memory (`rate-limiter-flexible`) and allows `localhost:4321`. `lockAdditionalFields` must stay unset: Google rejects `[]` with "field_mask is invalid" once tools are locked. In the browser, `search_site` calls `/api/corpus` and never renders; the `show_*` tools resolve against `/verso-cards.json`. The session lives at module scope in `src/lib/live/voice.ts`, so it survives soft navigation with the dock, ends itself after five minutes (`VOICE_SESSION_MS`) and shows a countdown. The voice chunk is preloaded at idle rather than on tap because iOS only lets audio start inside the tap handler itself (`unlockAudio()` runs before any await). Voice turns are never sent to the server, so the text chat cannot see what was said aloud; accepting client transcripts would reopen the fabricated-history hole above. Typing and voice never run at once.

`@jodybrewster/gemini-live` is vendored: `vendor/jodybrewster-gemini-live-<version>.tgz`, packed from `main` of the gemini-live-nextjs repo and installed with `file:`, so Vercel installs it with no registry or token. The browser code imports `./voice` (the session, the Live client and audio); the server entries (`./server`, `./server/limits`, `./server/switches`, `./server/headers`) are for API routes and build config only. To update it, pack the bundle there (`npm pack` in `packages/gemini-live-bundle` after a build), replace the tarball here, point `package.json` at it and run `npm install`. That repo's site contract mirrors `src/lib/live/voice.ts` and `voice-dock.ts` byte for byte, so it is updated alongside.

### The /library shelf

A Three.js shelving unit at `/library`, built from `content/library.json` (93 books), `content/listening.json` (the rolling album snapshot) and `content/games.json` (the games Jody played in the past month).

- `src/lib/shelf/media.ts` normalizes all three sources into `ShelfItem`s with stable ids. Pure, never throws, drops bad rows individually.
- `src/lib/shelf/scene-state.ts` holds hover/active selection. Canvas and DOM dispatch into the same store, which is what keeps them in sync.
- `src/lib/shelf/textures.ts` draws wood, spines, plaques and the game cases (plastic, platform band, spine) on canvas. Only real jackets, album art and box art come from files.
- `src/lib/shelf/scene.ts` owns the renderer, procedural geometry, raycasting, and the scroll-driven camera.
- `src/components/LibraryShelf.astro` renders a complete, linked, image-bearing shelf in HTML. Three.js progressively enhances it; that markup is the whole experience without WebGL and for assistive tech.

The middle shelf holds game cases, cover-out, at real size against the jewel cases: a Switch case is 10.5 x 17 cm in red plastic, a PS5 case 13.5 x 17 cm in blue. The case is drawn; only the cover art is a file. `content/games.json` is kept by hand: title, platform, optional `note` (shown on the card), optional `url` to the game's official page, and `coverSource`, the Wikipedia file page the art comes from. `npm run games` downloads each cover once into `public/media/games/` and writes `cover` back; the cached files are committed like the book jackets and nothing in the build fetches them. Art wider than the case front is shown whole over a blurred bleed rather than cropped, because box art titles tend to run edge to edge. Picking a case opens the same close-up and card as a book or album.

`.library__back` is the page's only navigation - the shelf has no masthead. It is `position: fixed` with `z-index: 50` over the stage.

The scene runs at every width, including phones. It used to bail below 861px or on a coarse pointer, because fitting the unit's full width across a narrow viewport pushed the camera back far enough to show every shelf at once and make none of them legible. `#resize` now caps how far the width may push the camera (`MAX_WIDTH_FIT`) so a phone stands at roughly the desktop distance, and the width it can no longer show is reached by dragging: the canvas takes `touch-action: pan-y`, so sideways drags pan the camera and vertical ones stay a page scroll with the browser's own momentum. Close-ups are framed by height and then pulled back if the frame is too narrow for the item's width, or a book fills a portrait screen edge to edge.

Gotchas: book covers load only when a book is opened (89 jackets at once is too much texture memory), while the five game covers face out and load up front; a drag past `DRAG_SLOP` must not also register as a click on whatever it ended over; and the page must stay on the light palette because the birch and plaster are baked into the textures. Devices without WebGL still get the semantic shelf.

### Design system

`index.html` is a **living prototype** for the full Astro build, not a throwaway file. Design tokens are extracted from it into `src/styles/global.css` (marked with `/* Extracted from prototype index.html — do not manually edit design tokens */`). When updating the visual design, update `index.html` first and re-extract to `global.css`.

Fonts: **Source Serif 4** (display/editorial serif, opsz 8-60, wght 200-900), **Plus Jakarta Sans** (body/UI sans, wght 200-800, base weight 200), **JetBrains Mono** (mono). Accent color: `#2d5d4f` (forest green).

Wiki-links (`[[note-name]]`) in markdown are resolved to `/notes/note-name` via `remark-wiki-link`.

### Search

`pagefind` runs after `astro build` (via `postbuild` script) to generate a static search index in `dist/`. The `@pagefind/default-ui` package provides the client-side search widget.

### AI / RAG (env vars required)

The chat page and search features use:
- `GEMINI_API_KEY` - Gemini API for Verso, the chat (text answers and voice tokens)
- `ANTHROPIC_API_KEY` - Claude API for the MCP server's ask tool (`src/pages/api/mcp.ts`). The MCP route is public, so its limits are its protection: one JSON-RPC message per request (no batches), JSON only, a foreign `Origin` refused, 600-character queries, every tool call limited per IP, and `ask_jody` capped per visitor, in calls and in tokens a day (`src/lib/limits.ts`)
- `OPENAI_API_KEY` - local only, for `npm run article-images`; never needed by the build or in Vercel
- `VOYAGE_API_KEY` — embeddings (via `scripts/embed.ts`)
- `UPSTASH_VECTOR_*` — vector store for semantic search over content
- `UPSTASH_REDIS_*` — caching/rate limiting

Copy `.env.example` to `.env` and fill in keys to use these features locally.

### Analytics

Google Analytics 4, property `G-4DLGJN6CZ5`, loaded directly rather than through a tag manager.
A container was tried first and removed: one tag and one person who would ever change it does not justify 100KB and a Google UI standing between the repo and a single measurement ID.
The id is public by design, so it sits in `src/lib/analytics.ts` rather than the environment; `analyticsEnabled` gates it on `import.meta.env.PROD`, so the dev server never reports traffic.
`Analytics.astro` goes in the head of each of the two HTML documents - `Base.astro` and `library.astro` - since the shelf does not use the shared layout.

Page views are sent by hand. `Base.astro` uses `<ClientRouter />`, so every navigation after the first is a soft one and gtag's automatic page view would fire once per session rather than once per page.
`send_page_view: false` turns that off; one call covers the landing page and an `astro:after-swap` listener covers the rest, reading title and URL after the swap rather than before.

Two settings outside this repo can break the count, both in the GA4 data stream.
**"Page changes based on browser history events"** must stay off under Enhanced measurement: the site navigates with `pushState`, so leaving it on double-counts every navigation.
Enhanced measurement's other toggles are harmless.

Custom events all go through `track()` in `src/lib/track.ts`, which no-ops without gtag, so callers never check the environment.
They are `contact_click`, `chat_open`, `chat_question` (source, outcome, topic, turn), `chat_new`, `chat_reply_seen`, `card_click`, `voice_start`, `voice_end`, `lightbox_open` and `shelf_open`.
Parameters are values the site chooses, never visitor text; GA4 forbids PII and a chat box is where people type theirs.
A question's topic comes from a small Gemini call beside retrieval (`src/lib/topics.ts`), constrained to a fixed list so free text cannot leak into GA4.
Each custom parameter must be registered as a custom dimension in GA4 before it appears in reports.

Verso's words go to the transcript log instead (`src/lib/transcripts.ts`): `chat:log:<cid>` lists plus a `chat:log:index` sorted set, kept 30 days, with emails and phone numbers redacted on write.
The dock discloses the 30 days. `npm run conversations` reads it and needs `PROD_UPSTASH_REDIS_REST_URL` and `_TOKEN` in `.env`, prefixed so the dev server never connects to production; its output goes to the gitignored `.conversations/` because it holds visitors' words.

## Common Pitfalls

- Design tokens live in `global.css` but are **extracted from `index.html`** — update the prototype first, then re-extract. Never manually edit the `/* Extracted from prototype */` block in `global.css`.
- Source Serif 4 must always carry `font-variation-settings: "opsz" <value>`. Omitting `opsz` silently renders at opsz 14 regardless of size, which is visually wrong at display scale.
- The opsz axis stops at 60. Values above it are clamped by the browser, so writing `"opsz" 120` renders identically to `"opsz" 60` and just misleads the next reader. The ramp was originally built against Fraunces, which went to 144; every value was capped when the face changed.
- `npm run sync` is required before `npm run build` to pull content from the Obsidian vault. Without it, content changes won't appear.
- Don't add new npm packages without first checking if the dependency already exists in `package.json`.
- Don't commit `.env` or any secrets file. Don't push to `main` without confirming with the user.
