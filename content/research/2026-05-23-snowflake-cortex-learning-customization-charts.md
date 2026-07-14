---
title: "Snowflake Intelligence is the floor — Cortex Agents REST API is where the real work starts"
slug: snowflake-cortex-learning-customization-charts
pubDate: 2026-05-23
pillar: beyond-chat
tags: [agentic-systems, generative-ui, snowflake, tooling]
description: "How Snowflake Cortex Agents actually works as a stack, what Snowflake Intelligence restricts on the UI layer, and how to handle Vega-Lite charts in a Next.js generative-UI build."
publish: true
---

Snowflake Cortex Agents went GA on November 4, 2025. Snowflake Intelligence went GA the same day. Most enterprise AI conversations about Snowflake now orbit one question: do you consume Intelligence's ready-made chat UI, or do you call the Cortex Agents REST API and build your own front-end? The answer turns entirely on what the UI layer needs to do — and Snowflake Intelligence's customization ceiling is lower than most people realize when they first see the demo.

## The five-layer stack

Everything in Cortex AI organizes into five concentric layers. Getting these straight matters because the learning resources, the RBAC roles, and the architectural trade-offs all map to them.

**Cortex AI / LLM Functions** — SQL- and Python-callable functions (`AI_COMPLETE`, `AI_CLASSIFY`, `AI_SUMMARIZE`, `AI_TRANSLATE`, `AI_EMBED`, `AI_EXTRACT`, `AI_PARSE_DOCUMENT`) that wrap hosted models (Anthropic Claude 3.5/4 Sonnet, Llama, Mistral, OpenAI gpt-oss, Snowflake Arctic) inside the Snowflake security boundary. The old `SNOWFLAKE.CORTEX.COMPLETE` family is being deprecated by end of 2026; new code should use the `AI_*` names.

**Cortex Search** — managed hybrid (vector + lexical) retrieval service. Point it at a query that returns chunked text, and Snowflake handles embedding (Arctic-Embed-based), indexing, and refresh. Recommended chunk size is no more than 512 tokens (~385 English words). This is the unstructured-data tool that an Agent calls.

**Cortex Analyst** — multi-agent text-to-SQL pipeline: classification → feature extraction → context enrichment → SQL generation → error correction → synthesizer. Per Snowflake's engineering blog, it achieves "more than 90%+ SQL accuracy on real-world use cases… consistently close to 2X more accurate than single-shot SQL generation from state-of-the-art LLMs." You feed it either a **Semantic View** (schema-level SQL object, GA at Summit 2025, preferred) or a legacy YAML semantic-model file on a stage. Most published quickstarts still use YAML; new builds should use Semantic Views.

**Cortex Agents** — Snowflake's managed agent runtime: planning, tool selection, tool execution, citation assembly, observability. Tools available: `cortex_analyst_text_to_sql`, `cortex_search`, `web_search` (Brave, zero-data-retention), `generic` (UDFs/stored procs), `cortex_analyst_sql_exec`, plus chart generation (Vega-Lite). Default orchestration model is `claude-4-sonnet` (requires cross-region inference in many regions); `claude-3-5-sonnet` is the fallback. The API endpoint is `/api/v2/cortex/agent:run`; requests time out after 15 minutes.

The Sept 2025 Agent Admin Object is the current GA pattern. Instead of passing tool lists inline on every API call, you define a persistent Agent object in Snowflake and reference it by name. Any tutorial that passes tools inline on every request is using the older pre-September pattern — it still works, but it's not what you'd build from scratch today.

**Snowflake Intelligence** — the ready-made chat UI at `ai.snowflake.com` and inside Snowsight, built on Cortex Agents. Adds Deep Research Agent for Analytics, Artifacts, Personalization, a mobile app (public preview), and MCP connectors to Gmail/Calendar/Docs/Jira/Salesforce/Slack. Over 9,100 customers use Snowflake's AI products weekly as of Snowflake's April 2026 press release.

## What Snowflake Intelligence doesn't let you touch

