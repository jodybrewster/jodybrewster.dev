---
title: I published pro-dev-skillset
date: 2026-07-28
status: seedling
tags:
  - claude-code
  - tooling
publish: true
---

Made [pro-dev-skillset](https://github.com/jodybrewster/pro-dev-skillset) public today. It's a plugin marketplace for Claude Code and Codex. Install it once and a curated stack of skills, hooks, and slash commands shows up in every project.

The idea was to organise it around the software lifecycle instead of a pile of loose tools. Define, plan, build, verify, review, ship. Each phase has a plugin that owns it. `pro-pdd` for the fuzzy front end, `pro-execution` for TDD and debugging, `pro-design` for frontend craft, `pro-testing` for verification, `pro-quality` for code review and docs. `pro-starter` pulls the default set in one install, and `/using-pro-dev` is the router that maps whatever you're doing to the right skill.

A lot of it is forked from other people's good work and stitched into something consistent. Still moving, but it's out there.
