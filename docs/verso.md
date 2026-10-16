# Verso, the chat on jodybrewster.dev

Verso is the chat on every page of the site.
It answers questions about Jody's work from his own published writing, case studies, notes and Now page, and it can talk out loud.
Jody reads along and sometimes answers himself.

The first half of this page is the plain summary.
The technical detail is in the second half, under "Verso (the chat), technical detail", and what visitors are told about their data is on [`/privacy`](../src/pages/privacy.astro).

## What a visitor gets

| Feature | What it does |
|---|---|
| Ask in text | Type a question and the answer streams in, grounded in the site's own content. Stop and Retry work while it answers, and New chat starts over. |
| Cards and links | Verso can show a case study, essay, note or the Now page as a card, and link pages inline. It can only show pages that exist and can only quote what a page really says. |
| Voice | Tap the mic and talk for up to five minutes, with a countdown. Verso answers aloud and can show the same cards. What is said aloud stays out of the text chat. |
| Jody replies | Jody sees each question on his phone. When he replies, his message appears in the chat labeled "Jody", never as Verso. For two minutes after a reply the next question waits for him, with a countdown and an "Ask Verso now" button. |
| Phones | One composer fixed to the bottom of the screen. The conversation follows you from page to page. |
| Accessibility | Works by keyboard with focus kept in place. Screen readers hear each answer once, and hear when Jody replies. Voice warns before its time runs out. |
| Honesty | The dock says Verso is an AI that can get things wrong, that Jody sees what's asked and sometimes replies, that conversations are kept 30 days, and that voice uses Google's speech AI. It links to `/privacy`. |

## What AI agents get

Other AI tools can use the site directly.

- An MCP server at `/api/mcp` (listed at `/.well-known/mcp`) with six tools: `search_writing`, `get_essay`, `list_notes`, `get_case_brief`, `whats_top_of_mind` and `ask_jody`.
- An agent card at `/agent-card.json` and an `llms.txt`.

## How it is kept safe

| Protection | In plain words |
|---|---|
| Private details removed | Emails, phone numbers, card numbers, bank numbers, ID numbers, IP addresses and secrets are removed before anything is saved or sent to Jody. The AI providers still receive the question as typed, which `/privacy` says. |
| Kept 30 days | Transcripts are deleted 30 days after a conversation's first message, and the context Verso uses for follow-ups after 24 hours. Jody's downloads follow the same 30 days. |
| Deletion on request | A visitor can ask for their conversation to be deleted. One command removes every copy the site holds and lists the few it cannot reach. Transcripts are never sent to anyone, since nobody can prove they wrote one. |
| Limits | Each visitor and the whole site have caps: 5 questions a minute per visitor and 75 answers a day site-wide, 3 voice sessions per visitor and 40 a day, and tight caps on the agent tools. When a limit cannot be checked, the answer is no. |
| Off switches | Chat, voice and each agent tool can be turned off. A switch lives in Vercel's settings, so nothing in the database can turn one back on. Visitors see a friendly "paused" message. |
| Audit log | A tamper-evident record of what Verso did: answers, Jody's replies, voice sessions, agent calls, switch changes and deletions. It never holds visitor text, an IP address or a conversation id. Each day a checkpoint goes to Jody's Telegram so the record cannot be quietly rewritten. |
| Security headers | Every page tells the browser exactly which scripts, fonts and services it may use, so injected code cannot run. Checked in three browsers. |
| Only this site | The chat, voice and agent endpoints refuse other sites' pages and old deployment URLs. Voice tokens work once, only for Verso's own setup, and expire. |
| Friendly errors | Visitors never see raw error text, only plain messages. |

## Running it (for Jody)

| Task | Command |
|---|---|
| Read recent conversations | `npm run conversations` (add `-- --digest` for a summary of themes and weak answers, `-- --vault` to put the summary in Obsidian) |
| Delete a visitor's conversation | `npm run conversation:delete -- --find "<a few words>"`, then `security find-generic-password -s "jodybrewster.dev AUDIT_CHAIN_KEY" -w \| npm run conversation:delete -- --cid <id> --yes` |
| Turn something off or on | `npm run switch -- <chat\|voice\|search_site\|ask_jody> <on\|off\|force-off>`, then `npx vercel --prod` |
| Check the audit log | `security find-generic-password -s "jodybrewster.dev AUDIT_CHAIN_KEY" -w \| npm run audit:verify -- --anchor <the latest anchor from Telegram>` |
| Reply to a visitor | Swipe-reply to the question on Telegram |
| Fix Telegram delivery | `npm run telegram:setup` (`-- --info` shows errors) |
| Refresh what Verso knows | Happens on every production build; `npm run embed -- --dry-run` checks it locally |
| Check the headers after a deploy | `curl -I https://www.jodybrewster.dev/home` |
| Deploy | `npx vercel --prod` |

