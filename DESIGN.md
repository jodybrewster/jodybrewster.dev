---
name: jodybrewster.dev
description: Personal site for Jody Brewster — writing, notes, and work briefs on agentic interface design.
colors:
  quiet-forest: "#2d5d4f"
  forest-mist: "#cfdcd6"
  deep-ink: "#14181d"
  settled-ink: "#3d444d"
  receding-ink: "#828a93"
  ash-paper: "#f1f2f0"
  warm-ash: "#e6e8e4"
  ash-rule: "#cbcec9"
typography:
  display:
    fontFamily: "Fraunces, 'Iowan Old Style', 'Apple Garamond', Georgia, serif"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "-0.025em"
    fontVariation: "\"opsz\" 120"
  headline:
    fontFamily: "Fraunces, 'Iowan Old Style', 'Apple Garamond', Georgia, serif"
    fontWeight: 450
    fontSize: "clamp(40px, 5.5vw, 60px)"
    lineHeight: 1.08
    letterSpacing: "-0.022em"
    fontVariation: "\"opsz\" 120"
  title:
    fontFamily: "Fraunces, 'Iowan Old Style', 'Apple Garamond', Georgia, serif"
    fontWeight: 450
    fontSize: "28px"
    lineHeight: 1.2
    letterSpacing: "-0.012em"
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "JetBrains Mono, ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "11px"
    fontWeight: 500
    letterSpacing: "0.06em"
rounded:
  sm: "4px"
  pill: "99px"
spacing:
  xs: "8px"
  sm: "16px"
  md: "32px"
  lg: "56px"
  xl: "72px"
motion:
  duration:
    fast: "150ms"
    base: "250ms"
    slow: "400ms"
  easing:
    enter: "cubic-bezier(0.0, 0.0, 0.2, 1)"
    exit: "cubic-bezier(0.4, 0.0, 1, 1)"
    standard: "cubic-bezier(0.4, 0.0, 0.2, 1)"
components:
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.settled-ink}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  nav-item-active:
    backgroundColor: "{colors.forest-mist}"
    textColor: "{colors.quiet-forest}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  button-primary:
    backgroundColor: "{colors.quiet-forest}"
    textColor: "{colors.ash-paper}"
    rounded: "{rounded.sm}"
    padding: "12px 18px"
  note-card:
    backgroundColor: "{colors.warm-ash}"
    textColor: "{colors.deep-ink}"
    rounded: "{rounded.sm}"
    padding: "20px 22px"
  probe-button:
    backgroundColor: "transparent"
    textColor: "{colors.deep-ink}"
    rounded: "{rounded.sm}"
    padding: "14px 16px"
  chat-input:
    backgroundColor: "{colors.ash-paper}"
    textColor: "{colors.deep-ink}"
    rounded: "{rounded.sm}"
    padding: "14px"
---

# Design System: jodybrewster.dev

## 1. Overview

**Creative North Star: "The Quiet Practitioner"**

The design communicates expertise by not announcing it. Fraunces at full optical weight does the heavy lifting; color appears rarely enough to carry meaning when it does; layout exists only to get the reader to the text and out of the way once they are there. There are no decorative motifs, no gratuitous shadows, no visual moves made for their own sake. The craft is in what is absent.

The palette is near-monochromatic: warm ash tones, gradated ink, and one quiet forest green that appears at most twice per screen. Three voices handle the full register: Fraunces for ideas, Inter for interface, JetBrains Mono for system metadata. They do not cross-dress. The states visible in the UI (seedling, budding, evergreen; draft, published; brief numbers) are part of the design, not incidental labels.

The site also argues by doing. It exposes MCP endpoints, agent-readable markdown URLs, and a RAG-powered chat interface as first-class surfaces. Design decisions on those surfaces are held to the same standard as the typography.

