---
title: "The best design engineer portfolios are not documents about work, they are the work"
slug: design-engineer-portfolios-field-guide
pubDate: 2026-07-30
pillar: senior-practice
tags: [design-engineering, portfolio, senior-practice]
description: "Design engineers proved a discipline by shipping the artifact instead of describing it. What that changes about seniority, evidence, and the case study."
publish: true
---

Vercel's job description defines the role about as cleanly as anyone has: "Design Engineers at Vercel blend aesthetic sensibility with technical skills. This allows us to deeply understand a problem, then design, build, and ship a solution autonomously." Read the portfolios of the people who hold that title and you notice they are not arguing for that sentence. They are demonstrating it. The site is the evidence, not the brochure.

That is a genuine shift in what a portfolio is for, and it has consequences for anyone senior who came up through a discipline where the case study was the deliverable.

## The proof object replaces the case study

A product designer's portfolio is a set of annotated screens with a narrative around them: problem, process, solution, impact. It works because design decisions are otherwise invisible, so the artefact has to be a story about the decisions.

Design engineers don't have that problem. Their decisions are executable. So the strongest portfolios in the category substitute demonstrable craft artefacts for the storytelling, and the artefacts do the persuading.

Emil Kowalski's site is close to the minimum viable version: a short bio, a projects list, a writing list. What makes it work is that every item on the projects list is a shipped, widely used open-source object. Sonner. Vaul. His animations course. There is no case study because none is needed. Rauno Freiberg's is the maximal version, a site built as an operating system with a dock and interface sounds, backed by cmdk - which npm lists with 3,744 dependent packages, largely because shadcn/ui's Command component wraps it. Neither of them has to claim they have taste.

The lesson generalises past the design engineer title. When you can ship the thing, shipping it is a stronger claim than describing it. When you can't, the case study is doing necessary work, not decorative work. Knowing which situation you are in is most of the decision.

## Five shapes, and what each one costs

The portfolios worth studying cluster into five approaches, and the elite examples usually blend two or three.

**Site-as-demo.** The site itself is the flagship artefact. Rauno, Bruno Simon's drive-a-car-through-a-3D-world folio, Lynn Fisher's annual full redesign. Unforgettable, and expensive. It can also overshadow the actual work, and it reads as style over substance if the projects behind it are thin.

**Component or craft library.** Lead with reusable open-source objects. Emil, Paco Coursey, Shu Ding's cobe - a 5kB WebGL globe that, per Shu Ding, "improved our page performance by almost 60%" and now runs on vercel.com. The strongest possible "I can build" proof, with compounding reputation through downloads. It requires you to have shipped notable OSS, which makes it a poor fit for enterprise work under NDA.

**Writing-first.** Essays carry the authority. Guillermo Rauch, Maggie Appleton, Maxime Heckel. Great for senior positioning and low visual-design risk, but it needs genuinely good ideas and it builds distribution slowly. Worth noting that Rauch's version works partly because he already has a platform; the approach is riskier without one.

**Single-page minimal.** One screen, a few links, ruthless economy. Signals confidence, cheap to maintain, and only works if the links point somewhere impressive. It is a frame, not a substitute for substance.

**Interactive playground.** Embedded live demos. Amelia Wattenberger's data-viz-heavy site with self-hosted video of AI prototypes is the reference. The proof is inline and undeniable, and the polish has to be flawless or it actively works against you.

## The anti-patterns are mostly self-refutation

The failure modes here are unusually literal. A design engineer's site with janky animation, layout shift or poor performance refutes its own claim, in the medium the claim is about. Rauno's line on this is the one to keep: if a UI "only works 80% of the time, the perception of quality breaks - it's lipstick on a pig."

The others are more familiar. A grid of thumbnails with no story, when hiring managers scan for depth on one or two projects rather than breadth across twelve. A dazzling wrapper around hollow work, which reads as junior regardless of how impressive the wrapper is, because seniority shows up in judgement and tradeoffs rather than effects. And neglecting accessibility, reduced-motion and cross-browser support, all of which are explicitly inside Vercel's own definition of the role and therefore a fast no from a careful reviewer.

There is one that is specific to this moment. For anyone positioning around AI work, shipping a generic chat box as the demonstration signals shallow thinking about interfaces. Wattenberger's argument is that chat gives "unclear affordances" and forces users to alternate between "implementation (typing) and evaluation (reading)," and that "the burden to learn what works still lies with every single user, when it could instead be baked into the interface." Demonstrating that you understand this is itself the differentiator, because so much of the field has not caught up to it.

## What changes when you are senior

The junior version of this advice is "build things and show them." The senior version is different in kind, not degree.

Depth beats breadth, sharply. Three or four case studies that go all the way down - problem framing, architecture, the interaction decisions, the tradeoffs, the outcome - read as far more senior than a long gallery. A junior portfolio demonstrates capability. A senior one has to demonstrate judgement at the system level, which requires enough space to show a decision being weighed rather than just made.

The differentiator against a very good twenty-five-year-old design engineer is not craft. It is that you can put a polished interaction demo next to a systems architecture diagram and explain why the thing scales. Artefacts only a senior can produce - a design-system governance model, an agentic-UI architecture, a delivery framework - are worth more than another component.

And the NDA problem is real for anyone doing enterprise work. Most of it cannot be shown. The counter is the same move Emil and Rauno make for different reasons: one credible public artefact outweighs ten confidential thumbnails you can only gesture at. A small open-source component, an interactive essay on a pattern, a public demo of an agent interaction. Something a reviewer can run or read in under two minutes and immediately respect.

## The canon here is thin, which is the opportunity

The AI-interface corner of this discipline has almost no established canon. Wattenberger, Maggie Appleton and Emil Kowalski are effectively defining the archetype as they go, and there are not many others. That cuts both ways - fewer proven templates to borrow, but also very little crowding.

Worth holding lightly, though. People in this field move between Vercel, Linear, The Browser Company and GitHub Next often enough that any titles cited here will be stale within a year, and "design engineer" is still a contested label that a lot of these people don't use about themselves. Some say creative developer, some say frontend engineer, some say interaction designer. Treat the grouping as a spectrum rather than a category, and treat the portfolios as evidence about what persuades rather than as a template to copy.