The audit key lives in the macOS Keychain under "jodybrewster.dev AUDIT_CHAIN_KEY".
Vercel cannot show it back, so keep a copy in a password manager too: losing it means starting a new audit chain.

## Where it comes from

Verso is built with Google Gemini for answers and voice, Voyage and Upstash Vector to find the relevant writing, Upstash Redis for conversations, limits and the audit log, Telegram for Jody's read-along, Anthropic's Claude behind the agent tool `ask_jody`, and Vercel for hosting.
The voice session, limits, switches, audit log and security headers come from `@jodybrewster/gemini-live`, built in the gemini-live-nextjs repo and vendored here.
Visitors see these as categories on `/privacy`, not by name.

## Verso (the chat), technical detail

Moved here from `CLAUDE.md` unchanged.

### Chat

The chat persona is named Verso.
`/api/chat` answers with Google Gemini (`gemini-3.8-flash`, via `@google/genai`), grounded in the site's own corpus: each question is embedded, the top excerpts from Upstash Vector ride on the final user message, and the answer streams back over SSE.
The route holds itself to a 55-second deadline inside `maxDuration: 60` in `astro.config.mjs`, which is adapter-level because Astro has no per-route override and the adapter emits one function for every dynamic route.

Verso is an AI and never waits for a person.
Jody reads along on Telegram: after each text turn, `/api/chat` sends the question and answer to his phone (`src/lib/operator.ts`, bounded to 3 seconds, before the `done` frame so the send survives the function freezing).
If he swipe-replies, `/api/telegram` adds a `{ r: 'j' }` turn to that conversation and the dock picks it up from `/api/replies`, polling for 30 minutes after the last question.
His replies render as "Jody", never as Verso, and `normalizeTurns` keeps them out of the prompt.
A reply also makes the conversation live with him for 2 minutes (`chat:live:<cid>`, `LIVE_WINDOW_MS`), restarted by each reply: the route then holds the visitor's next question for him (`chat:held:<cid>`, a `{ hold: { until } }` frame, no model call) and the dock waits with a countdown.
When the time runs out or the visitor taps "Ask Verso now", the dock re-asks with `fallback: true`, which clears the held question first and answers normally.
The dock's note (`.dock-data-note`) says Verso is an AI and can get things wrong, that Jody sees what's asked and sometimes replies, that the site keeps conversations for 30 days and Jody's copies may be kept longer, and that voice uses Google's speech AI, then links to `/privacy`; nothing may suggest Jody writes Verso's answers.
The note names no other vendor and not the read-along channel: recipients are described by category on `/privacy` (`src/pages/privacy.astro`), which must change whenever what the site collects, who receives it or how long it is kept changes.
The ask-bar placeholder ("Ask Verso about my work") is a deliberate exception, chosen by him.
`npm run telegram:setup` registers the webhook (`-- --info` shows delivery errors); the three `TELEGRAM_*` vars are set in Vercel for Production only.
The webhook must be on `www` (the bare domain redirects, which Telegram counts as a failure).
Merging to main deploys production: `.github/workflows/deploy.yml` runs `npm test` in one job, then `vercel deploy --prod` in a second job that never installs the project, so no dependency code shares a runner with the token.
The CLI is pinned by its own lockfile in `.github/deploy-cli` (Dependabot bumps it and the SHA-pinned actions monthly).
`VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` are secrets of the GitHub `production` environment, which only `main` may deploy to; Vercel still builds remotely with its own env.
The Vercel project has no Git integration, so there are no preview deployments per branch.
`npx vercel --prod` still works by hand (a switch change with no commit needs one, or `gh workflow run deploy.yml`), and `.vercelignore` keeps `.env` out of that upload.

### Layering

Layering: `src/lib/verso.ts` is pure (persona, prompt, history assembly into Gemini `Content`).
`src/lib/conversation.ts` is the Redis history store under `chat:conv:<cid>`, distinct from the `rl:*` prefixes the rate limiter owns.
The route is deliberately thin so the decisions stay unit-testable.

The conversation ID lives in `sessionStorage` under `verso:cid`.
New chat clears it.

