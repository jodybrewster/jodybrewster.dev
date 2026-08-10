---
title: "The platform absorbs the framework, and methodology is what survives"
slug: pro-claude-code-agentic-stack
pubDate: 2026-05-24
pillar: agentic-ax
tags: [tooling, agentic-systems, methodology]
description: "Claude Code shipped natively almost everything Superpowers existed to provide. Watching its author delete his own code in response is the most useful thing in the category."
publish: true
---

The most instructive document in the agentic-framework category right now is not a comparison chart. It is the Superpowers 5.1.0 release notes, in which Jesse Vincent removes large parts of his own framework because the platform underneath it grew them.

He is explicit about why. On worktrees: a rework "now that Claude Code and Codex have first-class support for them." On the review agent: switching it "to be a regular subagent with a custom prompt, reducing our platform footprint, so that we no longer need any special subagent types." On the slash commands that had been there since the beginning: they "date from a time when Claude Code didn't have native support for skills," and now "Claude Code treats skills as slash commands and Claude is increasingly confused by the 'old' slash commands."

That is a maintainer deleting his differentiation on purpose, and it is a more honest signal about this whole category than any star count.

## What got absorbed

When Superpowers arrived in October 2025, its pitch was that Claude Code did not really have skills, hooks, native worktrees, or a structured way to hand a subagent an isolated context. Every one of those is now in the box.

Agent Skills landed 16 October 2025 and became a cross-vendor open standard by December, so the same `SKILL.md` drives Codex, Cursor, Gemini CLI and Copilot. The plugin system and official marketplace followed. Plan mode and read-only Plan and Explore subagents shipped in v2.0.28. Native `--worktree` arrived in v2.1.49 on 20 February 2026, with `WorktreeCreate` and `WorktreeRemove` hooks. Tasks, a DAG that persists across sessions and context windows, shipped in v2.1.16 in late April and covers most of what a hand-rolled plan format was doing. Agent Teams came with Opus 4.6 in February.

So the capability argument is over, and it did not end in a tie. If you install a framework in mid-2026 for skills, hooks, worktrees or subagent dispatch, you are installing a wrapper around things you already have.

## What did not get absorbed

Four things survive that subtraction, and none of them are features.

The first is the Iron Law style of skill authoring - each `SKILL.md` opening with a capitalised non-negotiable rule followed by a table of the rationalisations the model will reach for to skip it. The TDD skill names "just this once," "I'll write the test after," and "tests passing on first run" as failure modes before they happen. You can read that file in five minutes. You cannot write it in five minutes, and Anthropic's own guidance to make skill descriptions "a little bit pushy" is nowhere near as rigorous.

The second is how that text gets made. Vincent pressure-tests each skill by spawning subagents with adversarial framings - time pressure, sunk cost, authority claims - and strengthens the wording until a future model under pressure still complies. That is test-driven development applied to prompts, and there is no native equivalent.

The third is the rules-versus-gates distinction from his April post, which is the clearest thing anyone has written about why agent instructions fail. A rule is "don't cross the street without looking." A gate is "HARD GATE: Before you cross the street, look to the left. Verify that you see zero vehicles." A hook is the crossing guard who physically stops you. CLAUDE.md gives you rules. Hooks give you crossing guards. Almost nobody writes gates, and gates are the part an agent can actually self-evaluate against.

The fourth is subagent-driven development as doctrine rather than mechanism. Native subagents give you the primitive. The choreography is the contribution, and Vincent describes it precisely: the planning session spawns an implementer that receives only a little project context and exactly the text of task one, then a spec-review subagent checks the result against what was asked, and then "we fire up a brand new spec review agent that doesn't know it's ever been reviewed before and gets asked the same question."

That last clause is the whole idea. A reviewer who knows the work has already passed review is a different and worse reviewer. You can build this yourself with the native Task tool - but you have to know to build it, and nothing in the native documentation tells you to.

Of the same family, the single highest-leverage line to steal is the adversarial review prompt, verbatim: "Please ask two subagents to review this work. Tell them that whomever finds the largest number of serious issues gets five points."

## The cost is real and task-shaped

The practitioner split on Hacker News through 2026 reads like a controlled experiment on exactly this question, and it does not resolve cleanly because the answer depends on the size of the job.

The most-cited number comes from gtirloni: "Plan mode became enough and I prefer to steer Claude Code myself. These frameworks are great for fire-and-forget tasks… but they burn 10x more tokens, in my experience." Against that, the most rigorous comparison I found - Mejba Ahmed's 12 automated sessions - found Superpowers used 14% *fewer* tokens on complex tasks and more on simple ones. Both can be true. Token overhead on a framework that front-loads brainstorming and planning is a fixed cost, so it amortises on a four-hour feature and is catastrophic on a thirty-minute one.

Time behaves the same way. The reported brainstorm-and-plan overhead is 10-20 minutes per task. The consensus that emerged across practitioner writing is the obvious one once you see the shape: use the heavy process for three-or-more-file architectural work, use native plan mode for bug fixes and single-file changes. healsdata's comparison is the honest version of the tradeoff - plan mode produced a working implementation in twenty minutes, the framework ran for hours, and the framework's code was "written with the rest of the project and possibilities in mind, while the Claude Plan was just enough for the MVP." Neither of those is wrong. They are answers to different questions.

## The conclusion I would draw

Take the methodology, not the framework. Lift the brainstorming Iron Law, the subagent-dispatch choreography, the gates framing and the adversarial review prompt into your own `~/.claude/skills/`, and skip the installed layer unless you want the ongoing refinement without maintaining it yourself. That last point is not nothing - if you fork and copy, you become the maintainer, and Vincent shipped eight releases in three months.

The broader pattern is the part worth keeping. On a platform moving this fast, anything that exists to supply a missing capability has a short half-life, because the platform is going to ship that capability and ship it better-integrated. What does not get absorbed is opinion: which practices to enforce, how to word them so the model complies under pressure, what order to do things in. A framework that is mostly capability gets eaten. A framework that is mostly taste survives as a reference even after its code is deleted.

Which points at what to actually build, if you are going to build something. Not a framework. A thin curation layer over primitives that already exist - your chosen skills, your gates, your hooks - packaged so it installs in one command and does not fight the platform's direction. The distribution surfaces converged on plugins, `SKILL.md` and `AGENTS.md`, and anything not aligned to all three is swimming against the current.

Two caveats worth carrying. Star counts in this category are unreliable enough to ignore - the figures circulating on third-party trackers ran 30-40% below what GitHub reported directly for the same repos on the same day. And if you ran a side-by-side comparison in spring 2026, re-run it. Anthropic later published a postmortem covering six weeks of quality complaints traced to three overlapping changes: a reasoning-effort downgrade in early March reverted 7 April, a cache-pruning bug that progressively erased the model's own reasoning until 10 April, and a verbosity-limit change that internal ablations showed cost about 3% quality. All resolved by 20 April. Any benchmark from that window was measuring against a degraded baseline, and the framework would have looked better than it was.