**Key Characteristics:**
- Typography-led: Fraunces at optical scale is the primary design element on every long-form page
- Near-monochromatic: forest green is the only saturated color; it appears sparingly
- Three-register type system: display serif (ideas), UI sans (interface), system mono (metadata)
- Flat by default: depth via tonal layering (warm-ash over ash-paper), not shadow
- States as design: content maturity labels, brief numbers, and the Now page are aesthetic choices, not tooling artifacts
- Demonstrates its subject: agent-readable endpoints and MCP tools are treated with the same design rigor as the writing pages

## 2. Colors: The Ash-and-Forest Palette

A near-monochromatic warm-neutral field with one saturated accent. The field does the reading work; the accent does the pointing.

### Primary
- **Quiet Forest** (`#2d5d4f`): The sole saturated color. Active nav state, links, section labels, focus rings, accent moments in type. Used at a density of roughly one appearance per screenful. Its rarity is the argument.
- **Forest Mist** (`#cfdcd6`): Muted accent; selected and active state backgrounds, focus rings (via `box-shadow`). Never used as a surface at scale.

### Neutral
- **Deep Ink** (`#14181d`): Primary text. Not black: the cool-neutral tint toward the forest hue keeps it from reading as harsh.
- **Settled Ink** (`#3d444d`): Secondary text, nav labels, subheadings, descriptive copy. The workhorse reading color.
- **Receding Ink** (`#828a93`): Metadata, timestamps, captions, faint labels. Everything that should fade without disappearing.
- **Ash Paper** (`#f1f2f0`): Page background. Warm-leaning off-white; never pure white.
- **Warm Ash** (`#e6e8e4`): Secondary surface. Card backgrounds, code blocks, diagram containers, warm-section fills. The primary tool for tonal depth.
- **Ash Rule** (`#cbcec9`): Borders and dividers. Used at 1px; this weight is not exceeded for decorative purposes.

*Dark mode mirrors the same roles with inverted lightness: ink tokens lighten, paper tokens darken, accent lightens to `#6fb39f` to maintain contrast.*

**The One Note Rule.** Quiet Forest appears on one element at a time. It is a highlighter, not a paint bucket. If it appears on a link AND a label AND an icon in the same viewport, one of those uses is wrong.

## 3. Typography

**Display Font:** Fraunces (variable: opsz 9–144, wght 300–600, SOFT axis 0–100) with Iowan Old Style, Apple Garamond, Georgia as fallbacks.
**Body/UI Font:** Inter with system-ui fallback stack.
**Mono Font:** JetBrains Mono with ui-monospace fallback stack.

**Character:** Fraunces is the editorial voice: optically sized, weightlessly elegant at headline scale, readable as body on long-form writing pages. Inter is the functional voice: neutral, precise, never decorative. JetBrains Mono is the system voice: present only when the interface is speaking about itself (timestamps, labels, code, section markers).

### Hierarchy

- **Hero** (wght 350, clamp(44px, 6.8vw, 78px), opsz 120, SOFT 50, lh 1.02): Fraunces. Home page headline, maximum one per page. The SOFT axis rounds the serifs at this size; always set it.
- **Display / h1** (wght 400, clamp(40px, 5.5vw, 60px), opsz 120–144, lh 1.05–1.08, ls -0.022–0.025em): Fraunces. Essay and brief page titles. opsz should match render size; 120 for brief titles, 144 for essay titles at largest.
- **Title / h2** (wght 450, 28–30px, lh 1.2, ls -0.012–0.015em): Fraunces. Section headings within long-form pages. Section labels above use the eyebrow style, not this.
- **Subhead / h3** (wght 450, 22–25px, lh 1.2, ls -0.012em): Fraunces. Essay subheadings, listing item titles.
- **Body** (wght 400, 16–16.5px Inter, lh 1.6–1.65, max 64–75ch): UI and short-form reading. Essay body uses Fraunces at 18.5px with opsz 14 for the optical texture of long-form reading.
- **Lede** (wght 400, 18–19px Inter, lh 1.5–1.55): Introduction paragraphs and subheadline decks. Also expressed in Fraunces italic at 22px for essay decks.
- **Eyebrow / Label** (wght 500–600, 11px JetBrains Mono, uppercase, ls 0.06em): Section markers (§ 01 — CONTEXT), timestamps, content-state badges, all metadata. Always mono. Always uppercase.
- **Meta** (wght 500, 12px Inter, ls 0.03–0.05em): Navigation, captions, UI chrome.

