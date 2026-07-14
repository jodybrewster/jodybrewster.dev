---
title: "Divergence is nearly free now — the bottleneck is judgment"
slug: diverge-converge-workflows
pubDate: 2026-05-23
pillar: shape-of-work
tags: [ai-delivery, methodology, tooling, agentic-systems]
description: "How the design community is operationalizing diverge-then-converge workflows with LLMs in 2026, and why convergence is now the only interesting problem."
publish: true
---

Karri Saarinen said it plainly in April 2026: "You can already see the result in products that look polished, ambitious, and impressive at first glance, but begin to unravel the moment you actually use them. The form is there. The fit is not." That sentence is the summary of every honest review of AI design tooling published in the past twelve months. Generating options is nearly free. Evaluating them — with taste, fit, and discipline — is not, and it is the only place an editorial site will distinguish itself from generic AI output.

The diverge/converge structure has survived the AI transition. The Double Diamond hasn't been replaced; it's been compressed. What the "Triple Diamond," "Stingray Model," and "Adaptive Loop" reframings are all observing — correctly — is that the cost of the diverge phase has collapsed to near-zero. The implication is that you should spend more time on the brief and the critique, less on the visuals you generate in between. Five workflow patterns dominate the credible practitioner literature. Here is what each one actually does and where it earns its keep.

## The five patterns

**1. Reference-Augmented Divergence**

Before the model proposes a layout, it searches a curated library of real shipped UI and pulls examples inline into the prompt as visual evidence. The two tools that operationalize this are Lazyweb MCP (Ali Abouelatta, former PM at Duolingo, launched May 2, 2026; 257k+ screens; free) and Mobbin MCP (launched May 13, 2026; 621,500+ screens and 142,200+ flows; requires a paid Mobbin account).

Lazyweb's standout command is `/lazyweb-design-brainstorm`, described in the GitHub README as "cross-pollination brainstorm. Deliberately searches OUTSIDE your category to find novel patterns. If everyone in fintech copies each other, this skill looks at gaming, entertainment, and social apps for transferable ideas." For an editorial site, that means telling it to look at literary magazines, museum catalogues, and zines rather than the blog or personal-site corpus — which will surface the same ten Substack-adjacent layouts the model already knows.

Mobbin CEO Jiho Lim's framing at launch: "In the AI era, the challenge isn't generating interfaces — it's knowing what good looks like and how it works. Mobbin MCP gives AI agents access to real design decisions, patterns, and flows, not generated guesses." That's the right framing, though the practical difference between Mobbin and Lazyweb for a personal editorial site mostly comes down to curation quality versus cost. Lazyweb is free; Mobbin is better-curated and behind a subscription.

One caveat worth keeping: both tools index shipped product UI, which biases you toward conventional SaaS patterns even when you ask for variety. The brainstorm command partially mitigates this, but you should manually inject editorial and print references to counterbalance.

**2. Brief-first, three-variants, kill two**

Never prompt for a design directly. First run a structured brief interview — purpose, audience, tone, constraint, differentiator. Then generate three deliberately divergent variants on different conceptual axes. Then pick one and refine.

Paul Bakaus's impeccable is the cleanest implementation of this in the Claude Code ecosystem. The chain Bakaus recommends: `/impeccable shape` (structured discovery interview producing a design brief, written to PRODUCT.md and DESIGN.md) → `/impeccable craft` (generates variants by default) → `/impeccable critique` (scored against Nielsen's 10 heuristics with persona archetypes and cognitive-load assessment) → `/impeccable polish`. The critique pass writes persistent snapshots to `.impeccable/critique/<timestamp>__<slug>.md` so each polish run reads the prior verdict instead of re-deriving the backlog from scratch.

Engr Mejba Ahmed's hands-on test reported that the variants come back as genuinely distinct directions — "editorial," "drenched," "brutalist" — not three versions of the same purple-gradient. The Tessl benchmark reports a 1.59× aggregate score improvement over baseline; treat that as directional (it measures what impeccable optimizes for), but the qualitative shift across multiple independent reviewers is real.

Anthropic's own Claude Design (research preview, launched April 17, 2026, runs on Opus 4.7) takes a similar approach — three to five wireframe variants from a brief, with inline style editing and design-token binding. The Cal.com case study reported compressing concept exploration from "I have time for one direction" to "I have time for five." The cost: roughly 58% of a Pro weekly quota in two sessions on Opus 4.7. Powerful for high-stakes decisions; expensive for iteration.

**3. Critique-as-subagent**

After every generation, hand the output to a different agent persona with read-only tools and a rubric. Don't ask the builder to grade its own work.

This is now the most-cited "thing that actually improved my output" in design-engineering writeups. The pattern from Anthropic's own docs — read-only tools (Read, Grep, Glob, Bash; no Edit, no Write), running in an isolated context window — can be repurposed for design critique by swapping the system prompt to a senior UI/UX reviewer persona with NN Group and Refactoring UI as its frame of reference.

Brian Lovin's Notion team prototype playground, covered in Lenny's Newsletter, uses voice dictation into Claude Code's plan mode with a critique-then-refine cadence. His take on why working in code beats working in Figma for AI-native features: "I don't think you can design a good chat experience in Figma. You can design what the chat input looks like… but what you can't design in Figma is what it actually will feel like to use that thing." Correct, and it generalizes: for anything with dynamic behavior or real content, code is the design surface.

