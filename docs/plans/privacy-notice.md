# Privacy notice: a short dock notice and a /privacy page

Status: plan, 2026-10-04.

## Why

The chat dock's data note names every vendor and the Telegram read-along channel:

> Verso is an AI. It answers from Jody's writing and work, and can get things wrong. Email addresses, phone numbers and similar details are removed before anything is saved or sent to Jody. Questions go to Google (Gemini) for answers, to Voyage to find the relevant writing and to Upstash, which keeps conversations for 30 days from the first message; the site runs on Vercel. Jody reads along on Telegram, where redacted copies stay until he deletes them, and sometimes replies himself. In voice mode your audio goes to Google.

Jody thinks it gives away too much detail in the place every visitor sees.
The duties it was meeting (say it is an AI, say what happens to what you type) still apply.
So the dock keeps a short notice and links to a privacy page that covers the rest in categories, without vendor names.

## Decisions (Jody, 2026-10-04)

- Dock notice: minimal, with a link.
- Linked page: a `/privacy` page that names categories of recipients, not vendors.
- No terms page in this change.
- Downloaded transcripts are pruned to 30 days and no raw transcripts go to iCloud (security challenge 2).
- Requests are deletion only: transcripts are never sent out, since nobody can prove they wrote one; a `conversation:delete` script removes every copy (security challenge 5).
- Content delivery (fonts, album art) is listed as a recipient category (security challenge 8).

## The dock notice

Proposed text (`src/components/ChatDock.astro`, `.dock-data-note`):

> Verso is an AI and can get things wrong. Jody sees what's asked and sometimes replies. Conversations are kept for 30 days. Voice uses Google's speech AI. [Privacy](/privacy)

This is Jody's chosen minimal text plus one clause, "Jody sees what's asked and sometimes replies".
The site's own `CLAUDE.md` makes that clause a rule ("The dock says Verso is an AI and that Jody sees what's asked and sometimes replies; nothing may suggest Jody writes Verso's answers"), and a visitor who later sees a reply signed "Jody" should not be surprised that a person read their question.
It names no channel.

## The /privacy page

`src/pages/privacy.astro`, in the site's page layout, linked from the footer and from the dock notice.
Plain language, short sections, an effective date.

- **Who:** Jody Brewster runs the site; contact `jody@jodybrewster.dev` for any request.
- **What Verso is:** an AI that answers from Jody's published writing and work, and can be wrong; not professional advice.
- **What is collected and why:**
  - Questions and answers in the chat, to answer and to let Jody read along and reply. Email addresses, phone numbers and similar details are removed before anything is stored or sent to Jody.
  - In voice mode, audio streams to the speech provider while you talk; the site does not record or store it.
  - The network address of each request, briefly, to limit abuse (counters that expire within a day).
  - A security log of what the site did (answered, refused, a switch changed), with no message content, kept 13 months.
  - Analytics: page views through Google Analytics, which sets cookies.
- **Who receives it (categories):** AI model providers (to write answers, to find relevant writing, and for voice); hosting and data storage providers; a messaging service that delivers copies to Jody; an analytics provider. Providers are in the United States.
- **How long:** follow-up context 24 hours; transcripts 30 days from the first message; copies Jody receives stay until he deletes them; security log 13 months; abuse counters under a day.
- **Your choices:** don't share anything sensitive in the chat; email to ask what is held about a conversation or to have it deleted; block or clear analytics cookies.
- **Children:** not directed at children.
- **Changes:** the date at the top changes with the page.

The page does not name storage keys, providers, the read-along channel, redaction rules beyond the general sentence, limits or any other operational detail.

## Tests

- e2e (`e2e/`): the dock shows the short notice with a working Privacy link; `/privacy` renders; neither the dock nor the page mentions Telegram, Upstash, Voyage or Vercel.
- The headers suite (`playwright.headers.config.ts`) covers `/privacy` under the production CSP.
- Unit: none needed (static content); `npm test`, typecheck and build must pass.

## Out of scope

- A consent banner for analytics (GA4 stays an accepted risk; counsel may say otherwise, which becomes a separate decision for Jody).
- Terms of use.
- Other pages that describe the stack in Jody's own writing (case studies, `/agent`).

## Security challenge

From `security-architect` (challenge mode, fresh context, 2026-10-04): proceed with required changes.
No new attack surface: `/privacy` is static, the dock edit is copy only, and the headers suite covers the new route.
The risk is accuracy: a notice that says less than the code does misleads every visitor who trusts it.
Removing vendor names is a product decision, not a security control; `/agent`, the case studies and `CLAUDE.md` already name the stack.

Required changes:

