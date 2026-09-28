# Verso insights: Telegram notices, GA4 events and chat transcripts

Three pieces, in this order.
Each ships on its own and is useful without the next.

## Where things stand

GA4 receives one event from the code: `page_view`, sent by hand in `src/components/Analytics.astro`.
Enhanced measurement in the data stream adds `file_download` (the résumé `.docx`), scroll depth and outbound clicks.
Nothing that happens inside the site's own UI is measured.

Verso conversations are stored in Redis under `chat:conv:<cid>` and expire 24 hours after the last message (`CONV_TTL_S` in `src/lib/conversation.ts`).
Nothing reads them except the chat route.

The Telegram handoff was deleted in `b1c2172` when Verso moved to Gemini.
The bot's webhook still points at `/api/telegram`, which now returns 404, so the bot looks broken.

## 1. Telegram: notify, then reply after

Every text question and Verso's answer is pushed to Jody's phone as it finishes.
Verso never waits for him and the route keeps its 55-second deadline.
If he replies to one of those messages in Telegram, the reply is added to that visitor's conversation and shows up in their dock as a turn from Jody, labeled as him rather than Verso.

Decisions:

- The notice goes out after persistence and before the `done` frame, bounded to 3 seconds, so a slow Telegram cannot hold the answer and the send is not lost when the function freezes after the response closes.
- A failed turn is also sent, so Jody sees questions Verso could not answer.
- Messages are plain text with no `parse_mode`, per the operator surface rules in `DESIGN.md`.
- A reply must quote the question it answers (swipe to reply). A bare message is refused with "Nothing sent" instead of guessing, since there is no single waiting visitor any more.
- `chat:tg:<message_id>` maps a Telegram message to `{ cid, q }` for 24 hours, matching the conversation TTL.
- Jody's replies are stored as `{ r: 'j' }` turns. They never go to the model: `normalizeTurns` already drops any role other than `u` and `a`, so Verso cannot quote or imitate them.
- The dock polls `GET /api/replies?cid=` while a conversation exists: every 15 seconds for 2 minutes after a question, then every 60 seconds, stopping 30 minutes after the last question, and paused while the tab is hidden. It also checks once on load, so a reply reaches a visitor who reloaded.
- Replies render with the question they answer, because after a reload the original turn is no longer on screen.
- Voice turns are never sent to the server, so they are not notified.

Copy changes, which ship with this piece because Jody now reads what is asked:

- The dock note gains "Jody sees what's asked here and sometimes replies himself."
- `CLAUDE.md`, `PRODUCT.md` and the operator section of `DESIGN.md` are updated to match.

Env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_ID`, `TELEGRAM_WEBHOOK_SECRET`, locally and in Vercel.
`npm run telegram:setup` registers the webhook; `--info` shows why deliveries fail.

Done when: a question asked on a preview deploy arrives on Jody's phone with the answer, a swipe-reply appears in the visitor's dock within a poll interval, a bare message and a non-owner message send nothing, and `npm test` and `npx astro check` pass.

## 2. GA4 events

All events go through one `track(name, params)` helper that no-ops when `gtag` is absent, so dev and blocked-script visitors cost nothing.

| Event | Params | Answers |
|---|---|---|
| `contact_click` | `channel` (email, linkedin, github, behance), `location` | Who reaches out, and from where. Marked as a key event. |
| `file_download` | built in | Résumé downloads. Marked as a key event. |
| `chat_open` | `trigger` (bar, suggestion, page) | Whether people find Verso. |
| `chat_question` | `source` (typed, suggestion, retry), `outcome` (done, error, timeout, stopped), `topic`, `turn` | What they ask about without the text, and how often Verso fails them. Sent once the turn ends, so it can carry both. |
| `chat_reply_seen` | `count` | Whether Jody's Telegram replies reach anyone. |
| `chat_new` | none | How often people start over. |
| `card_click` | `kind`, `path` | Which work Verso surfaces that people follow. |
| `voice_start`, `voice_end` | `seconds`, `reason` (on end) | Whether voice is used and how it ends. |
| `shelf_open` | `kind`, `title` | What draws attention on `/library`. |
| `lightbox_open` | `page` | Which case study images get a closer look. |

Question text never goes to GA4: its terms forbid PII, people type names and emails into chat boxes, and parameter values stop at 100 characters.
Instead the server tags each question with one topic from a fixed list (work, experience, hiring, process, writing, personal, verso, other) and sends it as a `{ topic }` frame before `done`. The Telegram notice and the transcript carry it too.
The topic comes from a small classification call that runs in parallel with retrieval and is dropped if it misses its deadline.

The custom parameters must be registered as custom dimensions in GA4 before they show in reports.

## 3. Transcripts and a weekly digest

Every finished turn is also written to a transcript log kept for 30 days, separate from the 24-hour conversation used for the prompt.
Emails and phone numbers are redacted on write.
The dock note gains the retention: "Conversations are kept for 30 days."

`npm run conversations` pulls the log and has Gemini write a digest: common themes, questions Verso answered badly or could not answer, and gaps in the site's content.
It prints to the terminal and can write a Markdown file into the Obsidian vault.

## Order of work

1. Telegram, including the copy change.
2. GA4 events and topic tagging.
3. Transcript log, retention line and digest script.
