# jodybrewster.dev

Personal site for Jody Brewster — writing, digital garden notes, and anonymized work briefs on agentic interface design, AI-native experiences, and twenty years of design craft.

Built with [Astro 5](https://astro.build), deployed to [Vercel](https://vercel.com).

## Stack

- **Framework:** Astro 5 (SSR via `@astrojs/vercel`)
- **Content:** Markdown files synced from an Obsidian vault
- **Fonts:** Barlow Semi Condensed (thin display headlines), Plus Jakarta Sans (body), JetBrains Mono (mono)
- **Search:** Pagefind (static index, generated post-build)
- **AI/Chat:** Verso, the site's chat. Google Gemini + Upstash Vector (RAG over site content), streamed over SSE with conversation history held server-side in Upstash Redis. Mobile pages have one fixed chat composer with Stop and Retry controls. See `CLAUDE.md` for the details.
- **Agent surface:** MCP server, `.md` URL pattern, `llms.txt`, A2A agent card
- **Analytics:** Google Analytics 4 (`G-4DLGJN6CZ5`) loaded directly, production builds only, plus custom events and a 30-day Verso transcript log (see below)

## Commands

```bash
npm run dev        # start dev server at http://localhost:4321
npm run build      # production build (runs pagefind after)
npm run preview    # preview production build
npm run sync       # sync content from Obsidian vault → content/
npm test           # vitest run
npm run telegram:setup   # register the Telegram webhook (-- --info shows delivery errors)
npm run conversations    # download Verso transcripts as Markdown → .conversations/
```

## Routes

The site opens on `/home`, not on `/`. The root is a redirect (declared in `astro.config.mjs`, so it resolves under `astro dev` as well as at the edge on Vercel).

| Route | What it is |
|---|---|
| `/` | Redirects to `/home` |
| `/home` | The editorial home page — the site's front door |
| `/library` | A Three.js shelf of books, albums, and notebooks. Its own full-bleed document, no masthead or footer, pinned to the light palette, and the only page that loads Three.js |
| `/writing`, `/notes`, `/work`, `/portfolio`, `/research` | Index and `[slug]` pages per collection |
| `/now`, `/about`, `/agent`, `/search` | Standalone pages |

The `jodybrewster.dev` notebook on the shelf holds a live iframe of `/home` and opens into it, so the shelf stays running behind the site rather than unloading. See `CLAUDE.md` for the rules that keep that iframe alive.

The writing and research indexes use dedicated, slug-matched editorial illustrations from `public/images/research/`. Article pages can surface the same image as a lead figure; the Jev teardown is the first writing article using that treatment. Lab notes and Now use the same Studio shell as the writing and research pages.

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

## Verso on Telegram

Verso answers every question itself and never waits for a person.
After each text turn, the question and Verso's answer go to Jody's phone through a Telegram bot, with a header like `Verso · a3f1 · q2 · hiring`.
Questions Verso could not answer are sent too, marked `· no answer`.

To answer someone, swipe right on their question in Telegram and reply.
The reply is added to that visitor's conversation and appears in their chat under "Jody", separate from Verso's answer.
The dock checks for replies for 30 minutes after the visitor's last question, so a reply only reaches someone whose tab is still open.
Replies work for 24 hours, the life of the conversation.
A message that is not a reply to a question, a sticker or an expired conversation gets "Nothing sent" back.

After you reply, Verso pauses in that conversation for 2 minutes so you can keep talking.
The visitor sees a note that you're here.
If they ask something in that window, Verso doesn't answer: the question comes to your phone marked `waiting on you`, and their chat shows a countdown with an "Ask Verso now" button.
Your reply answers it and restarts the 2 minutes.
If you don't reply in time, or they choose not to wait, Verso answers as usual.

Setup:

1. Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_ID` and `TELEGRAM_WEBHOOK_SECRET` in Vercel (Production) and in `.env`.
2. Send `/start` to the bot once from your own account, or every send fails with 403.
3. Run `npm run telegram:setup` to point the bot at `https://jodybrewster.dev/api/telegram`.
4. If nothing arrives, `npm run telegram:setup -- --info` shows Telegram's last delivery error.

The webhook has to be on `www.jodybrewster.dev`: the bare domain redirects there, and Telegram treats a redirect as a failed delivery.
Deploys go out with `vercel deploy --prod`, since the project is not connected to GitHub; `.vercelignore` keeps `.env` out of the upload.

Voice conversations stay in the browser, so they are not sent to Telegram or logged.

## Analytics

GA4 page views are sent by hand because the site navigates with `<ClientRouter />`.
In the GA4 data stream, "Page changes based on browser history events" must stay off, or every navigation counts twice.

Custom events go through `track()` in `src/lib/track.ts`, which does nothing when gtag is not loaded, so the dev server reports nothing.
No event carries anything a visitor typed.

| Event | Parameters | Fires when |
|---|---|---|
| `contact_click` | `channel`, `location` | Someone clicks the email, LinkedIn, GitHub or Behance links |
| `chat_open` | `trigger` (bar, suggestion, button, reply) | The chat panel opens |
| `chat_question` | `source`, `outcome`, `topic`, `turn` | A question finishes: done, error, timeout or stopped |
| `chat_new` | none | Someone starts a new chat |
| `chat_wait` | `result` (reply, timeout, skip, cancel) | A question held for Jody stops waiting |
| `chat_reply_seen` | `count` | A reply from Jody shows up in a visitor's chat |
| `card_click` | `kind`, `path` | Someone follows a card, case study part or source Verso showed |
| `voice_start`, `voice_end` | `seconds`, `reason` | A voice session starts or ends |
| `lightbox_open` | `page` | Someone enlarges a case study image |
| `shelf_open` | `kind`, `title` | Someone picks a book, album or game on `/library` |

The `topic` on each question comes from a small Gemini call that runs beside retrieval and can only answer work, experience, hiring, process, writing, personal, verso or other (`src/lib/topics.ts`).

In GA4, under Admin > Custom definitions, register `channel`, `location`, `trigger`, `source`, `outcome`, `topic`, `kind`, `path`, `page`, `reason` and `title` as event-scoped custom dimensions, and `turn`, `count` and `seconds` as custom metrics.
Until they are registered they do not appear in reports.
Marking `contact_click` and `file_download` as key events makes them easy to follow.

## Verso transcripts

Every question, Verso's answer and Jody's replies are written to a transcript log in Redis and kept for 30 days (`src/lib/transcripts.ts`).
Emails and phone numbers are replaced with `[email]` and `[phone]` before anything is stored.
The chat dock tells visitors that Jody sees what is asked and keeps conversations for 30 days.

`npm run conversations` downloads them as Markdown into `.conversations/`, which is gitignored because it holds visitors' words.
Each download starts with counts and topics, then lists every conversation with the page it started on.

```bash
npm run conversations                   # the last 7 days
npm run conversations -- --days 30      # further back (the log keeps 30)
npm run conversations -- --digest       # add a Gemini summary: themes, weak answers, missing content
npm run conversations -- --vault        # write into the Obsidian vault instead
npm run conversations -- --out file.md  # write to a specific file
```

It reads the production database, so `.env` needs `PROD_UPSTASH_REDIS_REST_URL` and `PROD_UPSTASH_REDIS_REST_TOKEN`, copied from the REST API section of the database at console.upstash.com.
The `PROD_` prefix keeps them away from `npm run dev`, which only reads the unprefixed `UPSTASH_REDIS_*` and so never writes local test chats into production.
`--digest` also needs `GEMINI_API_KEY`.

## Environment variables

Copy `.env.example` to `.env` and fill in keys to run the full feature set locally:

```
GEMINI_API_KEY=        # Gemini API - Verso, the chat
ANTHROPIC_API_KEY=     # Claude API - the MCP server's ask tool
VOYAGE_API_KEY=        # Embeddings for RAG
UPSTASH_VECTOR_*=      # Vector store
UPSTASH_REDIS_*=       # Rate limiting, conversations, transcripts (leave unset locally, or point at a dev database)
PROD_UPSTASH_REDIS_*=  # Production Redis, read only by npm run conversations
TELEGRAM_BOT_TOKEN=    # Verso notices to Jody's phone (from @BotFather)
TELEGRAM_OWNER_ID=     # Jody's numeric Telegram user id
TELEGRAM_WEBHOOK_SECRET= # Any long random string, checked on every webhook call
PREVIEW_PASSWORD=      # Basic auth gate (remove for public launch)
```

Verso operations, corpus refresh/rollback and representative answer checks are documented in [docs/verso-evaluation.md](docs/verso-evaluation.md). Production Vercel builds safely refresh the five-collection index after building the site; local builds do not call the embedding service.
