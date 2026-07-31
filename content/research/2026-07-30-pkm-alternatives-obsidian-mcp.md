---
title: "The most agent-native knowledge base is a folder of files"
slug: pkm-alternatives-obsidian-mcp
pubDate: 2026-07-30
pillar: agentic-ax
tags: [tooling, mcp, agentic-systems]
description: "Every note-taking tool is racing to ship an MCP server. The ones that stored plain files already had the integration and did not need to build it."
publish: true
---

There is a quiet competition happening across personal knowledge tools right now to ship an MCP server, and it is worth noticing who has to compete and who doesn't.

Notion, Anytype, Tana, Capacities and Outline have shipped official ones. Everything else - Obsidian, Trilium, SiYuan, Logseq, Joplin, Docmost, AFFiNE - depends on community servers of varying maturity and abandonment risk. And a folder of Markdown files needs nothing at all, because the filesystem is already the interface. Claude Code can read and write it today. No OAuth, no tokens, no plugin, no server to keep alive.

That asymmetry is the whole story. The tools racing to build an integration layer are the ones whose data model put a wall between the content and the agent in the first place.

## The app and the format are different complaints

The reason this matters practically is that most people who say they want to leave Obsidian are describing problems with the application, not the file format, and the two have very different remedies.

The application complaints are real and well documented. It is source-available under a proprietary license, so you cannot fork it or self-host it, while community plugins have extensive filesystem access. Plugins break on updates - obsidian-metatable carries a deprecation notice that simply says "Obsidian 1.4 broke it," and even obsidian-mcp-tools, at 87k installs, was abandoned by its maintainer. Mobile is materially worse than desktop, and large vaults can take minutes to load on Android. Large-vault performance degrades in ways that updates sometimes worsen.

Worth correcting one thing that circulates constantly in the leaving-Obsidian genre: Sync is $4/user/month billed annually, or $5 monthly. The roughly $8/month figure quoted in those posts is Publish, a different product.

None of that is a complaint about Markdown. And the format is the part that determines whether an agent can work with your notes. So the cheapest available fix is not migration - it is pointing an agent at the vault directory you already have, adding a `CLAUDE.md` that describes the structure and conventions, and leaving the editing app exactly where it is. Obsidian and an agent are complementary rather than competing: edit in one, query and write from the other, on the same files.

Obsidian also closed its most cited functional gap. Bases landed as a core plugin in 1.9.0 and rolled out to everyone in 1.9.10, turning any set of notes into a database, backed by local Markdown and YAML with a new `.base` file format. It is table-view-only so far and less flexible than Dataview for non-table cases, but the "I need a real database" argument is weaker than it was.

## If you do move, move for a capability

There are only three reasons I would actually migrate, and each points at a different tool.

**You want an agent memory layer, not a new editor.** Basic Memory is the closest thing to a purpose-built agent-native PKM: open source, plain Markdown with `[[wikilinks]]` and YAML frontmatter, a rebuildable SQLite index alongside the files rather than instead of them, and an MCP server that is the entire product rather than an afterthought. It is Obsidian-compatible in the strong sense - same files, so the graph and backlinks keep working. You point it at the vault and keep editing where you already edit. It is not a polished GUI app, and it should not be evaluated as one.

**You genuinely need HTML rich text.** TriliumNext is the honest answer: self-hosted, AGPL, hierarchical, CKEditor-based rich text with real HTML underneath, attributes that double as database columns. Three community MCP servers exist over its ETAPI, several maintained through 2026. The tradeoff is exactly the one you would expect - an HTML store is less greppable and less portable than flat Markdown, and you are trading the property that made the vault agent-friendly for the property that makes it expressive.

**You actually needed a team wiki.** Then it is Outline, which shipped an official MCP server into every workspace in early 2026, or Notion, whose hosted MCP is the most polished of any tool in this space at 18 tools. Both are a different product category than a personal vault, and choosing one means deciding the database and the collaborators were the point all along.

What I would avoid: Dendron is dead, development ceased and maintenance-only. Roam has been eclipsed. Amplenote has no MCP and an active user base asking for one. And Logseq is mid-rewrite, having split into the maintenance-mode original and a SQLite-backed DB version whose beta was announced on 13 July 2026 - with the project's own README warning that "data loss is possible so we recommend automated backups." That is not a migration to start this quarter.

## Official does not mean better for agents

The most useful distinction in this whole landscape is not official versus community. It is whether the server can run unattended.

Notion's hosted MCP is OAuth-only, which means it cannot run headless in CI or on a cron. Outline's official server issues tokens that expire in about an hour. Both are fine for a human sitting in front of a chat window and useless for an agent fleet running overnight. Meanwhile several token-based community servers do that job without complaint.

So "has an official MCP server" is close to the wrong question. The better ones are: can the agent authenticate without a human in the loop, can it write as well as read, and is the underlying store something you could still parse if the server disappeared tomorrow. Plain files answer all three trivially, which is the point.

## The publishing layer is a separate decision

The one thing a Markdown vault genuinely lacks is a rendered public surface, and that is a solved problem that does not require changing where you write.

Quartz is close to a one-to-one clone of Obsidian Publish, with graph view, wikilinks and embeds, free, deployed to Pages, and dated-looking. Astro Starlight is faster and better on search via Pagefind, and has a `starlight-obsidian` plugin for publishing a vault directly. MkDocs Material remains the most widely used by a wide margin, though its situation is odd right now - the Material creator forked to a new engine called Zensical while MkDocs's original creator retook the main repo and announced a 2.0.

Which gives the shape I would actually recommend, and it is deliberately boring. Markdown vault as the source of truth. A static site generator as the rendered wiki. The filesystem, or a thin memory layer over it, as the agent interface. Three parts, each replaceable without touching the other two, and nothing in the middle that can abandon you.

One caveat on all of the specifics above: this is a fast-moving and largely community-driven space, and the star counts, versions and tool surfaces here are a mid-2026 snapshot. Check that a repo is still maintained before you depend on it. Abandonment is the normal outcome, not the exception.
