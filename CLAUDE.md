# CLAUDE.md

This is an **Astro 5 static site** deployed to Vercel. It's a personal site for Jody Brewster (jodybrewster.dev) with writing, digital garden notes, work briefs, and an AI chat interface.

## What this site is for
Everything here serves one goal: conveying what it is like to work with Jody, and who he is. It is not a portfolio that lists what he has done, and not a blog that happens to carry his name. A reader should come away with a sense of how he thinks, what he notices, and what having him on a team would actually be like.

That goal settles the decisions that would otherwise come down to taste. When a call is genuinely close, take the option that reveals more of the person:

- Specific over general. One real constraint from real work says more than a well-phrased principle.
- Working over finished. The research notes, the annotated drafts, the numbered briefs, the visible seedling and draft states: these exist because how the work happens is the point, not a byproduct of it.
- Voice over polish. A page that reads like a person wrote it beats one that reads like a template, even when the template is tidier.
- Nothing that could sit unchanged on someone else's site.

This is also why the anti-references in `PRODUCT.md` are what they are. The generic portfolio, the SaaS landing page and the AI startup aesthetic all fail the same test: each one would describe anybody.

## Behavioral Guidelines
- **Think before coding.** State assumptions explicitly. If multiple interpretations exist, present them — don't pick silently. If something is unclear, stop and ask rather than guessing.
- **Simplicity first.** Minimum code that solves the problem. No features beyond what was asked, no abstractions for single-use code, no speculative flexibility. If it could be 50 lines, don't write 200.
- **Surgical changes.** Touch only what the task requires. Don't improve adjacent code, refactor things that aren't broken, or match a different style than what's already there. If your changes create orphaned imports/variables, remove those — but leave pre-existing dead code alone unless asked.
- **Verify before reporting done.** For multi-step tasks, define success criteria upfront and confirm each step. Clarifying questions come before implementation, not after mistakes.
- **Parallelize with subagents.** When the work splits into independent pieces (separate files, distinct features, isolated checks), spawn multiple subagents in a single message rather than working sequentially. Use the `general-purpose` agent for parallel writes/builds, and the `Explore` agent for parallel investigation. Brief each subagent on the existing context it needs (which components/layouts/styles to read) so it doesn't re-explore the whole repo. Skip subagents for trivially small work where their setup overhead outweighs the parallelism gain.
- **Verify before inventing.** If uncertain about a file path, function signature, library version, or API, use Read/Grep/search first. Say "I don't know" rather than fabricating. Never invent imports, function names, or citation sources.
- **Before any UI change, read `DESIGN.md`.** Use only the tokens, fonts, spacing, and components defined there (`tokens.css`, `Button.astro`). Do not introduce hex values, font families, or radius values outside the system.

## Commands
```bash
npm run dev        # start dev server (http://localhost:4321)
npm run build      # production build (runs pagefind after)
npm run preview    # preview production build
npm run sync       # sync content from Obsidian vault → content/
npm run spotify    # refresh Spotify listening cache for /now → content/listening.json (also runs on prebuild)
npm run books      # resolve book catalog links + cache covers → content/library.json, public/media/
npm run music      # find each album named in content/music.json on Spotify, cache its art → public/media/albums/
npm run games      # cache box art named in content/games.json → public/media/games/
npm run films      # cache posters named in content/films.json → public/media/films/ (same Wikipedia sync as games)
npm run postcards  # paint a vintage postcard front for each place in content/places.json with no photo → public/media/places/ (OpenAI gpt-image-2, needs OPENAI_API_KEY; `-- Tokyo` redoes one)
npm run article-images  # generate the ink illustrations named in content/article-images.json → public/images/articles/ (OpenAI gpt-image-2, needs OPENAI_API_KEY)
npm run conversations  # download the last 7 days of Verso transcripts → .conversations/ (--days, --digest; --vault puts the digest only in the vault)
npm run conversation:delete  # find (--find) or delete (--cid, dry run without --yes) one conversation in production
npm test           # vitest run
```