1. The dock's 30 days is false for copies (9): Telegram copies stay until Jody deletes them, exposed if his account is ever taken over. Fix: "copies Jody receives may be kept longer" in the dock.
2. Downloaded transcripts break the 30-day promise and add an unlisted recipient (9): `scripts/conversations.ts` writes `.conversations/`, with `--vault` into the iCloud Obsidian vault, with `--digest` back to Gemini. Fix: the downloader prunes its own output past 30 days and stops writing raw transcripts to iCloud, or the page says Jody keeps copies of conversations he reviews and lists cloud file storage.
3. AI providers get the unredacted question (7): Gemini (answer and topic), the retrieval service and MCP's `ask_jody` (Anthropic) receive raw text. Fix: say so plainly, and name the agent (MCP) interface.
4. Analytics understated (9): events tied to the `_ga` cookie include `chat_question` (topic, outcome), `voice_start`/`voice_end` (seconds), `card_click`, `chat_reply_seen`, `shelf_open`, `contact_click` (`src/lib/chat-dock-client.ts`). Fix: "page views and how the site and chat are used (for example that a question was asked and its general topic, never its words)".
5. Access and deletion requests have no identity check and no tooling (7): someone who knows roughly when a colleague asked could request their transcript; nothing deletes one conversation everywhere (`chat:conv`, `chat:log` and its index entry, the operator mapping, held and live keys, Telegram messages, local and iCloud copies). Fix: a reference for each conversation from the keyed `ref()` (never the raw cid, which `/api/replies` treats as a bearer token), transcripts disclosed only to its holder and deletion for anyone else, and a `conversation:delete` script.

Open questions:

6. The Gemini tier of each key (text and voice tokens) and Voyage's training and retention setting (5, verify).
7. How long Vercel keeps client IPs in request logs, and whether a log drain is on (5, verify).
8. Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`) and album art (`i.scdn.co`) send IP and referrer to Google and Spotify (6): add a "content delivery (fonts, images)" category or self-host.

Accepted risk: GA4 without a consent banner (Jody).

## Legal review

From pro-legal's `software-counsel` (plan mode, fresh context, 2026-10-04): clear with changes, nothing blocking.
Categories of recipients instead of vendor names are allowed (GDPR Art. 13(1)(e), CalOPPA BPC 22575(b)(1)).
It assumed Jody is in the US and visitors come from anywhere.
Its required changes, each folded into the build:

- The dock understated retention: Jody's copies outlast 30 days and providers keep their own logs. The dock says "The site keeps conversations for 30 days; Jody's copies may be kept longer."
- Redaction covers what the site stores and what it sends to Jody, not what reaches the AI providers: the page says providers receive questions as typed. Questions sent through the MCP endpoint go to an AI provider too and are not stored.
- Voice: the site does not store audio, but providers may keep copies for a limited time under their own terms, for example to detect abuse. The same goes in "How long".
- Children: "not intended for anyone under 18", to match the Gemini API terms.
- Analytics: page views and how the site is used (opening the chat, following links, the general topic of a question, never its text), with the link Google's terms require: https://policies.google.com/technologies/partner-sites.
- CalOPPA: the site does not respond to Do Not Track signals; Google may collect information about activity on this and other sites through its cookies.
- GDPR and UK GDPR: a short "Legal basis and your rights" section (legitimate interests for answering and limiting abuse; the rights to access, delete, correct, restrict and object; the right to complain to a supervisory authority; transfers on the providers' standard safeguards).
- Providers are "in the United States and other countries".
- Requests: conversations are anonymous, so a request gives roughly when and a few words of the question; deletion covers the site's copies and Jody's, not providers' short-term logs; a transcript is shared only with someone who shows they wrote it.
- Retention precision: follow-up context 24 hours after the last message; the security log about 13 months; the chat's tab storage (conversation id, reply state) is strictly necessary and clears when the tab closes.

For Jody, outside the code:

- Confirm the Gemini API project is billed (paid tier). On the unpaid tier Google may use inputs to improve its products with human review, and the terms allow only paid services for users in the EEA, Switzerland and the UK.
- Question for a lawyer, if wanted: whether GDPR reaches the site through analytics cookies, and if so whether the Art. 27(2)(a) representative exemption applies.

Accepted risk (Jody, unchanged): GA4 runs without a consent banner. Counsel notes EU ePrivacy and UK PECR require consent for analytics cookies and Google's terms require it where law does, with low enforcement odds for a personal site. Cheaper exits if this changes: consent mode with storage denied by default for EEA and UK visitors, or cookieless analytics. Counsel also suggests `allow_google_signals: false` and `allow_ad_personalization_signals: false`, which narrows what Google collects.
