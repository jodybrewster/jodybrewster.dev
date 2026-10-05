# Verso, the chat on jodybrewster.dev

Verso is the chat on every page of the site.
It answers questions about Jody's work from his own published writing, case studies, notes and Now page, and it can talk out loud.
Jody reads along and sometimes answers himself.

This page is the plain summary.
The technical detail lives in [`CLAUDE.md`](../CLAUDE.md) under "Verso (the chat)", and what visitors are told about their data is on [`/privacy`](../src/pages/privacy.astro).

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