The server enforces an independent 55-second request deadline, plus shorter setup/retrieval/model/persistence deadlines.
The browser times out after 60 seconds, supports Stop and Retry, and consumes `done` as a terminal frame.
Stage logs contain message IDs and timing, never question text.
A timed-out rate-limit fallback is refused.

On phones, one fixed safe-area-aware composer replaces the header button, hero action and introduction card.
The panel expands above it; 16px inputs prevent iPhone focus zoom.
Conversation DOM is persisted across Astro navigation.

`npm run embed -- --dry-run` validates the complete five-collection corpus without network access.
Production Vercel builds refresh it after the application build: stage a new namespace, verify all vectors, then atomically switch `chat:corpus:active`.
Never reset the active namespace.
See `docs/verso-evaluation.md` for rollback and answer-quality checks.

Gotchas: conversation history is read server-side from Redis and never accepted from the client, or a caller could fabricate assistant turns into the prompt.
An *unreachable* Redis is not the same as an absent one: a deleted database throws a DNS error out of the rate limiter, which is why those calls are wrapped and answer 503 in production rather than a bare 500.

### Cards

The model can show the site's own content inline: `show_work`, `show_writing`, `show_note`, `show_now` and `open_page`, declared once in `src/lib/verso-tools.ts` (pure, browser-safe) and used by both the text route and voice.
`resolveCard` only returns cards for slugs and urls that exist in the card index (`src/lib/cards.ts`, served statically at `/verso-cards.json`), and `open_page` keeps a quote only if it appears verbatim in that page, so the model can pick a card but never invent one or put words in Jody's mouth.
The text route runs at most two tool rounds, sends each card as a `{ card }` SSE frame and only takes the model fallback before anything, text or card, has been sent.
Cards render from `<template>`s in `ChatDock.astro` through `src/lib/card-render.ts`, text via `textContent` only.
Verso also links pages inline as Markdown (`[title](/work/slug)`); the route checks each path against the card index and sends the real ones as a `{ links }` frame before `done`, and `src/lib/verso-links.ts` draws only those, so an invented slug shows as plain words.
The old "Explore the sources" list is gone.
Following any link in the conversation collapses the dock.

### Voice

The mic in the dock opens a Gemini Live session (`gemini-3.8-live`) that runs browser to Google, using `@jodybrewster/gemini-live` (built from the gemini-live-nextjs repo).
The server's only lever is the ephemeral token from `/api/live-token`, minted by the framework's `voiceTokenRouteFromEnv` (`@jodybrewster/gemini-live/server`): single use, locked to Verso's model, voice prompt (`src/lib/verso-voice.ts`) and tools, capped at 3 per visitor (Vercel's client IP, IPv6 by /64) and 40 site-wide per UTC day on Upstash (`rl:voice:site:*`), allowed only from the site's origins (plus the preview's own URL on a preview; `VOICE_ALLOWED_ORIGINS` overrides), refused with 503 when Redis, the key or the store is missing, and switched off by `SWITCH_VOICE=off` or `force-off` in the environment (nothing in Redis can turn it back on; a change needs a redeploy).
Local dev counts in memory (`rate-limiter-flexible`) and allows `localhost:4321`.
`lockAdditionalFields` must stay unset: Google rejects `[]` with "field_mask is invalid" once tools are locked.
In the browser, `search_site` calls `/api/corpus` and never renders; the `show_*` tools resolve against `/verso-cards.json`.
The session lives at module scope in `src/lib/live/voice.ts`, so it survives soft navigation with the dock, ends itself after five minutes (`VOICE_SESSION_MS`) and shows a countdown.
The voice chunk is preloaded at idle rather than on tap because iOS only lets audio start inside the tap handler itself (`unlockAudio()` runs before any await).
Voice turns are never sent to the server, so the text chat cannot see what was said aloud; accepting client transcripts would reopen the fabricated-history hole above.
Typing and voice never run at once.

### The vendored bundle

`@jodybrewster/gemini-live` is vendored: `vendor/jodybrewster-gemini-live-<version>.tgz`, packed from `main` of the gemini-live-nextjs repo and installed with `file:`, so Vercel installs it with no registry or token.
The browser code imports `./voice` (the session, the Live client and audio); the server entries (`./server`, `./server/limits`, `./server/switches`, `./server/headers`) are for API routes and build config only.
To update it, pack the bundle there (`npm pack` in `packages/gemini-live-bundle` after a build), replace the tarball here, point `package.json` at it and run `npm install`.
That repo's site contract mirrors `src/lib/live/voice.ts` and `voice-dock.ts` byte for byte, so it is updated alongside.
