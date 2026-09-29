# Product

## Register

brand

## Users

Design and product practitioners, AI/agent researchers, and potential collaborators or clients. The primary reader arrives via a shared link to a specific essay or brief, or finds the site through a recommendation. They are skeptical of hype, capable of reading closely, and evaluating whether Jody is someone worth paying attention to. A secondary reader is someone evaluating whether to hire or commission work.

## Product Purpose

Personal site for Jody Brewster, AI Experience Architect. Publishes writing, digital garden notes, and anonymized work briefs focused on agentic interfaces, AI-native design, and the craft of building experiences around systems that behave in ways their designers can't fully predict. The site is also itself a demonstration of the ideas it argues for: it exposes MCP endpoints, agent-readable markdown URLs, and Verso, a RAG-powered chat, as first-class design decisions, not features.

A stated purpose of the site is working in public with a second brain: Claude researches questions under Jody's direction, Jody reviews, and what holds up is published in the Research section. Surfacing what that second brain is building on is deliberate, not a byproduct.

The current visual system carries that editorial purpose through the interior pages: a permanent dark studio, thin condensed headlines, a supplied layered-glass mark, and one distinct generated illustration per research subject. Images support the argument of each piece and appear on both the index card and, where assigned, the article page.

Lab notes and Now belong to the same Studio family as writing and research. They keep their distinct content modes—unfinished notes and current reading/listening—while sharing the dark shell, navigation, spacing, and typography so the homepage links do not send readers into a visually unrelated part of the site.

## Brand Personality

Precise. Rigorous. Warm.

Not austere: warm, but never effusive. Not academic: rigorous, but never jargon-heavy. Not flashy: confident enough to not need to be.

## Anti-references

**Generic portfolio template.** Tech stack badge grids, headshots in hero sections, project thumbnail cards arranged in identical three-column grids, "About me" sections with bullet-point credentials. The work is the credential; the design should reflect that.

**SaaS landing page.** Gradient hero sections, big-number metrics with glowing accent stats, feature grids with icon-heading-text cards, sticky CTAs, "Get started for free" in heavy type. This site is not selling anything.

**AI startup aesthetic.** Neon accents on dark backgrounds, glassmorphism cards, abstract 3D renders of agents and pipelines, purple/blue glow effects, decorative "Built with Claude" badges. The site is about thinking clearly about AI, not performing proximity to it.

## Design Principles

**Writing first, everything second.** Every design decision exists to put text in front of the reader and then disappear. The writing earns the craft; the craft does not earn the writing. If a design element makes the page feel more impressive at the cost of reading ease, it is wrong.

**Argue by doing.** A site about designing AI-native interfaces should demonstrate AI-native design. Verso, the MCP endpoint, the .md URL pattern, the agent page are not features bolted on: they are the argument made tangible. Design decisions about these surfaces should be made with the same care as the typography.

**Verso is an AI, and Jody reads along.** Verso answers every question from the published corpus, and never waits for a person. Each finished question and its answer also reach Jody's phone. If he replies, the reply appears in the visitor's chat as him, under his own name, beside Verso's answer rather than in place of it. The two voices are never merged: Verso speaks about Jody in the third person, and Jody speaks as himself.

The dock says so plainly: Verso is an AI, it can get things wrong, and Jody sees what is asked and sometimes replies himself. Copy describing Verso says what it answers from, not what generates it, and must never suggest Jody writes Verso's answers.

One line breaks the third-person rule knowingly: the ask-bar placeholder reads "Ask Verso about my work". It is Jody's call and it stands. Anything added later should follow the rule rather than this exception.

## Measurement

The site collects two things. Verso's questions and answers go to Jody's phone, which the dock discloses. Google Analytics 4 runs on every page in production builds, sending page views by hand because the router makes every navigation after the first a soft one.

Analytics on a site whose argument is restraint deserves a stated position rather than a default. The one worth holding: measure whether the writing reaches people, not who they are. That means page views and referrers are in scope and behavioural profiling is not. Events follow the same line: they count what people do with the site (open the chat, follow a card, reach for the contact links) and carry values the site chooses, never what a visitor typed. What people ask Verso is read in the transcripts, which are kept 30 days, redacted of contact details and disclosed in the dock.

There is no privacy policy. With Verso transcripts and GA4 both live, that gap is now the site's most visible unfinished edge, and it should close before the site carries real traffic.

**Earned authority, not borrowed credibility.** No credentials list, no employer logos, no follower counts. The quality of the thinking is the credential. The design should reinforce this by presenting ideas without scaffolding them in social proof.

**Precision over decoration.** Every typographic decision, spacing choice, and color appearance should be deliberate. Nothing is present to make the page feel richer or more designed. If a decorative element cannot be justified by what it communicates, it is removed.

**Nothing optional is random.** The site's states (seedling, budding, evergreen on notes; draft, published on writing) are part of the design, not footnotes to it. The Now page exists. The briefs are numbered. These choices signal how the site is maintained, and that signal is part of what it communicates.

## Accessibility & Inclusion

WCAG 2.1 AA. The site supports light and dark color schemes via `prefers-color-scheme`, except the library shelf, which is pinned to the light palette because its surfaces are baked into the textures. Semantic HTML throughout. All icon usage should include accessible text equivalents.

Reduced motion is handled on the shelf: `prefers-reduced-motion` reaches the scene, drops the stage's fade-in and the page's travel, and makes the notebook close instantly rather than animating. It has not been audited on the rest of the site.

The shelf is progressive enhancement, not a requirement. Astro renders a complete, linked, image-bearing shelf in HTML first; Three.js replaces it. That markup is the whole experience without WebGL and for assistive technology, so nothing on the shelf is reachable only through the canvas.
