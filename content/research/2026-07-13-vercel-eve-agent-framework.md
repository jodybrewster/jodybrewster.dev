---
title: "Vercel Eve makes an agent a folder of files, and the AI Gateway is optional"
slug: vercel-eve-agent-framework
pubDate: 2026-07-13
pillar: agentic-ax
tags: [agentic-systems, tooling, vercel, agent-frameworks]
description: "Vercel's Eve is an open-source, filesystem-first TypeScript agent framework. It defaults to the AI Gateway but does not require it."
publish: false
---

The interesting thing about Vercel's Eve is not that it is another agent framework in an already crowded year.
It is that an Eve agent is a directory of files.
`instructions.md` is the always-on system prompt.
Each file in `tools/` is one typed tool.
`skills/` holds procedures the model loads only when relevant.
`channels/` are the entry points.
You read an agent by reading its folder, and you review a change to an agent as a Git diff.
Vercel's framing is that "agents have a shape," and Eve is that shape made into a framework, so you define what the agent does and not how it runs in production.
That is the whole pitch, pitched as "Next.js for agents," and it is a good one.

Eve is Apache-2.0, published as the npm package `eve`, and it launched in public preview at Vercel Ship London on June 17, 2026 at version eve@0.11.4.
It is beta, explicitly subject to Vercel's beta terms, so APIs and behavior can change before GA.
The reason to look past the beta label is that the production plumbing everyone rebuilds for every agent ships in the box: durable execution on the open-source Workflow SDK, sandboxed compute (Vercel Sandbox in production; Docker, microsandbox, or just-bash locally), human-in-the-loop approvals, subagents, multi-channel delivery, OpenTelemetry tracing, and a built-in evals system.

## Do you need the AI Gateway? No.

This was the question I actually wanted answered, and the answer is that the AI Gateway is the default model layer, not a hard prerequisite.
In `agent.ts` you set a model string like `anthropic/claude-sonnet-4.6` or `openai/gpt-5.4-mini`, and Eve resolves it through the AI Gateway.
On Vercel you authenticate with OIDC, so there are no provider API keys to manage, and the provider-fallback feature that switches models when one fails is implemented through the gateway.
That is the smooth path, and for most teams it is the right default.

You can also skip it.
Point Eve at a direct provider through the AI SDK and it uses that provider's own package and key, so `anthropic("claude-opus-4.8")` from `@ai-sdk/anthropic` runs on `ANTHROPIC_API_KEY` with no gateway in the loop.
Vercel CTO Malte Ubl put it plainly to DevClass on June 23, 2026: "You can connect any model that AI SDK connects to, which is all the models."
One caveat worth tracking if platform-independence matters to you: an early user reported Eve still required a Vercel login even when configured for a different provider.
Ubl called it a possible bug and said, "We are 100 percent committed to making it work everywhere."
Take the default gateway path unless you need a specific provider, want to avoid the dependency, or are hitting gateway cost or rate limits.

## Where it sits in Vercel's stack

Eve does not replace the AI SDK.
The relationship is React to Next.js: the AI SDK gives you component-level primitives (streaming, tool calls) and Eve is the opinionated framework on top.
If all you need is to stream a model's output with tool calls inside an existing app, use the AI SDK directly and skip Eve.
Reaching for the full framework there is over-engineering the problem.

Everything else is the "Agent Stack": AI SDK, AI Gateway, Vercel Sandbox, Workflow SDK, Chat SDK, plus the newer Vercel Connect for short-lived scoped credentials and Vercel Passport for enterprise identity.
The architecture is the folder, made concrete:

- `agent.ts` configures the model and runtime via `defineAgent` (provider fallbacks, compaction, model options).
- `tools/*.ts` each define one tool with a Zod input schema; the filename becomes the tool name, and a `needsApproval` field gates sensitive actions behind human approval.
- `subagents/*` are child agents with their own tools and sandbox, each starting with a clean context window, which is the same isolation pattern that makes [[2026-05-23-diverge-converge-workflows|critique-as-subagent]] worth doing.
- `channels/*.ts` are entry points; HTTP is on by default, with Slack, Discord, Teams, Telegram, Twilio, GitHub, and Linear included.
- `connections/*` are typed integrations against an MCP server or OpenAPI API, where Vercel Connect brokers OAuth so the model never sees credentials.
- `schedules/*.ts` deploy as Vercel Cron Jobs.

