# Architecture

How content reaches the site, the collections and pages built from it, search, the environment and analytics.
These sections moved here from `CLAUDE.md` unchanged.
Verso has its own page in [`verso.md`](verso.md), security in [`security.md`](security.md) and the library room in [`library.md`](library.md).

## Content pipeline

Content lives in two places:
1. **Obsidian vault** at `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Sheikah Slate/personal/projects/jodybrewster.dev` — the authoring source
2. **`content/`** — the Astro content layer source, populated by `npm run sync`

`scripts/sync-vault.ts` copies files from the vault into `content/{writing,notes,work}` and `content/now.md`.
Notes require `publish: true` in frontmatter to be synced.
Running `npm run sync` before editing or building is necessary to have current content.

Wiki-links (`[[note-name]]`) in markdown are resolved to `/notes/note-name` via `remark-wiki-link`.

## Content collections (`src/content.config.ts`)

| Collection | Path | Key frontmatter |
|---|---|---|
| `writing` | `content/writing/` | `title`, `date`, `description`, `tags[]`, `status` (draft/published) |
| `notes` | `content/notes/` | `title`, `date`, `status` (seedling/budding/evergreen), `publish` |
| `work` | `content/work/` | `title`, `sector`, `role`, `duration` |

Research and notes take `publish: true`, `false` or `draft`.
A draft shows on the dev server only; a production build leaves it out of every page, feed, `llms.txt` and Verso's corpus.
Every check goes through `isPublished()` in `src/lib/publish.ts`, because 'draft' is a truthy string and a loose check would ship it.

`content/now.md` is a standalone file (not a collection), read directly by the Now page.

## Pages

Routes: `/` (redirects to `/home`), `/home` (the editorial home page), `/library` (the library room), `/writing`, `/writing/[slug]`, `/notes`, `/notes/[slug]`, `/work`, `/work/[slug]`, `/now`, `/privacy`.
Verso, the chat, is a popup on every page (not a route; `/chat` and `/ask` redirect home).
It calls `src/pages/api/chat.ts`, which uses Gemini + Upstash Vector for RAG over the site's own content.

The Studio interior surfaces (`/about`, `/work`, `/research`, `/writing`, `/notes`, `/now`, and their detail pages) share `src/layouts/Studio.astro` and the dark token set in `src/styles/studio.css`.
Article imagery is chosen by slug in `src/lib/article-images.ts`, which both the index cards (`src/components/WritingIndex.astro`) and each article's lead figure (`src/layouts/Essay.astro`) read, so every writing and research page shows the same image as its card.
The images are ink illustrations generated from the subjects, grounds and framing in `content/article-images.json` by `scripts/article-images.ts`, which holds the fixed house style; the `article-image` skill walks through making one for a new piece.
A piece missing from the manifest gets one of the fallback illustrations, picked from its slug.
Beside the body, wide screens show three or four pull quotes per piece from `content/pull-quotes.json`, kept by hand because synced frontmatter would be overwritten; `src/lib/pull-quotes.ts` drops any quote that no longer appears verbatim in the article, using the same check as Verso's `open_page`.

`/drafts` exists only on the dev server.
It lists `posts/drafts/` in the real article layout so skill-written posts can be read before they are published.
It is a rest-param route whose `getStaticPaths` returns an empty array outside dev, so a production build emits nothing and the URL 404s.
Use that shape for any local-only surface: a plain `index.astro` still ships an HTML file in a static build.

The site opens on `/home`; the root redirects there (`redirects` in `astro.config.mjs`, which the Vercel adapter turns into a real redirect and which also resolves under `astro dev`).
`/library` is a Studio page whose first screen is a Three.js room, and the only page that loads Three.js.
See [`library.md`](library.md).
Everything else hangs off `/home`, which is where the `Nav` logo mark points.

## Fonts, accent and theme

The site is dark only.
The light theme is gone; `/library` keeps the dark chrome over a bright image of a room.

`src/styles/neon.css` adds the spinning conic edge, the hover glint and the white edge flash to buttons, the chat bar and the case-study cards.

Fonts: **Barlow Semi Condensed** (headlines), **Plus Jakarta Sans** (body and UI), **JetBrains Mono** (labels), **Mr Dafoe** (the home headline's closing word).
`global.css` still carries the older Source Serif 4 type ramp for long-form pages; keep `font-variation-settings: "opsz" <value>` on it (the axis stops at 60).
Accent color is cyan `#00c6e7`.

## Search

`pagefind` runs after `astro build` (via `postbuild` script) to generate a static search index in `dist/`.
The `@pagefind/default-ui` package provides the client-side search widget.

## AI / RAG (env vars required)

The chat page and search features use:
- `GEMINI_API_KEY` - Gemini API for Verso, the chat (text answers and voice tokens)
- `ANTHROPIC_API_KEY` - Claude API for the MCP server's ask tool (`src/pages/api/mcp.ts`). The MCP route is public, so its limits are its protection: one JSON-RPC message per request (no batches), JSON only, a foreign `Origin` refused, 600-character queries, every tool call limited per IP, and `ask_jody` capped per visitor, in calls and in tokens a day (`src/lib/limits.ts`)
- `OPENAI_API_KEY` - local only, for `npm run article-images`; never needed by the build or in Vercel
- `VOYAGE_API_KEY` — embeddings (via `scripts/embed.ts`)
- `UPSTASH_VECTOR_*` — vector store for semantic search over content
- `UPSTASH_REDIS_*` — caching/rate limiting

Copy `.env.example` to `.env` and fill in keys to use these features locally.

## Analytics

Google Analytics 4, property `G-4DLGJN6CZ5`, loaded directly rather than through a tag manager.
A container was tried first and removed: one tag and one person who would ever change it does not justify 100KB and a Google UI standing between the repo and a single measurement ID.
The id is public by design, so it sits in `src/lib/analytics.ts` rather than the environment; `analyticsEnabled` gates it on `import.meta.env.PROD`, so the dev server never reports traffic.
`Analytics.astro` goes in the head of `Base.astro`, which every page uses.

Page views are sent by hand.
`Base.astro` uses `<ClientRouter />`, so every navigation after the first is a soft one and gtag's automatic page view would fire once per session rather than once per page.
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
The dock discloses the 30 days.
`npm run conversations` reads it and needs `PROD_UPSTASH_REDIS_REST_URL` and `_TOKEN` in `.env`, prefixed so the dev server never connects to production; its output goes to the gitignored `.conversations/` because it holds visitors' words.
Downloads follow the same clock: each run deletes its own earlier files (`scripts/conversation-files.ts`), a transcript file once its oldest conversation is 30 days past its first message (the file name carries that day: `verso-<written>-from-<oldest>.md`) and a digest 30 days after it was written.
`--vault` (which needs `--digest`) writes only the digest into the iCloud vault, never transcripts, and runs delete any transcript file left there.
A visitor can ask for a conversation to be deleted (never sent to them: nobody can prove they wrote one).
`npm run conversation:delete -- --find "<words>"` lists matching conversations; `-- --cid <id>` shows what the site holds and, with `--yes` and the audit chain key on stdin, checks the key against the newest chain entry (`checkChainKey`, so a wrong key is refused before anything is written), records `conversation.deleted` (warning if its anchor did not reach Telegram) and deletes every key in `src/lib/conversation-delete.ts`, then lists what it cannot reach (Telegram messages, local downloads, providers' logs).
