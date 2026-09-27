# Reference interior pages

## Scope

Implement the supplied Work, case-study, About, Writing / Research, and Verso examples. Preserve the completed homepage composition. Apply the user's follow-up requests: permanent dark styling, Library access below the About hero actions, the original Three.js shelf, thin modern headlines, and the supplied layered-glass brand mark.

## Implementation

- Shared Studio layout, palette, navigation, controls, reading-page styling, and responsive containers.
- Work index with six source-backed projects and working category filters; three detailed case-study pages with preserved content and architecture summaries.
- About portrait, introduction, principles, career highlights from the résumé, contact links, and Library entry beneath the primary actions.
- Combined published Writing / Research cards, category + text filtering, empty-state reset, and research disclosure.
- Verso sidebar and embedded persistent chat; prompt drafting, name gate, and underlying API unchanged.
- Dark theme fixed in Base HTML, theme controls removed, no About header submenu.
- Barlow Semi Condensed 300/400 for major headlines; existing body/UI type retained.
- Shared layered-glass image mark and favicon, supplied by the user.

## Asset provenance

The existing homepage portrait was reused for About. The office-only image was generated as an edit of that portrait: remove the person/chair and website UI, retain the blue evening city view, warm desk lights, monitors, and dark left side for live text.

Three generated landscape illustrations use these art directions: (1) blue alpine observatory above a lake at dusk, systems/research; (2) warm workshop and suspension bridge over a mountain valley at sunset, building; (3) purple mountain basin and distant traveler at twilight, exploration. All are landscape scenes without embedded words, interface elements, logos, or watermarks. Optimized assets live in `public/images/studio/`.

Research cards now use eleven dedicated, generated editorial illustrations matched to their slugs: design skill comparison, diverge/converge workflows, Snowflake learning charts, instruction-card patterns, agentic stack architecture, the Eve framework, technical writing quality control, codebase audit scanning, design-engineering portfolios, conversational AI evaluation, and connected knowledge files. Each scene was generated without embedded words, interface elements, logos, or watermarks and optimized to WebP in `public/images/research/`.

The Jev article uses a separate generated illustration of a typed-decision calibration station with geometric choice tokens and confidence signals, saved as `public/images/research/jev-structured-model.webp`.

The layered-glass brand artwork is the user's unmodified supplied PNG, preserved in `public/images/brand/layered-mark.png`. WebP and favicon variants only resize / re-encode it for browser use.

## Verification

- `npx astro check`: 81 files, 0 errors, 0 warnings, 10 existing hints.
- `npm test`: all 138 existing tests across 7 files pass.
- Production Astro build and Pagefind index complete. The existing Three.js bundle-size warning remains.
- Work / Writing filters, combined search, zero-result state, and reset verified in the browser. Maps / GIS shows Lennar alone; AI + Snowflake shows one article; reset restores all 11 published entries.
- About, Work, Writing / Research, case details, Home, and Verso inspected at desktop and phone sizes. The larger header fits at 1100px, and phone layouts have no horizontal overflow.
- Browser confirms Barlow Semi Condensed loads at weight 300 for the main headlines; the supplied logo and favicon assets return successfully.
- About contains the Library link beneath its résumé / contact actions and no header submenu. The Three.js scene renders at both 1440px and 390px; the existing scene code was preserved. Stale local dev transforms were cleared by restarting Astro.
- A stored light-theme preference is ignored; dark persists after navigation and no theme toggle is rendered.
- Verso prompt drafting, input focus, and one persisted dock verified across embedded chat → Work → embedded chat. The same DOM node and draft survive both transitions. No live chat requests or handoff messages were sent.
- Lennar renders four architecture steps and preserves the four sections of the original brief. Markdown links and real screenshot links remain available.
- `git diff --check` passes.

Browser screenshots are kept under `/tmp/` for review; the development preview remains at http://localhost:4321/.