Sessions run on Vercel Workflows as a replayable event log, so a session survives cold starts, redeploys, and long pauses, and a session mid-task when you deploy finishes on the version it started on.
The stable API is `POST /eve/v1/session` and `GET /eve/v1/session/<id>/stream`, traces are standard OpenTelemetry spans that export to Braintrust, Raindrop, Arize, Honeycomb, Datadog, or Jaeger, and Fluid Compute is on by default because turns are long-running and stream incrementally.

## The internal numbers, and how much to trust them

Vercel says it runs more than 100 agents in production on Eve and that this is the framework it builds its own agents on.
d0, the data analyst, is described in the "Introducing eve" blog as "the most-used internal tool at Vercel," handling more than 30,000 questions a month, with roughly 45% of those now coming from other agents rather than people.
Lead Agent is an autonomous SDR that Vercel says costs about $5,000/year, returns 32 times that, and is maintained part-time by one engineer.
Athena is a sales cockpit "built by RevOps in six weeks without engineers," after which "pipeline coverage nearly doubled."
Vertex is a support engineer that "resolves 92% of tickets on its own."

Read those as vendor marketing, because that is what they are.
The ROI and resolution figures come from Vercel and have not been independently verified.
The adoption claim has the same problem in a sharper form: the blog says "A year ago, agents triggered less than 3% of deployments on Vercel. Now they trigger around 29%," while Guillermo Rauch said on stage that agents trigger "more than half of all commits."
Those are different measurements, deployments versus commits, and the gap between them is a reminder to check which number you are being sold.

## Getting started, cost, and the competition

The framework is free.
Cost comes from the Vercel resources an agent consumes: Functions, Workflows, Sandbox, and gateway or direct model usage.
The Pro plan is $20 per developer per month with a $20 included credit and pay-as-you-go beyond it.
To start, `npx eve@latest init my-agent` scaffolds a project and dev server in under a minute; run locally with `eve dev`, test with `eve eval`, and ship with `vercel deploy`, where the same directory runs in production and the sandbox swaps to Vercel Sandbox automatically.

The field is crowded.
Mastra is the closest TypeScript-native rival (YC-backed, hit 1.0 in January, platform-agnostic).
LangChain's LangGraph is the most established but Python-first, and Inngest's AgentKit is another TypeScript option with durability.
The cloud providers attack from the infrastructure side: Cloudflare Workers and Durable Objects, AWS Bedrock AgentCore, Google Vertex AI Agent Engine, Microsoft Agent Framework, and OpenAI's AgentKit.
Eve's edge is packaging, not any single novel primitive: the filesystem-as-agent convention, the bundled production infrastructure, and Vercel's distribution.
If you are Python-first, none of that is for you yet.

## Where to watch it

The framework was announced on stage in the Ship 26 London keynote, and the Agent Stack segment (Tom Occhino and team) is where Eve shows up: https://www.youtube.com/watch?v=T1vs9jE-EEI
The official X announcement is https://x.com/vercel/status/2067180054979936413
There is no dedicated standalone official Eve explainer on the VercelHQ channel; the rest of the promotion lives at vercel.com/eve, eve.dev, the blog at vercel.com/blog/introducing-eve, and github.com/vercel/eve.
The useful third-party walkthroughs:

- "Vercel Just Launched EVE - Next.js for AI Agents": https://www.youtube.com/watch?v=xbVNliVlr-g
- "You are going to want to build your Agents on this": https://www.youtube.com/watch?v=z8sp1dALZTI
- "Vercel just shipped Eve. I plugged my own tools into it.": https://www.youtube.com/watch?v=iY1lMN2QiBo
- "Vercel Eve - The Framework for Building Durable AI Agents (Open Source)": https://www.youtube.com/watch?v=chW-zQzIhmM

Exact upload dates and durations could not be confirmed because YouTube rate-limited direct fetches; titles, channels, and topical relevance were verified through search.

## The read

If you are a TypeScript or Next.js team building production agents, Eve is worth serious evaluation now, and the filesystem-first convention is the most coherent answer I have seen to making agents reviewable, shareable, and ops-friendly.
Track GA before you depend on it, pin versions, and expect API churn while it is in beta.
Watch the cost curve too: for multi-step workflows with many sequential model calls, a paid gateway plan can become effectively necessary as free-tier limits run out, so monitor consumption in the Agent Runs tab.
The convention is the product here.
An agent you can diff is an agent a team can actually own, and that is a design decision worth more than any of the vendor's resolution percentages.
