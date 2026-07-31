---
title: "An agent config file is a budget, not a document"
slug: claude-md-design-md-patterns-ai-agents
pubDate: 2026-05-24
pillar: agentic-ax
tags: [tooling, methodology, design-systems]
description: "CLAUDE.md and DESIGN.md both fail the same way: people write them as documentation. They are instruction budgets, and every line you add makes the others weaker."
publish: true
---

The most counterintuitive thing about writing a CLAUDE.md is that adding a correct rule can make the file worse.

Not slower. Not more expensive. Worse at the job it exists to do. Distyl AI's paper on instruction density found that "even the best frontier models only achieve 68% accuracy at the max density of 500 instructions," and the finding that matters for anyone maintaining one of these files is that "as instruction count increases, instruction-following quality decreases uniformly." The new instruction does not just get followed less. It degrades the ones already there.

HumanLayer extrapolates a working ceiling of roughly 150-200 instructions before consistency falls apart, and notes that Claude Code's own system prompt already spends about 50 of them. So you are writing into a budget of maybe 100-150 slots, and you are competing with the harness.

That reframes the entire exercise. A CLAUDE.md is not documentation. It is an allocation.

## The file is advisory, and the harness says so out loud

The second thing worth internalising is that this file has no enforcement power at all. Anthropic's docs are explicit that CLAUDE.md arrives as a user message after the system prompt with no compliance guarantee. More pointedly, Claude Code wraps it in a `<system-reminder>` instructing the model to ignore the content unless it is highly relevant to the current task.

Read that again in the context of a 300-line file. You wrote 300 lines and the harness attached a note telling the model to skip most of it.

The community estimate, from DataCamp's Bex Tuychiev, puts CLAUDE.md rule-following at around 70% against 100% for hooks. Those numbers are observational rather than published, and the 100% is mechanical - hooks are shell scripts that exit with code 2 and block. But the direction is not in dispute, and it produces the only rule of thumb you really need: **if a violation would block CI, it belongs in CI, not in CLAUDE.md.**

The cleanest evidence for this is the one rule almost everybody writes and almost nobody gets. "Never push without asking" appears in a great many CLAUDE.md files, and there are multiple open Anthropic issues documenting Claude Code committing and pushing anyway, because the harness's own system prompt encourages it. You are asking an advisory document to overrule a system prompt. It loses. The rule works as a `PreToolUse` hook on `Bash(git push *)` and does not work as prose, and no amount of capitalising IMPORTANT will change that.

Which gives the three-tier model the community has settled into. CLAUDE.md for judgement calls and project map. `.claude/rules/` with `paths:` frontmatter for anything that only applies to a subset of files, loaded only when the agent touches them. Hooks for invariants. HumanLayer's version of this is the line worth remembering: "Never send an LLM to do a linter's job."

## What survives the budget

If you only have about a hundred slots, what earns one?

Anthropic's own files are the most instructive answer, because they are shorter and less prescriptive than almost anything the community publishes. The `claude-code-action` CLAUDE.md is roughly 50 lines and reads as a project map plus a lifecycle description: which file orchestrates what, that `base-action/` is published standalone so don't break its public API, that auth priority runs user-provided token over App OIDC. The cookbooks file is largely wrong-versus-correct API snippets showing where the beta header goes.

None of it moralises about writing good code. All of it encodes things the model cannot infer by skim-reading the repo. That is the entire selection criterion, and it rules out most of what people put in these files: file-by-file narration, style rules a formatter already enforces, restatements of language defaults, and `/init` output kept verbatim.

The pattern that most consistently earns its slot is the negative rule. Explicit "do not" blocks - do not add comments to code you did not write, do not refactor unrelated code, do not add error handling unless asked, do not introduce dependencies without approval. These work because the model's helpfulness bias expresses itself as addition, and naming the failure mode in advance is more effective than describing the desired state. The community calls it failure-mode inoculation, which is a slightly grand name for a very reliable trick.

