# Reactivate the chat as "Verso", with a Telegram human takeover

## Context

The chat was never removed.
Commit `77d752e` ("Add feature flags module, turn chat off everywhere") added `src/lib/flags.ts` with `chat: false` and wrapped seven surfaces in that boolean.
Every line of the feature is intact: the site-wide dock, the RAG pipeline, the streaming route, the nav link, the prose mentions.
Flipping the flag brings all of it back.

So the real work is the second half of the ask: route visitor questions to Jody when he's around, and fall back to the model when he isn't.

The shape of that, as decided:

- The assistant gets a name, **Verso**, and the visitor only ever sees Verso.
- A Telegram bot pushes each question to Jody's phone. He replies in the thread and it goes back to the visitor verbatim, presented as Verso.
- Presence is an explicit toggle (`/on`, `/off`). While on, each question waits for him; if he doesn't answer inside the window, the RAG pipeline answers instead so nobody is left staring at a spinner.
- No visible seam. A Jody reply and a model reply are indistinguishable to the visitor.

One honesty note carried into the copy below.
The dock currently promises "It answers from Jody's published essays, notes, and briefs... It refuses what he hasn't written about," and `/about` says something similar.
That claim goes false the moment Jody is typing, so the copy gets reworded to something true on both paths.
Worth knowing: the site already forwards every question to his phone via Pushover, so a human *reading* isn't new here. Only a human *replying* is.

## The one hard mechanism

Vercel has no background jobs, so nothing can "wait 40 seconds then run the model."
The wait has to be the request itself.

`POST /api/chat` holds its SSE response open and polls Redis for a human reply.
Whichever answer arrives first, human or model, streams back through the exact same `data: {"text":...}` frames the client already parses.

The race is settled by one atomic Redis operation:

```
SET chat:msg:<mid>:claim <"human"|"llm"> NX EX 3600
```

The webhook tries to claim `human` when Jody's reply lands.
The chat route tries to claim `llm` when the timer expires.
Exactly one wins. No locks, no double answers, no lost answers.
If the route loses the claim it re-reads Jody's reply and streams that; if the webhook loses it, it tells Jody "too late, Verso already answered" and shows him what went out.

**The detail that makes the illusion work:** a verbatim human reply arriving as one instant block, next to a model reply that types out over eight seconds, is the tell.
So `chunkForTyping()` splits Jody's text on word boundaries and the send loop paces it at roughly 28ms per chunk, capped around 4s total.
Both paths type.

The existing client tolerates all of this with zero changes, which is worth knowing before touching it.
`ChatDock.astro:249-255` only inspects `event.text`, `event.sources`, `event.error` and ignores anything else, and `renderSources()` already returns `''` for an empty array.
So a new `{"cid","mid"}` handshake frame and `: ping` heartbeats are backwards compatible.

## Settled decisions

| Question | Decision | Why |
|---|---|---|
| Wait window | `HANDOFF_WINDOW_MS = 40_000` | Realistic time to unlock a phone and type. One constant; drop to 25s if Vercel clamps duration. |
| Function ceiling | `vercel({ maxDuration: 90 })` in `astro.config.mjs` | Verified adapter-level only (`@astrojs/vercel@8.2.11`, `dist/index.d.ts:34`); Astro core has no per-route `maxDuration`. Applies to `/api/mcp` too, which is harmless since it's a ceiling, not a reservation. |
| Conversation id | `crypto.randomUUID()` in `sessionStorage` under `verso:cid` | A conversation is a visit. Survives reload within the tab, which is all `transition:persist` needs. |
| History transport | Server reads it from Redis; client never sends it | Smaller client diff, and it stops a caller fabricating assistant turns into the prompt. |
| Telegram parse mode | None, plain text | Under Markdown an unbalanced `*` in a visitor's question makes Telegram 400 and the question vanishes. Under HTML, `<a href>` is link injection onto Jody's phone. Plain text parses no entities, so nothing needs escaping. |
| Pushover | Replaced by Telegram, `src/lib/notify.ts` deleted | Telegram carries the same alert plus the reply path. Keeping both double-buzzes. Do this in step 6, once the bot is proven. |

## Files

**New**