**The Optical Sizing Rule.** Fraunces must always carry a `font-variation-settings` value that includes `"opsz"` tuned to its render size. Hero text at opsz 120 reads differently from the same weight at opsz 14. A Fraunces element without explicit opsz is a mistake, not a default.

**The Three Voices Rule.** Fraunces speaks for ideas. Inter speaks for interface. JetBrains Mono speaks for the system. A section label is always mono; a headline is always Fraunces; a button label is always Inter. They cross only when register demands it (essay body text is Fraunces; essay metadata is mono). Do not mix within a single semantic role.

## 4. Elevation

The system is flat by default. Depth is communicated through tonal layering (warm-ash surfaces over ash-paper backgrounds) and border weight (1px ash-rule), not shadow. A page at rest has no shadows.

### Shadow Vocabulary

- **Hover lift** (`0 6px 24px -12px rgba(20,24,29,0.18)` with `translateY(-2px)`): Applied to note cards and interactive list items on hover. Signals "this can be clicked." Never at rest; always paired with a translateY.
- **Focus ring** (`0 0 0 3px #cfdcd6`): Keyboard focus indicator on inputs and interactive elements. Uses forest-mist, not a generic blue. Always visible; never suppressed.

**The Flat-By-Default Rule.** A surface that is not being interacted with has no shadow. Shadows exist only as a response to hover or focus, never as ambient decoration. If a card looks more "designed" because of its shadow, the shadow is wrong.

## 5. Components

### Navigation

The site mark (logo) is a small circle glyph (28px, 1px forest accent border) alongside a Fraunces weight-500 wordmark. Nav items are Inter 13px weight-500, displayed as pill-shaped items (99px radius) with transparent backgrounds at rest. On hover: accent text color, warm-ash background. On active: quiet-forest text, forest-mist background. The nav is low-contrast by design; it recedes behind the content it serves.

### Essay / Brief list items

Row layout: a 60px-wide column for a timestamp or number stamp (mono, 10px, uppercase), a flex content column for the title and dek, and a trailing metadata column. Title: Fraunces 25px wght 450 ls -0.012em. Dek: Inter 15px ink-soft max 64ch. Hover state: warm-ash background on the row with a slight negative margin bleed to the container edge (not a card; the hover is the card).

### Note cards

Border: 1px ash-rule. Radius: 4px. Background: warm-ash. Padding: 20px 22px. Body text: Inter 14.5px lh 1.55. State badge (seedling/budding/evergreen): 10px mono, 1px rule border, 3px 9px padding, 99px radius. Evergreen state uses quiet-forest text and forest-mist background. Hover: border shifts to quiet-forest, `translateY(-2px)`, ambient shadow.

### Chat input

Full-width input row: 1px ash-rule border, 4px radius. Focus-within: border shifts to quiet-forest, forest-mist box-shadow ring (3px). Input: Inter 15px, 14px vertical padding. Submit button: quiet-forest background, ash-paper text, border-radius 0 3px 3px 0 (right side only). Hover on submit: ink background. The probe suggestion buttons (pre-conversation prompts): transparent background, rule border, 4px radius; hover shifts border and text to accent, adds translateY(-1px).

### Brief bar

Four-column metadata grid. Each cell: an 11px mono uppercase label in receding-ink, and a 16px Fraunces wght-450 value. The pillar cell uses quiet-forest for the value text. The grid collapses to two columns below 720px.

### Endpoint cards (agent page)

Border: 1px ash-rule. Radius: 4px. Top accent bar: `::before` pseudo-element, 2px quiet-forest, full width, absolute positioned at the top. The bar is structural — it identifies the card type — not decoration. Background: ash-paper (light) / paper-warm (dark).

