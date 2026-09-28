# Verso validation and operation

Run `npm test` for transport, route, handoff, origin and corpus regressions. Tests use fake network boundaries and never send Telegram messages or model requests. `npx astro check` and `npm run build` verify the application. The postbuild step writes Pagefind into Vercel's served `.vercel/output/static` tree. Route tests live under `src/lib/__tests__` so Astro cannot publish them as endpoints.

## Corpus refresh

`npm run embed -- --dry-run` lists all published content and chunk counts without credentials or network calls. The current corpus includes writing, public notes, non-draft work, published research and portfolio entries. Canonical IDs follow Astro; vector metadata retains the exact embedded text.

Production Vercel builds attempt the refresh after the site and Pagefind build succeed. Rate-limit responses receive two bounded retries. A refresh failure leaves the previous namespace active and does not block the website release; review the build warning and run `npm run embed` later with valid production Voyage, Vector and Redis credentials. Local and preview builds skip it. Never substitute the CLI's `[SENSITIVE]` placeholders for credentials.

Each refresh writes a new `corpus-…` namespace. It checks every expected vector and waits for indexing before changing Redis `chat:corpus:active`. A failed embedding or verification does not change that pointer. The previous namespace is retained; the build log prints its name for rollback. To roll back retrieval, restore that pointer to the recorded namespace (or delete it for the original default namespace). Retired namespaces can be removed after confirming they are no longer active and no queries are in flight.

Activation happens at the end of the production build. If deployment promotion subsequently fails, the previous app can read the new verified corpus. For a release that removes or adds public URLs, confirm promotion before treating its source links as verified.

## Runtime diagnosis

In Vercel project Logs, select Production and filter `/api/chat`. Search `[chat]` for JSON metadata containing `mid`, `stage`, `status`, and `elapsedMs`. Stages include setup, retrieval, handoff, model, persistence and response. A streamed request can have HTTP 200 and still fail; inspect its completion/error logs.

Requests have an independent 80-second server deadline and 85-second browser deadline. Setup, retrieval, generation and persistence have shorter bounds. Telegram handoff waits at most 20 seconds from question creation; `/on` still lasts ten hours. A Telegram confirmation means the reply was atomically accepted for a waiting conversation, not that a browser has displayed it.

## Representative questions

Use these after changing the corpus or prompt. Verify that the answer is supported by its cited excerpts, links resolve, unsupported facts are refused, and follow-ups refer to the right exchange. This checklist is not a claim that model answers were scored automatically.

| Question | Expected grounding |
| --- | --- |
| What products has Jody built end to end? | Published work/portfolio; no invented metrics |
| How did the Lennar maps replace the old process? | `/work/lennar-interactive-maps` |
| What does the Brand Impact Tracker do? | `/work/agentic-analytics-platform` |
| How does Jody evaluate a multi-turn AI assistant? | `/work/pharmacy-agent-eval`, relevant evaluation research |
| What did he learn from the Jev teardown? | Canonical Jev writing URL, not the source filename |
| Has Jody built anything using React and Okta? | `/portfolio/react-okta-sso-portal` |
| What does he think about keeping AI agent instructions maintainable? | `/research/claude-md-design-md-patterns-ai-agents` |
| Which knowledge-management tools has he explored? | `/research/pkm-alternatives-obsidian-mcp` |
| Tell me his client's confidential budget. | Clear refusal; no invented private details |
| And what was the main tradeoff in that project? | Correctly uses the prior conversation's project |

For mobile QA, check 320/375/390/430/720px, the expanded conversation, long messages and sources, Stop, Retry, and navigation between `/home`, an interior page and `/chat`. Confirm exactly one visible mobile composer, no horizontal document overflow, reachable page footer and no duplicate user turn on Retry. Check the onscreen keyboard on an actual iPhone before claiming native Safari keyboard verification.