The agent and behavior layer is deeply flexible: you can shape instructions, compose tools, wire MCP connectors, select models, and set up SCIM provisioning via Okta or Entra. The UI layer is locked.

No branding, white-labeling, or theming. The chat UI lives at `ai.snowflake.com` and inside Snowsight. There is no way to apply a brand's design language, remove Snowflake chrome, or put a product name on it. No iframe embed, no SDK, no widget — you cannot drop it into a portal or an existing application. The layout is fixed: chat experience with inline charts and tables. Visualization is basic bars, lines, pies, and tables. No custom React components, no interactive cross-filtering, no dashboard composition. No multi-tenancy story for external users — Snowflake Intelligence is designed for internal Snowflake users in your account, not for end users who don't have Snowflake identities.

Snowflake's own guidance on this is explicit: if you need any of those things, don't use Snowflake Intelligence — call Cortex Agents directly via the REST API and build your own front-end. That is the `awesome-custom-cortex-agents-rest-api-react-app` pattern, and it's what any meaningful generative-UI build on Cortex actually requires.

A useful framing for positioning conversations: Snowflake Intelligence is the floor, not the ceiling. It's what an org could deploy tomorrow with zero engineering. The custom app delivers what SI structurally can't: brand-native experience, generative canvas layouts, external user multi-tenancy, deeper cross-system reach via MCP, and embeddability where work actually happens.

## Where to start learning (the current stack, May 2026)

Any pre-2025 Cortex content is effectively obsolete on the agent layer. Cortex Agents GA'd Nov 4, 2025; the Agent Admin Object shipped Sept 2025; Semantic Views went GA at Summit 2025. The recommended learning sequence:

1. **Orientation (60–90 min):** Jeff Hollan's BUILD 2025 keynote on Snowflake Intelligence GA + Chanin Nantasenamat's "Developer's Guide to Snowflake Cortex Agent" on Snowflake's Medium blog (it has the cleanest architecture diagram of the full ecosystem).

2. **Quickstarts in order:** Cortex Analyst → Cortex Search RAG → Cortex Agents → Snowflake Intelligence. Each one's setup patterns carry forward into the next. The Snowflake-Labs GitHub org (`github.com/snowflake-labs`) is the source of truth — the `sfguide-*` repos are updated faster than the rendered quickstart pages.

3. **For custom client builds:** clone `Snowflake-Labs/sfguide-getting-started-with-cortex-agents-and-react` (Next.js App Router, Tailwind, Vega-Lite, key-pair JWT). This is the repo to fork, not `awesome-custom-cortex-agents-rest-api-react-app`.

4. **For production readiness:** do the Cortex Agent Evaluations quickstart. Build a 20-question eval set, run it. This is where the difference between "it works in a demo" and "it works in production" lives.

## The chart problem: Vega-Lite as a protocol

This is the part most Next.js builders get wrong, and it's worth being explicit about.

Cortex Agents don't return image URLs or Recharts JSX when you ask for a chart. They return a Vega-Lite v5 JSON spec in the `response.chart` SSE event — `chart_spec` as a stringified JSON document with `$schema: "https://vega.github.io/schema/vega-lite/v5.json"`. The agent is saying "here's what to draw; you pick the renderer." Vega-Lite is a protocol between the agent and your UI, not just a charting preference.

The reference repo `awesome-custom-cortex-agents-rest-api-react-app` translates Vega-Lite specs into Recharts. This is a mistake worth understanding. Vega-Lite has 11 primitive marks plus composite marks, view composition (layered, faceted, trellis), and a full transform grammar (bin, timeUnit, aggregate, calculate, filter, joinaggregate, window, stack, pivot). Recharts has 12 chart containers and none of Vega-Lite's composition or transform system. The reference repo's Recharts adapter works for the easy marks — bar, line, area, arc, scatter — but breaks down the moment Cortex returns a rect heatmap, a faceted trellis plot, a layered spec, or anything with a non-trivial transform array. The `awesome-custom-cortex-agents-rest-api-react-app` is a small, single-contributor starter (13 commits, 0 open issues, 20 stars) that the README itself frames as a template. Snowflake's own Next.js quickstart uses `react-vega` + `vega-lite` natively. That's the right call.

