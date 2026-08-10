---
title: "The documentation skill ecosystem is crowded, and the quality gate is empty"
slug: technical-writing-doc-skills-claude-codex
pubDate: 2026-07-26
pillar: agentic-ax
tags: [tooling, agentic-systems, methodology]
description: "Dozens of repos will teach an agent to write docs. Almost none will stop it shipping bad ones. That asymmetry tells you where the real work is."
publish: true
---

Go looking for a way to make a coding agent write good documentation and you will find an embarrassment of options. Diátaxis skills, documentation subagents, style-guide knowledge bases, slash commands for auditing and converting docs. Go looking for something that checks the documentation after the agent writes it and the shelf is nearly bare.

That asymmetry is the finding. The ecosystem has thoroughly solved the part that is easy to package - a prompt that describes good writing - and barely touched the part that actually changes outcomes.

## Four layers, and only one of them is scarce

It helps to separate what these repos ship, because the marketing language flattens it.

There are **skills**, which is writing intelligence as a prompt. There are **subagents**, specialised doc writers with their own tool scoping. There are **commands**, the slash-command surface. And there are **hooks**, which is the only layer that can prevent something rather than produce it.

The first three are abundant. The fourth is where the ecosystem stops.

Anthropic's own `anthropics/skills` repo, at a confirmed 164k stars, ships `doc-coauthoring`, which walks the agent through "three stages: Context Gathering, Refinement & Structure, and Reader Testing," ending with a fresh instance re-reading the output to catch blind spots. That final reader test is a genuinely good idea. It is also a pure prompt workflow - no hooks, no linting, no mechanical enforcement of anything.

`wshobson/agents` has the deepest documentation subagent set, `docs-architect` for long-form manuals and `api-documenter` for OpenAPI specs, transpiled per harness so one Markdown source produces Codex `.toml` artefacts that respect Codex's 8KB skill cap. Well maintained, very few open issues. No hooks.

`obra/superpowers` has the best cross-tool story of anything here - one `skills/` directory driving Claude Code, Codex, Cursor, Copilot CLI, Gemini CLI and more through thin per-host manifests. It has no documentation skill at all. What it offers is the portability harness, which is a different and arguably more valuable thing.

The closest single repo to the full stack is `anivar/developer-docs-framework`, which ships both `SKILL.md` and `AGENTS.md` from one source, 27 rules across 7 categories, and six pluggable style guides including Google, Microsoft, Stripe and Diátaxis. It is substantive content, not a wrapper. It also has about four stars and a single commit. That is high-quality writing with no adoption signal whatsoever, which makes it something to vendor and own rather than depend on.

## Why the gate is missing, and it isn't laziness

The `PostToolUse` hook that lints a Markdown file the moment an agent writes it - `markdownlint-cli2 --fix`, then Vale against the Google style package, then `lychee` for links, returning exit code 2 so the agent reads the errors and corrects itself - is a well-documented pattern. It just lives in blog posts rather than in anything installable. No named plugin ships a default Vale hook.

Part of the reason is a real technical asymmetry between the two major hosts, and it is worth understanding before you plan around it.

Claude Code's `PreToolUse` and `PostToolUse` fire on `Write`, `Edit` and `MultiEdit`. Codex CLI's hooks reached stable in v0.124.0 on 23 April 2026, but they effectively only fire for the Bash tool. This is not a documentation ambiguity - it was tested directly. Issue #16732 reports a hook log that "captured 4 entries (2 PreToolUse + 2 PostToolUse), all with tool_name: 'Bash'… The apply_patch call that actually modified the file produced zero hook events."

So Codex cannot reliably lint the Markdown file it just wrote. Which means anyone building a portable doc gate cannot use the obvious mechanism on both hosts, and has to fall back to a Stop-hook sweep over changed files, or a pre-commit hook, or CI. That is more work than publishing a prompt, it is host-specific, and it does not demo well. Hence the gap.

## Adopt the top three layers, own the bottom one

The recommendation that falls out of this is unbalanced on purpose. Take the ecosystem's skills, subagents and commands, because they are genuinely good and there is no advantage in rewriting them. Build the hooks yourself, because nothing you can install does the job and the portability constraint forces a custom answer anyway.

Concretely: `obra/superpowers` as the cross-host harness since it already lays down AGENTS.md and CLAUDE.md and the per-host manifests. `anivar/developer-docs-framework` vendored in, with its AGENTS.md committed at repo root so Codex reads the same rules Claude does. A Diátaxis skill with real commands - `jrjsmrtn/diataxis-skills` ships `/diataxis-audit`, `/diataxis-create`, `/diataxis-convert` and `/diataxis-plan`. Doc-writer subagents pulled from `wshobson/agents` or VoltAgent's equivalents.

Then the part you write: a Claude Code `PostToolUse` hook on `Write|Edit|MultiEdit` running the three linters and exiting 2 on failure, and for Codex the same linters as a Stop-hook sweep plus a pre-commit hook. The pre-commit gate is the durable one, because it makes the standard identical no matter which agent produced the file. GitLab's docs pipeline - markdownlint-cli2, Vale, lychee - is the reference implementation for the linter stack itself.

The general shape of that advice is not specific to documentation. When an ecosystem has produced fifty ways to make a model generate something and almost no way to check what it generated, the checking is where the leverage is. That has been true of evaluation for a while and it is becoming true here.

## How to tell substance from volume

Star counts are close to useless in this corner. `obra/superpowers` is reported anywhere between 40.9k and 260k depending on which tracker you read. Meanwhile the best content in the survey has four stars.

The tells that actually work: open issues relative to stars, whether the repo ships tests or validation, whether one person made one commit, and whether the SKILL.md says anything a competent writer would not already know. A great many marketplace entries are roughly forty lines of "write clear docs, use second person, one concept per paragraph." The aggregator catalogues advertising 900-plus skills are SEO surfaces rather than curated collections.

The best single signal I found is a skill arguing against its own framework. `sammcj/agentic-coding`'s Diátaxis skill states outright: "Diataxis is an approach, not a template. Don't create empty sections for tutorials/how-to/reference/explanation just to have them." Someone who writes that has used the thing on a real codebase and watched an agent produce four empty headings. That sentence is worth more than the star count.

Two caveats worth carrying. Codex hook coverage is moving fast and OpenAI's docs now claim broader apply_patch and MCP coverage in newer builds, so verify against your installed version rather than trusting this snapshot. And Claude Code has its own history here - issue #6403 had `PostToolUse` hooks silently not firing - so confirm with a trivial logging hook before you rely on auto-lint to catch anything.