- `src/lib/redis.ts` - `getRedis(): Redis | null`, lifted verbatim from the private `makeRedis()` in `rate-limit.ts:14`. One module owning `UPSTASH_REDIS_REST_*`, one null-when-absent contract.
- `src/lib/verso.ts` - persona name, the system prompt moved out of `chat.ts:14-30` with its identity rewritten to Verso, plus pure helpers: `isValidConversationId`, `retrievalQuery`, `buildMessages`, `chunkForTyping`.
- `src/lib/handoff.ts` - presence, conversation log, claim race, final-answer record. Every function no-ops when `getRedis()` is null.
- `src/lib/telegram.ts` - `tgCall` fetch wrapper plus pure formatters: `parseCommand`, `sanitizeForTelegram`, `formatQuestionMessage`, `isOwnerUpdate`.
- `src/pages/api/telegram.ts` - the webhook.
- `scripts/telegram-setup.ts` - `setWebhook` + `setMyCommands`, run via `npm run telegram:setup`. Follows the `scripts/spotify-auth.ts` convention.
- Tests beside each lib: `verso.test.ts`, `handoff.test.ts`, `telegram.test.ts`.

**Modified**

- `src/lib/flags.ts` - `chat: true`.
- `src/lib/rate-limit.ts` - import `getRedis`, delete the local `makeRedis`, raise per-IP `slidingWindow(3, '1 m')` to `(5, '1 m')`. Its own comment says "a real human asking follow-ups will not notice"; with multi-turn, 3/min is now wrong.
- `src/pages/api/chat.ts` - the bulk of the work. Multi-turn, handshake frame, presence check, Telegram dispatch, poll loop, claim race, paced playback.
- `src/components/ChatDock.astro` - six edits, listed below.
- `astro.config.mjs` - `maxDuration`.
- `src/pages/chat.astro`, `src/pages/about.astro:25`, `src/pages/agent.astro:99` - the Verso rename and the copy fix.
- `.env.example`, `DESIGN.md`, `package.json`.

**Leave alone:** `src/components/ChatInterface.astro` (orphaned, zero importers, pre-existing) and `ask_jody` in `src/pages/api/mcp.ts` (deliberately not flag-gated, separate non-streaming surface). Note for later: after this lands, the two system prompts will have diverged in persona.

## Redis keys

`rl:chat:*` stays reserved for `@upstash/ratelimit`. App state uses a sibling `chat:` namespace.

| Key | Type | Value | TTL |
|---|---|---|---|
| `chat:presence` | string | `"1"` | 4h, so a forgotten `/on` self-heals rather than making every visitor wait 40s for nothing |
| `chat:conv:<cid>` | list | `{r:'u'\|'a', t, ts, by?}` per turn | 24h, refreshed on push |
| `chat:msg:<mid>` | string | `{cid, q, ts}` | 1h |
| `chat:msg:<mid>:claim` | string | `"human"` or `"llm"`, written only with `NX` | 1h |
| `chat:msg:<mid>:reply` | string | Jody's text, capped 4000 chars | 1h |
| `chat:msg:<mid>:final` | string | `{by, text, sources}` | 15m |
| `chat:tg:<telegram_message_id>` | string | `<mid>` | 1h |
| `chat:tg:last` | string | `<mid>` | 1h, fallback when a reply carries no `reply_to_message` |

`cid` and `mid` must be UUID-regex-validated before any interpolation into a key name, or a visitor controls the keyspace.

Cost is about 35 GETs per waiting message, comfortably inside Upstash's free tier at the 75/day cap.

## Telegram webhook

Gate order, failing closed at each step, and returning 200 on everything after auth so Telegram never redelivers (a redelivered reply is a duplicate answer):

1. `!flags.chat` → 404, matching `chat.ts:37`.
2. `TELEGRAM_WEBHOOK_SECRET` unset → 404. Unconfigured means the route does not exist.
3. `X-Telegram-Bot-Api-Secret-Token` mismatch → 401.
4. `String(msg.from?.id) !== TELEGRAM_OWNER_ID` or `msg.chat?.type !== 'private'` → silent 200. A group the bot was added to is otherwise a takeover vector.
5. Anything that isn't `update.message` → silent 200.

Commands: `/on` sets presence for 4h, `/off` clears it, `/status` reports presence, its TTL, and the day's remaining LLM budget via `Ratelimit.getRemaining('global')` (verified to exist and not consume a token).

The `/on` confirmation doubles as the operator reminder, since replies send verbatim and Verso speaks in third person:

> Handoff ON for 4h. Questions arrive here; unanswered ones fall to the model after 40s.
> Verso talks *about* Jody. Write "Jody built that", never "I built that".