The second is anti-fabrication, which is the most common thing mature files add beyond the well-known Karpathy restraint principles. The Superpowers framework states it without hedging: "PRs containing invented claims, fabricated problem descriptions, or hallucinated functionality will be closed immediately." Paired with explicit permission to say "I don't know" and a routing rule for where to check, three lines here buys more than a page of style guidance.

The third is any instruction that names a runnable command. "Run `pnpm test` before marking a PR ready" beats "make sure tests pass," because the agent can execute the first and confirm the result, and can only assert the second. Instructions that terminate in a verifiable action are structurally more reliable than instructions that describe intent.

## DESIGN.md has the same shape and a harder problem

The visual equivalent has converged fast. Google Labs published a `design.md` spec on 21 April 2026 under Apache 2.0 - alpha, YAML frontmatter for tokens plus eight ordered sections from Overview through Do's and Don'ts, with a CLI that lints broken token references, WCAG AA contrast and section order. The community corpus is VoltAgent's collection of 71 files modelled on Stripe, Vercel, Linear, Apple and others, which uses a nine-section dialect without frontmatter and adds one genuinely good idea the spec lacks: an Agent Prompt Guide, a block of short prompts the agent can quote verbatim rather than re-deriving rules from prose every turn.

The budget logic reappears immediately. DESIGN.md loads on every UI-generation turn, so the practical ceilings people report are 200-500 lines total, with readability collapsing around 800. Dumping an enterprise token taxonomy into it is the canonical anti-pattern - for something like Carbon, the file shrinks to a hundred-line brand overlay that points at the MCP server, and for shadcn projects it stays under about 120 lines because `components.json` already owns the component inventory.

But DESIGN.md has a failure mode CLAUDE.md does not, and it is the reason the file alone is never sufficient. Prose cannot stop an agent inventing component props. Storybook's MCP docs put it in the imperative: "Never hallucinate component properties! Before using ANY property on a component from a design system (including common-sounding ones like `shadow`, etc.), you MUST use the MCP tools to check if the property is actually documented for that component."

So the split is clean once you see it. DESIGN.md gives the agent visual vocabulary and the authority to make non-token decisions - what a hover should feel like, what the brand's restraint is. Storybook MCP, Figma Code Connect, the shadcn skill give it the runtime API surface. The first is necessary and the second is what makes it correct. DESIGN.md's real advantage is that it is the only artefact in that chain every agent can read with no integration at all, which is what makes a cold-start session generate on-brand output.

One inheritance to watch. Anthropic's `frontend-design` skill bans Inter, Roboto, Arial and system fonts, bans purple gradients on white, and tells the model to "Pick an extreme" aesthetic direction. That skill is excellent as a default and actively fights you once a brand has committed to something. If you have a real design system, your DESIGN.md needs to replace its pick-an-extreme guidance, not layer on top of it, or the anti-convergence pressure will pull generated UI away from the thing you decided.

## The maintenance habit that actually matters

Boris Cherny's tip - after every correction, tell the agent to update its own CLAUDE.md so it does not repeat the mistake - is widely adopted and it works. The half of it people skip is the pruning. He is equally explicit that you have to ruthlessly edit the file over time, and in a fixed budget that is not housekeeping, it is the load-bearing part.

The test I would apply: if the agent already does the right thing without the instruction, delete the instruction. Remove one rule, run five to ten typical tasks, watch whether behaviour shifts. If it does not, that line was spending budget to buy nothing. Auto-memory makes this sharper still - anything the agent has already learned about your project on its own is something you are now paying for twice.

There is a small irony in all of this worth sitting with. One of the most-quoted rule sets in the survey, from `vercel-labs/agent-browser`, includes a directive about never using double hyphens as a dash, and using an em dash sparingly instead. Someone wrote that rule because AI-generated text has stylistic fingerprints, and they spent one of their hundred-odd slots on punctuation. Whether that is a good trade depends entirely on whether the output is public. Which is the whole discipline in one line: the file is finite, and every sentence in it is competing with every other sentence.