One hard constraint: subagents are independent. Critique doesn't reach the builder unless you explicitly pipe it. Always pair LLM critique with deterministic rules — impeccable's 27 anti-pattern rules, `npx impeccable detect`, axe-core for accessibility — so you have at least one source of ground truth that the model can't rationalize around.

**4. Parallel-agent exploration**

Spawn two to five isolated Claude sessions, each in its own git worktree, each told to take a different direction. Review, kill all but one, merge.

Claude Code's `-w` flag makes this first-class: `claude -w editorial-serif "build homepage in editorial-serif direction"` spawns a session in `.claude/worktrees/editorial-serif/` on its own branch. Conductor (Mac app, YC S24) and Claude Squad (open-source, tmux-based) layer orchestration and merging on top.

The honest cost assessment from a developer who actually uses worktrees daily: "Setting up worktrees takes time. Often, it's not worth it for a change Claude finishes in 10min. Juggling multiple Claude sessions is like moderating two separate meetings in neighbouring conference rooms — you're endlessly ping-ponging." Token cost scales roughly 3–4× over sequential. For solo editorial work, impeccable's built-in three-variant flow inside a single session is almost always a better fit than orchestrating worktrees — unless you are genuinely committed to exploring conceptually different directions, not just variations on the same layout.

**5. Vault-grounded iteration**

Make your personal inspiration substrate — Obsidian vault, Are.na channels, screenshots, saved references — directly addressable by the agent. Structure it for AI orientation, not just human navigation.

Sion Williams's `/today` skill pattern (May 6, 2026) is the cleanest published example: a single command that resolves today's daily note, pulls in calendar context, composes meeting notes via Templater. Williams: "The intelligence lives in the skills it loads: a skill for the people graph. A skill for daily notes. A skill for Obsidian's flavour of Markdown. A skill for PARA." For a designer-engineer running Claude daily, the equivalent is a `/notebook today` command that opens the design diary, lists open critique snapshots above P1, pulls in any new Are.na blocks added since yesterday, and asks what's the one thing to ship today.

Are.na has no official MCP server as of late May 2026. The workaround is exporting channels to JSON/Markdown via Are.na's API and dropping them into the vault as `references/are-na/<channel>.md` files the agent can read.

One real constraint: context size. A 200-note vault can blow past Claude's effective working memory. The right architecture is tiered — an index file capped at around 200 lines, topic-specific files loaded on demand, full transcripts on disk. Don't dump the whole vault into every prompt.

## What the community has converged on

The vocabulary problem — not the capability problem — is the correct diagnosis for why AI-generated UI looks generic. Bakaus's framing: "You can't request 'more vertical rhythm' without knowing the phrase exists." Anthropic's own Claude Cookbook warning: "Avoid generic AI-generated aesthetics: overused font families (Inter, Roboto, Arial, system fonts), clichéd color schemes (particularly purple gradients on white backgrounds), predictable layouts and component patterns… You still tend to converge on common choices (Space Grotesk, for example) across generations. Avoid this."

The negation move is the highest-leverage prompt-engineering insight documented in 2026 for design. From Bakaus's benchmark commentary: "'No Inter' forces a font choice. 'No pure black' forces tinted neutrals. 'No bounce easing' forces intentional motion. The model stops reaching for the median." Lazyweb's `/lazyweb-design-research` produces an "Anti-Patterns" section. Most designers skim it. Paste it verbatim into your `DESIGN.md` as a NEVER list.

## What's hype

The "Triple Diamond" / "Stingray" / "Adaptive Loop" reframings are mostly Medium essays and consultancy white papers, not lived practice. The Double Diamond still describes what designers do; what's changed is the cost of each phase, not the structure.

"Vibe design" as a discrete practice. Jonas Kellermeyer (Taikonauten, March 2026): "AI enables the creation of convincing surfaces — both visually and textually. An automatically generated high-fidelity prototype can appear more mature than the underlying concept actually is. This is where a false sense of confidence emerges: apparent visual quality can overshadow strategic weaknesses." His prescription: "It is helpful to view AI tools not as 'result generators,' but as variant engines operating under clearly defined testing criteria." Speed is not a substitute for substance.

Mobbin MCP for a personal editorial site. The tool is well-built; the subscription cost is hard to justify when Lazyweb is free and the marginal curation quality doesn't move the needle for a text-first site.

## The recommended stack, in priority order

1. A real brief — impeccable's `/shape` or a hand-written `DESIGN.md`. Non-negotiable; everything downstream depends on it.
2. Reference-grounded divergence — Lazyweb free, Mobbin if the curation quality matters enough to pay for it.
3. A critique pass that persists — impeccable's `/critique` with committed snapshots. This is what stops the project from drifting back to AI-default territory between sessions.
4. Anti-references and vocabulary in the brief — explicit negation outperforms positive instruction.
5. Your existing Obsidian vault, made machine-readable — the personal substrate is the competitive advantage, not the model.

Skip: complex multi-agent orchestrators for design decisions, Figma Make for editorial typography, and vibe-design framing without a critique loop. Keep: the Double Diamond as organizing metaphor, with the understanding that the diamonds are now hours wide, not weeks.

Saarinen's line is the one to keep close: "The form is there. The fit is not." With all this leverage available, fit is the only remaining problem worth working on.