Outbound questions carry `reply_markup: { force_reply: true, input_field_placeholder: 'Reply as Verso' }`, which makes replying one tap and attaches `reply_to_message` automatically.
The message header sits above the visitor's text with nothing after it, so visitor text can only append, never reframe.

**Needs a real device check:** whether iOS/Android notification-shade quick-reply preserves `reply_to_message` under `force_reply`. The `chat:tg:last` key exists precisely as the fallback if it doesn't.

## Rate limits

A question Jody answers should not spend the model budget.

Keep the per-IP check first and unchanged in position.
Replace the top-of-route `globalLimiter.limit('global')` with `getRemaining('global')`, which checks without consuming.
If the budget is exhausted *and* presence is off, return the existing 429 early.
If presence is on, proceed anyway; Jody answers for free.
Consume the token with `.limit()` only at the moment the model path actually fires, which is after headers are sent, so a cap breach surfaces as `{"error": ...}` and the existing client already renders that as the answer.

**Close the fail-open hole while in here.** When `UPSTASH_REDIS_REST_*` are missing, `getIpLimiter()` returns null and `chat.ts:68` skips limiting entirely, leaving an unmetered path to the Anthropic key. Add: if `getRedis()` is null and `VERCEL_ENV === 'production'`, return 503. Dev keeps failing open so `astro dev` works without Upstash. Six lines, highest-value hardening in the change. Tradeoff: an Upstash outage now takes chat down instead of making it free.

## Client edits (`ChatDock.astro`)

Read `DESIGN.md` first. All new CSS goes in the component's own scoped `<style>` block, not `src/styles/global.css`, which is headed "Extracted from prototype index.html - do not manually edit".

1. Naming: `.dock-title` "Ask the site" → "Verso"; `#tpl-site` `.who` "The site" → "Verso"; placeholder → "Ask Verso...".
2. `cid`: read from `sessionStorage`, send in the POST body, write back from the handshake frame. Stash `mid` on the turn element as `dataset.mid`.
3. Thinking indicator: replace `answerEl.textContent = '…'` with three staggered dots. Put the markup in the `#tpl-site` template so Astro's scoped-style hash compiles onto it and survives `cloneNode`. Colour `--ink-faint`, **not** `--accent` (see below). Wrap the animation in `@media (prefers-reduced-motion: reduce)`.
4. Long wait: after ~12s with no text, swap in a mono caption "still thinking" at `var(--t-eyebrow)` / `var(--mono)` / `var(--ink-faint)`, per the Three Voices rule that system metadata is JetBrains Mono. Client timer; the server's `: ping` frames exist only to keep the socket warm.
5. Serialise turns: disable input and submit while a turn is in flight. With 40s waits, three rapid questions means three simultaneous Telegram messages.
6. Optional, last: resume after a dropped connection. On reader error or `visibilitychange` → visible with an unfinished turn, poll `GET /api/chat-resume?m=<mid>` (a thin new route reading `chat:msg:<mid>:final`). Mobile backgrounding during a 40s wait is likely, and today that surfaces as "Network error. Try again." Build it last so it can be cut if the diff bloats.

**One Note Rule flag:** the dock already spends the accent on `.dock-title`, `.turn.site .who`, the submit button, and `.si-tag`/`.si-icon`. That's a pre-existing four-use violation in one viewport. Don't fix it here, but don't make it five.

Add a short paragraph to `DESIGN.md` §5 documenting the thinking indicator alongside the existing "Chat input" entry. Its 1200ms ambient loop sits outside the 150/250/400ms transition scale deliberately, which is worth writing down.

## Copy

Dock empty state, true whichever path answers:

> Verso answers from Jody's published essays, notes, and briefs, with sources. It refuses what isn't in the writing. Jody reads everything people ask it.

`/chat` and `/about` get the same treatment: describe Verso, drop any claim that only holds when the model is answering.

Rewrite the four probe buttons in `ChatDock.astro:7-12` against what is actually indexed. Every probe must return a real answer or the first impression of Verso is a refusal.

## Env

```
# Wizard-of-Oz handoff. Jody sends /on or /off to the bot; visitor questions
# arrive on his phone and wait 40s before the model answers.
# Register the webhook with `npm run telegram:setup`.
TELEGRAM_BOT_TOKEN=
TELEGRAM_OWNER_ID=
TELEGRAM_WEBHOOK_SECRET=
```

Remove `PUSHOVER_API_TOKEN` and `PUSHOVER_USER_KEY` in step 6.