## Verifying your work
Unit tests live under `src/lib/**/*.test.ts` (`vitest.config.ts` keeps vitest out of other branches' worktrees in `.worktrees/` and `.claude/worktrees/`) and cover the shelf, Verso transport/routes, conversation history, origins and corpus. Route tests belong in `src/lib/__tests__`, never under `src/pages` where Astro would publish them.
Type-check with `npx astro check`.

```text
$ npm test              # vitest, about 3 seconds; green ends with every test file passed
$ npx astro check       # 0 errors, 0 warnings, 0 hints
$ npm run build         # the site, then pagefind and the security headers
$ npm run test:headers  # after a build: the CSP in Chromium, WebKit and Firefox
```
Every production incident adds a case to the evaluation set in `docs/verso-evaluation.md`, in the PR that fixes it.

## How work flows here
Planning context: `~/Projects/hq/AGENTS.md`, then `~/Projects/hq/STATUS.md`; this block names only what this repo has.
Intents live in `intent/`; older plans stay in `docs/plans/`.
Verify with `npm test`, `npx astro check` and `npm run build` as above and review against `REVIEW.md`.
Decision log: none yet; decisions go in `docs/`.
Merging a PR into `main` deploys production (`docs/release.md`).
Jody merges; agents stop at the PR.

## Design system
- `src/styles/tokens.css` holds the palette once (`--ui-*`). The older `--home-*` and `--studio-*` names are aliases, kept because many rules use them.
- `src/components/Button.astro` is the only button, with `primary`, `secondary` and `text` variants. Its look is `src/styles/buttons.css`. Never hand-write a button class in a page.
- `src/components/Badge.astro` is the only badge, label, tag, chip or filter pill. Its look is `src/styles/badge.css`. Never hand-write a pill in a page.
- `DESIGN.md` is the written system and is current for the colors, type and buttons. Read it before any UI change.

## Common Pitfalls
- Add a color to `src/styles/tokens.css`, never to a page stylesheet.
- Source Serif 4 must always carry `font-variation-settings: "opsz" <value>`. Omitting `opsz` silently renders at opsz 14 regardless of size, which is visually wrong at display scale.
- The opsz axis stops at 60. Values above it are clamped by the browser, so writing `"opsz" 120` renders identically to `"opsz" 60` and just misleads the next reader. The ramp was originally built against Fraunces, which went to 144; every value was capped when the face changed.
- Don't add new npm packages without first checking if the dependency already exists in `package.json`.
- Don't commit `.env` or any secrets file. Don't push to `main` without confirming with the user.

## Things Claude gets wrong
- Testing `publish` for truthiness: `'draft'` is a truthy string; go through `isPublished()`.
- Shipping a local-only page as a plain `index.astro`; copy the empty `getStaticPaths` shape of `/drafts`.
- Taking conversation history or voice transcripts from the client; history comes from Redis only.
- Editing an inline script without running `npm run security:approve` after a build, or adding a host anywhere but `src/lib/security.ts`.
- Expecting a kill switch to change without a deploy, or reading one from Redis; switches come from env.
- Letting a limiter or an unreachable Redis fail open or surface as a bare 500; they fail closed with 503.
- Running `npm run sync` to get a build working: `content/` is committed and sync reads Jody's Obsidian vault.
- Copy that hints Jody writes Verso's answers, or a vendor named in the dock note instead of a category on `/privacy`.

## Where the rest lives
- `docs/architecture.md`: the content pipeline, collections, pages, search, env vars and analytics.
- `docs/verso.md`: Verso from the plain summary down to the route, cards, voice and the vendored bundle; `docs/verso-evaluation.md` is its test set and runbook.
- `docs/security.md`: security headers, kill switches, the audit log and rate limits.
- `docs/library.md`: the `/library` room.
- `docs/release.md`: how a merge reaches production, branch protection and rollback.
- `REVIEW.md`: the three review passes and what blocks a merge.
