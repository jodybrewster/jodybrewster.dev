# Reference homepage implementation plan

**Goal:** Restyle `/home` to follow the supplied portrait-led reference, with a working responsive page and real project links.

**Architecture:** A homepage variant of the existing Astro layout supplies a compact navigation, full-width photographic hero, experience strip, case-study cards, capability row, and a small set of links into the existing notebook. The existing Verso dock is opened by delegated buttons; its conversation, name gate, and persistence remain intact.

**Tech stack:** Astro 5, existing Plus Jakarta Sans and SVG sprite, plain CSS, existing chat client. No new dependencies.

- [x] Add an optimized office portrait background derived from the supplied reference.
- [x] Add homepage tokens to the prototype and extract them into a scoped stylesheet; document the requested design exception in DESIGN.md.
- [x] Build homepage navigation, hero, experience strip, linked case studies, and capability row.
- [x] Connect all Verso entry points to the existing chat with keyboard focus and Escape behavior.
- [x] Verify type checking, existing tests, production build, responsive rendering, navigation, theme switching, résumé, and chat opening.

## Design decisions

The supplied image supersedes the earlier homepage rules against a portrait and project cards. Use midnight navy, light blue secondary text, orange/cyan headline accents, bold Plus Jakarta Sans, restrained borders, and small rounded cards. Long-form pages retain their editorial typography. At phone sizes, stack the hero copy, chat introduction, projects, and capabilities; keep navigation behind a keyboard-accessible menu.

## Hero asset provenance

Built-in image-generation tool, identity-preserving edit of the user-provided screenshot. Prompt: remove all website UI and lower sections; reconstruct only the office photograph; preserve the man's face, hair, glasses, goatee, black shirt, pose and identity; wide 3:1 crop with the man at 66% and a dark left side for HTML text; blue evening Miami skyline, warm amber office lighting; no added text, UI, people, watermarks, or logos.

Optimized project assets: `public/images/home/jody-office.webp` and `jody-office-1080.webp`.

## Verification

- `npx astro check`: 0 errors, 0 warnings; 10 existing hints.
- `npm test`: all 138 tests across 7 files pass.
- Production Astro build and Pagefind indexing complete successfully. Existing Three.js library bundle-size warning remains.
- Browser inspections at 1536px, 1100px, 800px, 390px, and 320px; no horizontal overflow at the phone widths.
- Light/dark theme, mobile navigation and Escape focus, project links, résumé response, Verso open/close and prompt drafting checked.
- Chat draft and persisted dock survive navigation to a case study and back. Live chat requests were not sent.
- Hero assets total approximately 155KB.