### Buttons

- **Primary** (send, submit): quiet-forest background, ash-paper text, 3–4px radius, Inter 13px wght 500. Hover: deep-ink background.
- **Ghost / secondary**: transparent background, rule border, current text color. Hover: accent border and text, warm-ash background, translateY(-1px).

## 6. Do's and Don'ts

### Do:
- **Do** set `font-variation-settings: "opsz"` on every Fraunces element, tuned to the rendered size (hero: 120, essay body: 14, brief headline: 120, display: 144).
- **Do** use warm-ash as the alternative surface for all card, sidebar, and inset contexts rather than introducing new background colors.
- **Do** treat the system state labels (seedling/budding/evergreen, brief numbers, the Now page) as design elements — they should be visible and styled, not hidden or minimized.
- **Do** keep quiet-forest to one prominent use per viewport. Its rarity is the signal.
- **Do** express hover and focus through translateY and border-color shifts before reaching for shadows or color floods.
- **Do** cap body line length at 64–75ch on all reading surfaces.
- **Do** style the agent-readable endpoints and MCP surfaces with the same typographic care as writing pages; they are part of the argument the site makes.

### Don't:
- **Don't** use `background-clip: text` with a gradient. Single solid color only; use weight or size for emphasis.
- **Don't** use glassmorphism, backdrop-filter blurs, or translucent cards for decoration. The system is opaque and tonal.
- **Don't** use neon accents, dark-mode purple or blue glow effects, or the AI startup visual vocabulary. The site thinks clearly about AI; it does not perform proximity to it.
- **Don't** build a generic portfolio template: no headshot hero, no tech-stack badge grid, no project thumbnail card grid, no "About me" with a bullet credential list.
- **Don't** use SaaS landing page patterns: no gradient hero, no big-number metric with glowing accent, no feature icon-heading-text card grid, no sticky CTA.
- **Don't** use `border-left` or `border-right` greater than 1px as a colored decorative stripe on cards or list items. The metric-row component uses a 2px left border as a data affordance, not decoration; don't generalize it.
- **Don't** animate layout properties (width, height, padding, margin). Animate only transform and opacity.
- **Don't** render Fraunces without an opsz value. A missing opsz is not a neutral default; it renders at opsz 14 regardless of size, which is visibly wrong at display scale.
- **Don't** place accent color on more than one element simultaneously in the same viewport. If the nav is active-forest AND a link is forest AND a label is forest, one of those uses is wrong.

## 7. Responsive Behavior

Single breakpoint: `720px`. Below it, multi-column layouts collapse to single column; font sizes scale via `clamp()` already baked into the type scale. No horizontal scrolling; no viewport-specific display rules beyond this threshold.

- Below 720px: Brief bar collapses from four to two columns.
- Below 720px: Note grids collapse to a single column.
- Content containers remain centered at all viewport widths.
- Navigation condenses but retains the pill-shaped item treatment.

## 8. Agent Prompt Guide

Pre-written single-sentence constraints encoding the highest-stakes rules. Use these verbatim when generating or reviewing UI for this site:

- "Use Quiet Forest (`#2d5d4f`) on at most one element per viewport — its rarity is the signal."
- "Every Fraunces element must carry `font-variation-settings: 'opsz' <n>` where n matches the render size. A Fraunces element without explicit opsz is a visual mistake."
- "Depth is tonal (warm-ash `#e6e8e4` over ash-paper `#f1f2f0`), not shadowed. A surface at rest has no box-shadow."
- "JetBrains Mono for timestamps, section labels, badges, and code. Fraunces for ideas. Inter for interface. They do not cross roles."
- "Hover states use `translateY(-2px)` and a border-color shift to `#2d5d4f`. Shadows appear only at hover or focus, never at rest."
- "No pure white (#ffffff) backgrounds. No pure black text. No gradient fills. No glassmorphism."
- "This is not a portfolio: no headshot hero, no tech-stack badge grid, no three-up feature card layout, no sticky CTA banner."
