---
title: "There is no audit command, because auditing stopped being a command"
slug: claude-code-codebase-audit-commands
pubDate: 2026-07-30
pillar: agentic-ax
tags: [tooling, claude-code, agentic-systems]
description: "Looking for a slash command that audits a whole codebase turns up nothing. The absence is the interesting part - that work moved to fan-out, not a verb."
publish: true
---

If you go looking for a Claude Code command that audits your source the way `/doctor` audits your installation, you will not find one. As of v2.1.220 there is no `/repo-doctor`, no `/scan`, no `/audit`, no `/optimize`, no `/health`, no `/cleanup`. I went through the full A-Z commands reference and the changelog to be sure.

The absence is more interesting than a missing feature would be. Three things do the job instead, and each one tells you something about how this category is settling.

## The three things that actually do it

`/security-review` is the closest analogue to `/doctor` in shape: no arguments, fire it, it scans. The docs describe it as analysing "pending changes on the current branch for security vulnerabilities. Reviews the git diff and identifies risks like injection, auth issues, and data exposure." The important difference is scope rather than mechanism - `/doctor` audits your setup, this audits your code, but only through a security lens. It is not a general performance or tech-debt pass.

`/code-review ultra` is the deep tier: "a deep, multi-agent code review in the cloud… Claude Code launches a fleet of reviewer agents in a remote sandbox," where every finding is independently reproduced and verified by a separate agent. Worth knowing the billing line in the commands table is stale - it still advertises "3 free runs on Pro and Max, then requires usage credits," but that promotion expired on 5 May 2026 and every plan now bills ultra runs as credits.

And then dynamic workflows, triggered by typing `ultracode` or asking for a workflow. This is the one actually built for repo-wide audits - the documentation's lead example is exactly that. It fans work across background subagents, up to 16 concurrent and 1,000 per run, and returns a single report, optionally with agents adversarially verifying each other's findings.

Also worth ruling out explicitly, because the name misleads: `/insights` produces a report, but about you, not your code. It analyses "your Claude Code sessions, including project areas, interaction patterns, and friction points" over 30 days. Useful, unrelated.

## Why the command never arrived

A slash command is a good container for work with a fixed shape. `/doctor` can be a command because the set of things that can be wrong with an installation is enumerable - the tool knows what to check before you run it.

An audit is not like that. "Find the performance problems" has no fixed shape, no bounded checklist, and the useful version of it depends entirely on the repo. What it needs is not a procedure but coverage: decompose the codebase, look at the parts in parallel, and then decide which findings survive scrutiny. That is a workflow, and it does not compress into a verb.

Which is why the most audit-shaped capability in the tool is the least command-shaped one. `ultracode: audit every API endpoint under src/routes/ for missing auth checks` is not a command with an argument. It is a description of a search, handed to something that will decide how to divide it.

The adversarial verification step is the part I would pay attention to. Both `/code-review ultra` and the workflow path independently converged on the same structure - find, then have a separate agent try to refute what was found. That exists because the failure mode of a fan-out audit is not missing things. It is producing a long list of plausible findings that waste a reviewer's afternoon. Generating candidate problems is cheap now; the expensive part has moved to deciding which ones are real, and the tooling has started to reflect that.

That is the same shift showing up in evaluation work, where the discipline has moved from producing scores to defending them, and in design, where generating options stopped being the constraint. Divergence got cheap. Judgement did not.

## A caveat on all of this

This is a snapshot of a fast-moving product, and the checks behind it were the v2.1.207-v2.1.220 changelogs with no Week 30 digest published yet, so something shipped in the last few days might not appear here. That window was mostly Opus 5 becoming the default model, screen-reader mode, `/fork` becoming a background-session copy with the old behaviour moving to `/subtask`, and auto-mode expanding to third-party providers - no codebase-analysis command among them.

If a named audit command does eventually ship, I would expect it to be a thin wrapper over the workflow path rather than a new capability. The work is already there. It just does not have a verb.
