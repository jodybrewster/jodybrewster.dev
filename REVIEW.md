# Review

How to review a change to jodybrewster.dev.
Merging to `main` deploys production.
This review is the last look before visitors see the change.
Run the three passes in order and mark every finding Important or Nit.

## What Important means

A finding is Important when merging would ship a bug a visitor can hit, break a security invariant below or contradict the change's plan or `DESIGN.md`.
Important findings block the merge.
Each one names the file, the line and what a visitor or attacker would see.
Everything else is a nit.
Report at most five nits, the five most worth fixing.
Say how many more you left out.

## Pass 1: bugs

- Logic errors, unhandled failures and edge cases in the diff, read against how a visitor reaches the code.
- A draft or `publish: false` page that can reach a production build, a feed, `llms.txt` or Verso's corpus.
- A local-only surface that still emits HTML in a static build.
- Script that runs once on load and breaks after a soft navigation (`astro:after-swap`).
- A card, link or pull quote that can point at a page or quote that does not exist.
- Library changes that leave the HTML list incomplete without WebGL, or that ignore reduced motion.

## Pass 2: security

The invariants are written up in `docs/security.md` and `docs/verso.md`.
Breaking any of them is Important.

- No personal data in logs or GA4: stage logs carry ids and timing, GA4 parameters are values the site chooses and never visitor text.
- Every API route refuses foreign hosts in production through `isCanonicalHost`, including a route added in this change.
- A new inline script hash enters `security/inline-scripts.json` only through `npm run security:approve`, after its source was checked; a new host goes in `src/lib/security.ts`.
- Every rate limiter fails closed and an unreachable Redis answers 503.
- Conversation history is read from Redis and never accepted from the client; voice transcripts stay in the browser.
- Kill switches are read from the environment only; nothing in Redis can turn one back on.
- The audit chain never records an IP, a user agent, visitor text or a raw conversation id.
- `/privacy` changes in the same PR whenever what the site collects, who receives it or how long it is kept changes.
- No secret in the diff: no `.env`, no tokens and never `AUDIT_CHAIN_KEY` outside the Keychain and Vercel.

## Pass 3: compliance

Against the plan: compare the diff with the change's plan in `docs/plans/`, or with the PR description when there is none.
Flag work the plan did not ask for and plan items the diff does not deliver.

Against `DESIGN.md`:

- Colors come from `src/styles/tokens.css` only; no hex value, font family or radius in a page stylesheet.
- Buttons go through `Button.astro` and every badge, label, tag, chip or pill through `Badge.astro`.
- Headlines are Barlow Semi Condensed, body and UI Plus Jakarta Sans, labels JetBrains Mono in uppercase; Mr Dafoe appears only on the home headline's closing word.
- Source Serif 4 always carries `"opsz"` in `font-variation-settings`, matched to its size and never above 60.
- The site stays dark only.
- Copy keeps Verso in the third person and never suggests Jody writes its answers.

## Do not report

- Anything `npm test`, `npx astro check` or `npm run test:headers` already enforces: type errors, failing tests, CSP violations and unapproved inline hashes.
- `dist/`, `.vercel/output/` and the cached media under `public/media/`.
