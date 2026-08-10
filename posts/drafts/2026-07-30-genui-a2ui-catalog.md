# The gen-UI wars just picked a side: your design system wins

*Written by Claude (Anthropic's Fable model) as part of an autonomous research-and-writing pipeline. Jody's annotations appear in the marked blocks. Everything else is machine-drafted, human-curated.*

---

For two years, generative UI demos have all made the same implicit promise: the model will conjure an interface out of thin air. Ask about flights, get a flight card. Ask about your portfolio, get a chart. The UI materializes, unbounded, from the model's imagination.

This month, Google quietly told everyone that's the wrong idea.

A2UI v0.9 shipped in July, and buried under the release notes (new Python Agent SDK, bidirectional protocol, official React renderer, a rewritten modular schema) is a genuine philosophical reversal. The spec now says, in effect: agents shouldn't invent components. They should declare *intent*, and your application should render that intent through the components you already own. The optional component set formerly called "Standard" got renamed to "Basic," a naming change that reads like a demotion on purpose. The message to frontend teams is to wire the agent into your design system and not let it freelance.

If you've shipped generative UI in an enterprise context, this is the moment the standards caught up with reality.

> **[JODY'S TAKE]** - *This is where you land the practitioner credibility. Suggested angle: "This is exactly how we had to build it for a Fortune 100 client. The first thing we did was write a DESIGN.md the agent couldn't escape from. Free-form generation was never on the table, and not because it doesn't demo well, but because brand, accessibility, and legal review all assume a finite component vocabulary."*

## What actually changed

v0.9 rewrites rather than patches: the schema, the JSON structure, and the core philosophy all changed, and the protocol went bidirectional. The interesting engineering is on the agent side. The new SDK (a single `pip install a2ui-agent-sdk`) handles version negotiation, dynamic catalogs that can swap schemas at runtime, and, my favorite detail, resilient streaming that incrementally parses and *heals* partial LLM output, so components render as tokens arrive rather than waiting for a complete, valid payload. Anyone who has watched a JSON-mode response die at 95% complete knows why that matters.

Transport got promiscuous too. A2UI now runs over MCP, WebSockets, REST, AG-UI, and the freshly-minted A2A 1.0. Google is positioning it as the portable contract underneath AG-UI and MCP Apps rather than a competitor to them, the thing that describes *what* to render while the others argue about *how* to move it.

## The fight worth watching

The pushback is where this gets fun, because both critiques are correct and they point in opposite directions.

Camp one, loudest on Hacker News: why would you trust an LLM to output UI at all? Security bugs, impersonation attacks, usability chaos. Camp two, from the practitioner threads: the catalog model is too restrictive, and if every agent can only render pre-approved components, "every UI will become the same."

Notice that the catalog approach is precisely what defuses camp one. An agent that can only select from a validated component vocabulary can't render a fake password prompt. The security argument and the sameness argument are the same argument viewed from opposite ends: constraints are the feature *and* the ceiling.

The most useful synthesis I found came from architect Brian Love: fixed catalogs as the trust boundary, dynamic overlays for expressiveness within it, and deterministic fallback when validation fails. That's just what a production architecture looks like.

> **[JODY'S TAKE]** - *Optional second slot. Angle: where you'd draw the catalog boundary in practice, e.g. "In our delivery work the catalog isn't just components, it's composition rules. The agent picks the card; the design system decides the card can never contain another card. That second layer is what nobody's spec'd yet."*

## Why this matters beyond Google

Because this is the pattern of every AI-adjacent standard right now. The first generation of a spec assumes the model is the author. The revision assumes the model is a *participant* in a system with existing contracts: design systems, type systems, permission systems. A2UI v0.9, spec-driven development, structured outputs, MCP's tool schemas, it's the same lesson wearing different hats. The models got good enough that the bottleneck moved from "can it generate?" to "can we govern what it generates?"

For frontend teams, the practical takeaway is blunt. Your design system just became your AI strategy. If your components aren't typed, documented, and consumable as a machine-readable catalog, you have a demo rather than a generative UI roadmap. The teams that invested in design tokens and component contracts for boring old consistency reasons accidentally built the substrate agents need.

A v1.0 release candidate is already published, so the window to influence the spec, or to be early with a production story about it, is now.

---

*Sources: Google Developers Blog (A2UI v0.9 announcement), InfoQ's coverage by Daniel Curtis, CopilotKit's spec breakdown, and the a2ui.org specification and evolution guides. Research and drafting: Claude. Curation and annotations: Jody Brewster.*
