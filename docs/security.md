# Security

How the site protects itself and its visitors: the security headers, the kill switches, the audit log and the rate limits.
These sections moved here from `CLAUDE.md` unchanged.
The review rules that follow from them are in [`REVIEW.md`](../REVIEW.md).

## Security headers

`postbuild` runs `scripts/security-headers.ts`, which inserts one route at the top of `.vercel/output/config.json` sending, for every path, a Content Security Policy plus HSTS, nosniff, Referrer-Policy, COOP, `X-Frame-Options` and a Permissions-Policy (microphone only), built from the preset in `@jodybrewster/gemini-live/server/headers` with the options in `src/lib/security.ts`.
Vercel applies neither `vercel.json` headers nor routes after the adapter's "filesystem" step to static files, which is why it goes in there (and why the script also copies `vercel.json`'s crons into `config.json`).
Scripts run only by origin or by the hash of an inline script found in the build; styles allow inline attributes; `img`, `font` and `connect` list exact hosts (GA4's are an accepted risk; `i.scdn.co` serves the shelf's album covers).
`assetsInlineLimit: 0` keeps Astro's scripts as files, since an inline module script would make the client router insert a `data:` script the policy refuses.
Voice loads its audio worklets from `/worklets/*.js` (built from the bundle), since a hashed policy refuses `blob:` ones.
A build with an inline event handler fails, and so does one with an inline script whose hash is not in `security/inline-scripts.json`: trusting whatever the build contains would also trust a script injected through content.
After adding or editing an inline script, check where each new hash comes from and run `npm run security:approve` (after a build).
JSON written into a `<script>` element goes through `scriptJson()` (`src/lib/script-json.ts`), which escapes `<` so a value (a Spotify album title, say) cannot close the element.
`npm run test:headers` (after `npm run build`) serves the build as Vercel would and checks every page, the client router, search and a mocked voice session for policy violations in Chromium, WebKit and Firefox.
After a deploy, `curl -I https://www.jodybrewster.dev/home` should show the policy.
Adding a third-party script, font, image host or API means adding it to `src/lib/security.ts`.

## Kill switches

`src/lib/switches.ts` reads `SWITCH_CHAT`, `SWITCH_VOICE`, `SWITCH_TOOL_SEARCH_SITE` and `SWITCH_TOOL_ASK_JODY` from the environment only (`off` or `force-off`; unset is on), so nothing in Redis can turn one back on.
Off, `/api/chat` answers 503 with paused copy the dock shows (`X-Switched-Off`), `/api/live-token` answers `voice_off`, `/api/corpus` refuses voice search, and MCP's `ask_jody` returns a paused result.
`npm run switch -- <chat|voice|search_site|ask_jody> <on|off|force-off>` sets the Production variable with the Vercel CLI and never deploys; the change applies at the next `npx vercel --prod`, and the first request after it records `switch.changed` in the audit log.
`flags.chat` (`src/lib/flags.ts`) still removes the dock entirely at build time.
`SWITCH_TOOL_SEARCH_SITE` covers voice search (`/api/corpus`) only, not MCP's `search_writing` or the text chat's retrieval.
A switch lives in a deployment's environment, so a rollback restores the switches of the deployment it returns to; and every API route refuses, in production, any host but `jodybrewster.dev` and `www.jodybrewster.dev` (`isCanonicalHost`), so old deployments' permanent URLs, which keep their old switches, serve no API.
Unrecognized switch values count as off.

`npm run rollback` ([`release.md`](release.md)) is that kind of rollback: production comes back with the switches the target deployment was built with.
A switch turned off after that build is on again.
After a rollback, set it again with `npm run switch`, then deploy and promote the new deployment.

## Audit log

`src/lib/audit.ts` keeps a tamper-evident chain on Upstash (`@jodybrewster/gemini-live/server/audit`), in Production only (`audit:production`).
It records answers, failures (model and status only), held questions, Jody's Telegram replies, minted voice tokens, `ask_jody` calls (with tokens used) and switch changes; never an IP, a user agent, visitor text or a conversation id (`ref()` is a keyed hash of an id instead).
Refusals are counted per day in Redis, not chained, and the daily cron writes one summary entry, so a flood cannot fill the log.
A write never blocks a request; failures and size warnings reach Jody on Telegram.
Jody's replies and switch changes send their anchor to Telegram at once; `/api/cron/audit-anchor` (Vercel cron, `CRON_SECRET`) sends the newest daily with the month's count, and drops months older than 13 after recording, anchored, where each ended.
Anchors protect the entries before them: the Redis token alone can trim entries after the newest anchor on Telegram, until the next one.
`security find-generic-password -s "jodybrewster.dev AUDIT_CHAIN_KEY" -w | npm run audit:verify -- --anchor seq:hash@date` checks the chain and the anchors with a read-only token, taking the key on stdin; `AUDIT_CHAIN_KEY` never goes in `.env`.
The key lives in Jody's macOS Keychain (service `jodybrewster.dev AUDIT_CHAIN_KEY`) and in Vercel Production as a sensitive value, so Vercel cannot show it back: losing the Keychain copy means starting a new chain.
Switches live in env, so the first request after a redeploy records a change (retried until written).

## Rate limits

Rate limits all live in `src/lib/limits.ts`, on the framework's limiter (`@jodybrewster/gemini-live/server/limits`): Upstash on Vercel (`RATE_LIMIT_STORE` defaults to `upstash` there; no Redis refuses with 503), memory in `astro dev`.
Every limiter fails closed.
Chat: 5 a minute per visitor and 75 answers a day site-wide (a quota checked at setup and spent just before the model call); voice search shares the chat's per-visitor counter; MCP: 20 tool calls a minute per visitor and 2,000 a day site-wide, and `ask_jody` 5 an hour per visitor, 50 calls a day and 250,000 tokens a day (each call reserves its worst case before calling Claude and settles from the reported usage); reply polling: 60 a minute per visitor.
The visitor is Vercel's trusted client IP, IPv6 by /64.
Windows are fixed, a UTC day on Upstash, so up to twice a daily cap can pass around midnight UTC.
Origin checks are in `src/lib/origin.ts`.