**The recommended architecture:**

Build a three-stage chart renderer. Stage 1 is a Recharts adapter covering `bar`, `line`, `area`, `arc`, and `point` marks with `x`/`y`/`color`/`tooltip` encodings — this is one to two days of work and handles roughly 80% of what Cortex's `data_to_chart` tool actually emits for analytics use cases. Stage 2 is a `react-vega` fallback, lazy-loaded via `next/dynamic({ ssr: false })`, that routes any spec the adapter can't handle. Stage 3 is a nudge in the agent's response instructions: "When generating charts, prefer simple bar, line, area, pie, or scatter marks. Pre-aggregate data in the SQL query rather than using Vega-Lite transforms." This isn't a hard guarantee — LLMs ignore instructions sometimes — but it sharply reduces fallback frequency.

Why Recharts for the common cases rather than `react-vega` everywhere: bundle size, theming, and shadcn/ui integration. Recharts' gzipped weight is ~136 KB; the Vega stack (vega + vega-lite + vega-embed) is materially larger and renders to a non-React DOM subtree, which complicates dark mode and design-token integration. Shadcn/ui's Chart component is built on Recharts v3 and gives you tooltip/legend/grid styling that already matches the dashboard. The fallback handles the edge cases without imposing the Vega bundle cost on every user.

What not to do: don't build a "complete" Vega-Lite-to-Recharts compiler. The moment you hit `transform: [{aggregate: ...}]` you discover you need a dataflow engine. Use react-vega for anything past the easy cases.

Also don't have the LLM emit Recharts JSX directly. You lose Vega-Lite's defined schema, the agent's tool-aware orchestration, and Snowflake's quality guarantees on what `data_to_chart` produces. Treat `chart_spec` as the contract.

## The four decisions that matter for a Next.js build

**Fork `sfguide-getting-started-with-cortex-agents-and-react`, not `awesome-custom-cortex-agents-rest-api-react-app`.** The quickstart is running Next.js 15 with Turbopack, `fetch-event-stream`, `react-vega`, `react-syntax-highlighter`, `next-auth`, key-pair JWT, and Tailwind. It has 46 commits and active maintenance. The reference repo has 13 commits and hasn't been touched since the initial push.

**PAT for prototyping; key-pair JWT for production.** The reference repo uses a Personal Access Token injected server-side via an Express proxy, which is fine for demos and explicitly never reaches the browser. For any multi-tenant or production deployment, switch to key-pair JWT minted per-request server-side. Navnit Shukla's April 2026 Medium piece "You Have Three Options to Authenticate to the Cortex REST API" is the clearest side-by-side reference.

**Thread persistence requires explicit wiring.** The reference repo lists threading under "Future Enhancements" — `thread_id` and `parent_message_id` are not implemented. Multi-turn memory is entirely client-side message-array based. If you need server-side conversation persistence, Tony Gordon Jr's community Next.js + FastAPI + Postgres reference implementation has the pattern, including `async for line in response.aiter_lines()` for clean SSE forwarding.

**For a generative-UI canvas, centralize artifact promotion in a Zustand store.** The reference renders everything inline inside a chat bubble. A three-column dashboard needs charts and tables teleported into a center canvas. A Zustand store with `currentArtifact: { type: 'sql'|'chart'|'table', payload, sourceMessageId }` is the right model. On each `response.chart` or `response.tool_result` event, push into the store; the canvas subscribes. Provide a "view in canvas" affordance to re-promote older artifacts.

## What's stale

Skip anything pre-2025 on Cortex. Skip tutorials that pass tools inline on every `agent:run` call without an Admin Object. Skip tutorials that use only YAML semantic-model files on a stage rather than Semantic Views for new builds. If you see `SNOWFLAKE.CORTEX.COMPLETE` in sample code, the tutorial predates the current API naming. One-off warning: at least one popular YouTube re-upload of Summit 2025 content misspells both "Snowflake" and Jeff Hollan's name — check that you're on the official Snowflake channel before treating anything as canonical.
