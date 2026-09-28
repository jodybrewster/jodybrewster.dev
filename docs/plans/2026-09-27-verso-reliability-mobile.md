# Verso reliability and mobile layout implementation plan

> For agentic workers: use subagent-driven-development for the independent backend tasks and inline execution for the shared chat UI. User authorized the review fixes and supplied the mobile direction on 2026-09-27.

Goal: make Verso recover predictably from service failures, ground answers in the complete published site, and offer one usable mobile chat composer without horizontal page overflow.

Architecture: retain Astro, the existing SSE protocol, Redis handoff, and the existing visual tokens. One persisted ChatDock expands above its fixed mobile composer. Retrieval uses canonical published content IDs and versioned index replacement. No decorative voice controls are introduced.

## Tasks and file boundaries

- [x] Request reliability: `src/pages/api/chat.ts`, `src/lib/redis.ts`, new deadline helpers and route tests. Enforce cancellation independently of chunk arrival; bound upstream waits; log stages and elapsed time without messages or credentials; handle invalid request shapes; test stalled retrieval/model, disconnects and completion.
- [x] Retrieval: `scripts/embed.ts`, `src/lib/rag.ts`, new corpus/index helpers and tests. Include published writing/notes/work/research/portfolio, use Astro-compatible IDs and URLs, preserve extension and exact indexed text, reject unpublished material, build/validate a replacement namespace before activation, never reset the active index. Pass optional abort signals without breaking current callers. Document refresh workflow.
- [x] Handoff and origin: `src/lib/handoff.ts`, `src/lib/telegram.ts`, `src/pages/api/telegram.ts`, `src/lib/rate-limit.ts`, colocated tests. Save claim/reply atomically, distinguish failed writes from lost races, reject expired explicit targets, bound Telegram calls, use a 20-second human window, compare parsed exact origins, preserve rate limits and privacy boundaries.
- [x] Mobile and client: `ChatDock.astro`, home/nav styles and layouts, client stream helper/tests. Hide header and hero Verso entry points below 720px. Show one fixed safe-area-aware composer with an expanding conversation panel; make name entry optional; add timeout/retry/cancel recovery; preserve state across navigation and fit keyboard viewport. Repair measured overflow at its source. Keep featured case studies in a contained swipe row on phones, following the reference.
- [x] Verification: run focused regressions then full tests, Astro check/build, mobile browser widths 320/375/390/430/720 and desktop 1440, chat open/close, streamed reply, error/retry, keyboard viewport simulation and navigation. Record production activation prerequisites without exposing secrets.
- [x] Documentation: update current Verso and mobile behavior in README, CLAUDE and DESIGN; keep changes aligned with the implemented result.

## Acceptance checks

1. A nonresponding upstream cannot leave the browser busy indefinitely; a useful error and retry are available.
2. Content links match the rendered pages; a failed refresh leaves the previous index usable.
3. Telegram does not confirm a reply whose write failed; expired replies do not route to a different visitor.
4. A lookalike hostname does not satisfy the origin guard.
5. On mobile there is one visible Verso entry, the fixed composer, and document width never exceeds the viewport. The footer remains reachable and the composer remains visible when the viewport shrinks.
6. Existing tests and new meaningful regressions pass; no live questions or Telegram messages are sent during automated tests.

Validation: 206 tests passing; Astro check has zero errors/warnings (nine existing hints); production build passes. Browser checked stream/error/retry, persisted navigation, 320–1440px document widths, a 390×360px reduced viewport, and built Pagefind search results. Native iPhone keyboard behavior is not verified. Production deployment follows local verification.
