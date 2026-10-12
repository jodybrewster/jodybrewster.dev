---
title: "A Claude Code mod is code that runs with your permissions"
slug: claude-code-mods-top-20
pubDate: 2026-10-12
pillar: agentic-ax
tags: [tooling, claude-code, agentic-systems]
description: "Claude Code mods launched October 1. None are sandboxed and nobody publishes installs, so here are the top 20 by stars and how I would vet them."
publish: true
---

The sentence in Anthropic's mods documentation I would put at the top of every directory listing is the plain one: a mod "is code that runs with your permissions."
It is not sandboxed.
It can read and write your files, start processes, make network requests, read your environment variables and API keys, see every prompt and tool call, approve a tool call before you are asked and spend your usage.
Eleven days after launch there are already more than 3,200 of them.

Anthropic launched mods for Claude Code on October 1, 2026, and the name is official.
They are small JavaScript or TypeScript functions that run inside Claude Code, shipped inside plugins, in the CLI and in the Code tab of the desktop app.
They are on by default from v2.1.287 (desktop from v2.1.286), and you install them like any plugin, with `/plugin` or from the Claude directory.

## What a mod is

Anthropic's definition is "a plugin that changes how Claude Code looks and behaves."
A mod is a set of event handlers.
When something happens (a tool call, a submitted prompt, part of the interface being drawn), Claude Code calls the handler, and the handler can watch the event, change it or take it over.
Per the launch post, that covers rewriting a prompt before it reaches the model, blocking, rewriting or retrying a tool call, approving or denying a permission request and redacting secrets from tool output.
It also covers the interface: buttons, panes, inputs, or replacing part of the screen outright.
When several mods hook the same event they run in load order, so mods from different authors stack like middleware.

What makes this different from what came before is where the code runs.
Settings hooks run a shell command, an HTTP request or a prompt on lifecycle events, and they can gate an event but never draw anything.
Agent Skills are instructions Claude reads.
MCP servers are external processes that hand Claude tools.
A mod runs inside Claude Code's own process, holds state and can answer an event instead of just allowing or refusing it.

It is a plugin component, not a rival format.
One plugin can carry a mod, a skill and an MCP server together, and settings hooks keep working.

Two details tell you where Anthropic is taking this.
Claude can write mods for you: a built-in `plugin-authoring` skill writes one into `~/.claude/dev-mods/<session-id>/` and hot-reloads it into the running session, where it lives until the session ends unless you copy it out.
And Anthropic already ships its own features as mods.
`/diff`, AGENTS.md support (`cc-plugin-agents-md`), telemetry and the `sec-default` guard are built-in mods, with their source public in the `mods` folder of the anthropics/claude-code repo.
Anthropic says it plans to move more built-ins over so users can "pare Claude Code down to a small core."
That is the more interesting announcement.
The tool is turning into a host, and what Claude Code feels like will increasingly be whatever you, or your admin, chose to load.

## How it got here