Degradation, which must never be a crash: any `TELEGRAM_*` missing → the route never waits, goes straight to the model, and `/api/telegram` 404s. `UPSTASH_REDIS_*` missing → no presence, no history, no handoff, plus the production 503 guard above. Presence off → the exact code path that runs today.

## Blocker to clear before this is public

`content/writing/` contains one file, `Untitled.md`, with `status: draft`, which `scripts/embed.ts:84` filters out.
The embedded corpus is 2 notes and 3 work briefs.
The system prompt instructs the model to refuse anything outside the corpus, and the current probe buttons ask about "evaluation as a design discipline" and "voice interfaces", neither of which is indexed.

So: presence on and Jody answers fine; presence off and Verso refuses nearly everything.
The backstop that exists to guarantee nobody is left hanging would instead hang them with a polite refusal.

Before launch: finish `Untitled.md` with a real title and `status: published`, add a few more essays, run `npm run sync` then `npm run embed`, and rewrite the probes against what's indexed.
Acceptable interim: ship with the flag on, presence defaulting off, and probes pointed at the three work briefs, which are indexed and substantial.

## Build order

1. **Foundation.** `src/lib/redis.ts`; refactor `rate-limit.ts` to use it; raise the per-IP limit. No behaviour change. `npm test`, `npx astro check`.
2. **Pure logic.** `src/lib/verso.ts` + tests. Still unwired.
3. **State.** `src/lib/handoff.ts` + tests against a hand-rolled fake client, including two concurrent `claim()` calls where exactly one wins.
4. **Telegram lib.** `src/lib/telegram.ts` + tests.
5. **Multi-turn, handoff still off.** `chat.ts` accepts `{query, cid}`, reads and appends `chat:conv:<cid>`, emits the handshake frame, uses `buildMessages`, defers the global limiter, adds the prod guard. Flip `flags.chat = true` here and confirm nothing regressed.
6. **Webhook.** `api/telegram.ts`, `scripts/telegram-setup.ts`, `.env.example`. Drop Pushover and delete `notify.ts`. Verify with `getWebhookInfo`. Check quick-reply on a real phone.
7. **The wait loop.** Presence check, Telegram dispatch, retrieval prefetch fired in parallel without awaiting (attach `.catch()` immediately), poll loop, claim race, paced playback, heartbeats, plus a hard internal deadline so the stream is closed cleanly before Vercel kills the invocation. Set `maxDuration: 90`.
8. **Client and naming.** The six `ChatDock` edits, `/chat`, `/about:25`, `/agent:99`, `DESIGN.md`.
9. **Optional.** `/api/chat-resume` and the reconnect path.

## Verification

Unit tests, all pure logic, matching the existing `src/lib/shelf/media.test.ts` style:

- `chunkForTyping` - `chunks.join('') === input`, word boundaries held, total delay capped for a 4000-char reply.
- `buildMessages` - strict user/assistant alternation, trim to 6 turns, char budget drops oldest first, excerpts attach to the last user message only.
- `parseCommand` - `/on`, `/off@versobot`, case, leading whitespace, plain text → null.
- `sanitizeForTelegram` - truncation, control chars stripped, leading `/` neutralised, and unbalanced `*`/`_` passing through **unchanged**, which is the test that proves no parse mode is in play.
- `isOwnerUpdate` - wrong id, group chat type, missing `from`, string vs number id.
- `claim` - two concurrent calls, exactly one winner.

End to end, with `npm run dev` and a tunnel so Telegram can reach the webhook:

1. Presence off. Ask a question. Confirm it streams from the model exactly as before and Telegram shows the question with no reply prompt.
2. `/on`. Ask a question. Confirm the phone buzzes, the dock shows dots, replying in Telegram makes the answer type out in the browser labelled Verso, and the bot confirms "Sent as Verso".
3. `/on`, ask, ignore it. Confirm the model answers at ~40s, then reply late in Telegram and confirm the bot says "too late" and shows what actually went out.
4. Ask a follow-up that only resolves against history ("what about the second one?") and confirm the model has the thread.
5. Fire two questions fast and confirm the input is locked during a turn.
6. Background the tab mid-wait, return, and confirm the answer arrives rather than "Network error" (step 9 only).
7. `/status` reports presence, TTL, and remaining budget.

After the first deploy, confirm `.vercel/output/functions/_render.func/.vc-config.json` contains `"maxDuration": 90` and that Vercel accepted it.
If the plan clamps it, drop `HANDOFF_WINDOW_MS` to 25s and `maxDuration` to 60. Both are single constants.

Then `npx astro check` and `npm run build` clean.