Anthropic floated the design on GitHub on September 3 (issue #91870) as "function hooks," and six days later said it would ship as "Claude Mods."
Early access ran through September behind `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`; that flag is now ignored, so older READMEs that tell you to set it can be ignored too.
The launch was October 1, and clauding.de reports the code "arrived in version 2.1.287, the same day, at 16:59 UTC."
A few secondary sources say October 3, which is wrong.
On October 2 Anthropic shipped "You Should Know," the first official mod plugin, off by default: `/plugin enable cc-plugin-you-should-know@builtin`.

Where mods run is less obvious than it sounds.
In a terminal (including editor terminals and JetBrains) and in the desktop app's Code tab, hooks run and mod UI appears, apart from terminal-only elements in the app.
In the VS Code extension's chat panel, `claude -p` and the Agent SDK, hooks run but nothing draws.
Remote Control runs hooks on your machine and draws in your local terminal, and cloud sessions run hooks if the plugin reaches the session.
Desktop WSL sessions get neither, because plugins are unavailable there.
None of this touches the regular claude.ai chat.

## The top 20, with the obvious problem

There is no install leaderboard for mods.
Organization admins can see installs (per the HighCircl Editorial Team on October 6, "on the Enterprise plan, GET /v1/organizations/analytics/plugins returns per-plugin, per-day install and invocation counts," and OpenTelemetry records `claude_code.plugin_installed` and `plugin_loaded`), but nobody publishes them.
So the only public signal is GitHub stars, and stars belong to repositories, not mods.

The ranking below uses claude-mods.com, which hand-checks that each entry is a working mod and refreshes stars daily; this is its October 9 snapshot.
Where one repository hosts several listed mods I merged them into one row rather than counting the same stars three times.
"Host repo" means the stars come from a larger project and overstate interest in the mod itself.

| # | Mod | Author | What it does | Stars |
|---|---|---|---|---|
| 1 | [firstmate-calm](https://claude-mods.com/firstmate-calm/) | Firstmate (kunchenguid) | Hides tool rows and swaps the spinner for a sailboat; toggle with /calm | 7.8k, host repo |
| 2 | [fast-jev-compaction](https://claude-mods.com/fast-jev-compaction/) | tamaratran | Compaction that drops stale tool calls instead of summarizing | 7.6k, host repo |
| 3 | [terminal-browser](https://github.com/zenbu-labs/terminal-browser) | zenbu-labs | A real Chromium browser in a pane beside the transcript, which the agent can drive | 3.8k (3,631 on Oct 2) |
| 4 | [storybloq](https://claude-mods.com/storybloq/) | Amir Shayegh | A board of tickets and issues kept in `.story/`, in a side pane; works with Codex too | 771 |
| 5 | [RemCTL](https://claude-mods.com/remctl/) | Federico Viticci | Today's Apple Reminders above the prompt, plus tools for Claude to manage them | 602 |
| 6 | [Habblaud](https://claude-mods.com/habblaud/) | Márcio Junior | A pixel-art office showing what each agent is doing, live | 335 |
| 7 | [pii-guard](https://claude-mods.com/pii-guard/) | danyuchn | Reversible Taiwanese PII redaction for prompts, tool results and writes | 249 |
| 8 | [shunt](https://claude-mods.com/shunt/) | Minsu Lee | Shared account-pool headroom and reset times from the shunt gateway | 209 |
| 9 | [blast-radius, replay-theater, token-weather](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods) | Anthropic | Holds a risky `rm -rf` or force-push with Proceed/Cancel; `/replay` of the last turn's edits; a context "weather forecast" | 197, shared repo |
| 10 | [image-view](https://claude-mods.com/claude-image-view/) | Jarrod Watts | Thumbnails of pasted images above the prompt instead of `[Image #1]` tags | 196 |
| 11 | [multi-core](https://claude-mods.com/multi-core/) | greenpolo | ChatGPT/Codex, Cursor, Zen, Antigravity and Grok models in one session via /model | 189 |
| 12 | [context-bar, mission-control, where-am-i](https://claude-mods.com/mission-control/) | Hamza Zafar | A stacked context bar; an agent and tool-call pane; a goal and next-step band | 184, shared repo |
| 13 | [savvy-progress](https://claude-mods.com/savvy-progress/) | johnnyvizz | Running, finished and planned subagents with model, context, cost and time | 135 |
| 14 | [filetree](https://claude-mods.com/claude-code-filetree/) | Kurt Buhler | A sidebar file tree with git status that lights up what Claude reads and edits | 131 |
| 15 | [cache-tax](https://claude-mods.com/cache-tax/) | Karan Bansal | Blocks a cold prompt-cache send once with its price, then keeps the cache warm | 127 |
| 16 | [lane-stack](https://claude-mods.com/lane-stack/) | VKirill | Claude Code as PM for Codex, Qwen and Grok lanes, with effort routing | 122 |
| 17 | [intermission](https://github.com/jarrodwatts/intermission) | Jarrod Watts | A multiplayer Doom deathmatch in a pane while Claude works; hands you back when it needs you | 110 (147 on claudemods.dev) |
| 18 | [Mindful-Claude](https://github.com/halluton/Mindful-Claude) | halluton | A guided breathing band above the prompt while a turn runs; zero tokens | 100 |
| 19 | [claude-skins](https://claude-mods.com/claude-skins/) | hellosverre | Seven transcript skins: timed tool rows, table cards, themed spinner words | 93 |
| 20 | [ctx-handoff](https://claude-mods.com/ctx-handoff/) | cablate | Writes a handoff, runs /clear and resumes at a context threshold | 75 (tied with hermitd and transcripted-live) |

Three groups are left out on purpose.
Mods inside huge multi-purpose repos top the automated scanners: ruview-live (ruvnet/RuView, 97,217 stars), the ruflo-* mods (ruvnet/ruflo, 74,314) and the 38 mods in davila7/claude-code-templates (32,358).
Those numbers measure the host project.
Built-in mods (diff, agents-md, sec-default, telemetry, You Should Know) ship to everyone, so stars do not apply; for scale, Anthropic's "You Should Know" post drew 1.6M views on X and the @ClaudeDevs launch post 4.4M.
And votes tell a different story from stars: claudemods.ai's all-time leaders are cc-arcade (nine games above the prompt, by Seza Akgün), agent-flow, claude-games, cctop and context-lens, while cc-arcade has only 44 stars on claude-mods.com.
By buzz, the leader is Jarrod Watts' intermission, whose launch post reached 460.5K views and 7,023 likes.

Read the list for what people want rather than who won.
Strip out the two inflated rows and the rest sorts into three wishes.
People want to see what the agent is doing and what it costs: context bars, subagent progress, file trees that light up, cache warnings, a context forecast.
They want the screen quieter: hidden tool rows, skins, image thumbnails instead of placeholder tags.
And they want something to do while they wait, which is how a Doom deathmatch, a breathing exercise and nine arcade games end up in a coding tool.
Almost none of the top 20 change what Claude does.
They change what it is like to sit next to it.
That is an experience design brief written by the users themselves, eleven days in.

## The trust problem

The documentation is honest about the risk, and the details are worse than the summary.
Claude Code's sandbox only isolates the Bash commands Claude runs; processes a mod starts run outside it.
Deny rules do not cover a mod's own file and process calls, so a mod can read `.env` even if you deny `Read(.env)`.
Anthropic's mods admin page lists further limits even in guarded setups: under sec-default "deny rules win too, unless someone sets allowModsToOverrideDenyRules to true"; in auto mode "a call the mod approves runs without a classifier check"; and the network policy "covers $.http.fetch, not a program the mod starts with $.process.run."
The page's own conclusion is that "none of these controls sandboxes a mod."
The one thing a mod cannot do is restyle the permission prompt.

How much of that reach is actually used?
The October 2 nightly scan of 359 mods found 127 start processes, 95 write files, 75 reach the network and 111 see every prompt.

During early access, Ehud Melzer of Pluto Security published ["Inside Claude Code Function Hooks: The Trust Problem Behind Claude Mods"](https://pluto.security/blog/claude-code-function-hooks-security/) on September 22, describing four trust gaps.
His test mod read `~/.claude/.credentials.json` and "an 834 KB history.jsonl containing every prompt we had ever typed" and posted both to an outside server.
"No prompt appeared. No permission was asked."
He also found that `claude plugin details` reported a mod that hooks everything as having "zero hooks."
Anthropic has since narrowed the interface-spoofing risk; the risk from fetched code is unchanged.

On Team and Enterprise plans, and on any machine with managed settings, the built-in `sec-default` mod loads first and stops user mods from overriding deny rules or managed hooks.
Admins also get `allowManagedModsOnly` (only org-deployed mods and built-ins load), `prependPlugins` and `appendPlugins` (load order) and `disableSideloadFlags` (blocks `--plugin-dir`).
There is no separate price or plan gate; a mod that calls a model spends your normal usage, and drawing UI costs no tokens.

## What I would do

Install like this: `/plugin marketplace add <owner>/<repo>`, then `/plugin install <name>@<marketplace>` in a session or `claude plugin install …` from the shell.
In the desktop app it is + → Plugins → Add plugin, and `/reload-plugins` picks it up in an open session.

Before any of that, run `claude plugin validate ./some-mod`.
It lists the events a mod hooks and the API calls it makes (`$.fs`, `$.process`, `$.http.fetch`, `$.env.get` and so on) without running it.
Treat a third-party mod like a binary you are about to run.
Read its `hooks:` and `calls:`, be suspicious of any mod whose reach does not fit its job (a status line that calls `$.http.fetch`), and pin the version you reviewed.

Start with mods that only watch and draw: token-weather, context-lens or token-ledger for context and cost, or Mindful-Claude for fun.
Move to mods that rewrite tool calls, such as redactors and budget guards, once you have read their validate output.

If you run a team, set policy before your developers find mods on their own: turn on `allowManagedModsOnly` and `disableSideloadFlags`, then allow specific reviewed mods through managed settings.

For discovery, claude-mods.com is the hand-checked directory.
mods.aidojo.si (karanb192/awesome-claude-code-mods) is the only one that shows what each mod's code can touch.
claudemods.ai has 45 mods with daily voting, claudemods.dev lists 1,431 builds mixed in with ordinary plugins and skills, and GitHub has the `claude-mods` and `claude-code-mods` topics.
Anthropic's own channel is the Claude directory and the `/plugin` marketplaces, where mods appear as plugins without being separated out.

To turn things off: disable one mod in `/plugin`, run a single session with none via `claude --safe-mode`, or set `"disableAllHooks": true` to disable installed mods everywhere.
Built-in mods have their own switches.

## How old this is

This is a day-11 snapshot of an ecosystem growing by hundreds of mods a day.
The aidojo scanner counted 31 on September 15, 1,914 in 787 repos on October 4 and more than 3,200 on October 11.
Stars are from October 9, and positions 10 to 20 are a few dozen stars apart, so they could reorder within days.
Stars are not installs, and I could not open the Claude directory directly to rule out install counts there, though no source reports any.
The X figures come from indexed snapshots and have likely grown; only intermission's 7,023 likes has a named secondary source (rundatarun.io).
I did not install or security-review any of these mods.
A listing in a community directory, even a "verified" one, is not an audit.
