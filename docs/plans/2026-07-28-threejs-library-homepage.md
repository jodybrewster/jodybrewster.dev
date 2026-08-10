# Three.js Library Homepage Implementation Plan

> **For agentic workers:** Use subagent-driven-development (recommended) or inline execution with checkpoints to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current homepage with an accessible, responsive Three.js shelf containing the rolling 25-album Spotify snapshot and all 89 supplied books.

**Architecture:** Astro renders a complete semantic shelf and serializes normalized media data into the page. A focused Three.js controller progressively enhances that shell with procedural shelves, cover-textured media meshes, raycast selection, restrained parallax, and synchronized DOM state. Local cover caching and deterministic fallbacks keep the scene reliable when external images fail.

**Tech Stack:** Astro 5, TypeScript, Three.js, Vitest, existing JSON content pipeline, CSS.

---

## File Map

- `src/lib/shelf/media.ts`: media types, validation, stable IDs, month labels, and deterministic fallback colors.
- `src/lib/shelf/media.test.ts`: unit coverage for normalization and malformed records.
- `src/lib/shelf/scene.ts`: Three.js renderer, procedural shelf geometry, textures, raycasting, parallax, responsive camera, and cleanup.
- `src/lib/shelf/scene-state.ts`: framework-free active/hover state transitions shared by canvas and DOM.
- `src/lib/shelf/scene-state.test.ts`: state transition tests.
- `src/components/LibraryShelf.astro`: semantic shelf, canvas mount, selected card, and hydration payload.
- `src/pages/index.astro`: replacement homepage composition and data loading.
- `src/styles/shelf.css`: full-bleed shelf styling, mobile rails, fallback state, and reduced motion.
- `content/reading.json`: complete 89-book curated library.
- `scripts/sync-book-covers.ts`: idempotent Open Library metadata and local cover cache sync.
- `public/media/books/`: locally cached cover images when available.
- `package.json` and `package-lock.json`: Three.js, Vitest, and sync/test commands.

### Task 1: Testing Foundation and Media Normalization

**Files:**
- Create: `src/lib/shelf/media.test.ts`
- Create: `src/lib/shelf/media.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Add the runtime and test dependencies**

Run: `npm install three && npm install -D @types/three vitest`

Add scripts:

```json
"test": "vitest run",
"test:watch": "vitest",
"books": "tsx scripts/sync-book-covers.ts"
```

- [ ] **Step 2: Write failing normalization tests**

Cover these exact behaviors: stable slug IDs, invalid records removed individually, duplicate book editions remain distinct through an edition suffix, `updated: 2026-07-28` formats as `July 2026`, and the same title always returns the same fallback color.

```ts
import { describe, expect, it } from 'vitest';
import { fallbackColor, monthLabel, normalizeBooks } from './media';

describe('normalizeBooks', () => {
  it('keeps valid editions distinct and drops malformed rows', () => {
    const books = normalizeBooks([
      { title: 'The Design of Everyday Things', author: 'Don Norman', edition: 'revised' },
      { title: 'The Design of Everyday Things', author: 'Donald A. Norman', edition: 'original' },
      { title: '', author: 'Nobody' },
    ]);
    expect(books.map(book => book.id)).toEqual([
      'book-the-design-of-everyday-things-revised',
      'book-the-design-of-everyday-things-original',
    ]);
  });
});

it('formats the snapshot month', () => {
  expect(monthLabel('2026-07-28')).toBe('July 2026');
});

it('chooses deterministic fallback colors', () => {
  expect(fallbackColor('Atomic Habits')).toBe(fallbackColor('Atomic Habits'));
});
```

- [ ] **Step 3: Run tests and verify failure**

Run: `npm test -- src/lib/shelf/media.test.ts`
Expected: FAIL because `./media` does not exist.

- [ ] **Step 4: Implement typed normalization**

Define `ShelfBook`, `ShelfAlbum`, `RawBook`, `RawAlbum`, `normalizeBooks`, `normalizeAlbums`, `monthLabel`, and `fallbackColor`. Normalize only non-empty title/author records, create URL-safe stable IDs, preserve input order, and never throw for a bad row.

- [ ] **Step 5: Run the focused tests**

Run: `npm test -- src/lib/shelf/media.test.ts`
Expected: PASS.

### Task 2: Complete Curated Book Data and Cover Sync

**Files:**
- Modify: `content/reading.json`
- Create: `scripts/sync-book-covers.ts`
- Create: `public/media/books/.gitkeep`

- [ ] **Step 1: Expand the curated data to all 89 supplied books**

Use this schema for every entry and preserve the user's supplied order:

```json
{
  "title": "Grokking Simplicity",
  "author": "Eric Normand",
  "edition": "",
  "url": "",
  "image": ""
}
```

Give the revised and original *Design of Everyday Things* records explicit `edition` values.

- [ ] **Step 2: Implement idempotent cover resolution**

For rows without a URL or image, query `https://openlibrary.org/search.json?title=<title>&author=<author>&limit=5`, select the first result with a cover ID, download `https://covers.openlibrary.org/b/id/<cover_i>-L.jpg` to `public/media/books/<stable-id>.jpg`, and write the local path plus canonical Open Library work URL back to the same row. Keep existing values unchanged and continue after per-book failures.

- [ ] **Step 3: Run the sync and validate the count**

Run: `npm run books`
Expected: command exits 0, `content/reading.json` still contains exactly 89 books, and unresolved covers remain valid empty strings.

### Task 3: Scene State and Three.js Controller

**Files:**
- Create: `src/lib/shelf/scene-state.test.ts`
- Create: `src/lib/shelf/scene-state.ts`
- Create: `src/lib/shelf/scene.ts`

- [ ] **Step 1: Write failing state tests**

```ts
import { describe, expect, it } from 'vitest';
import { createSceneState } from './scene-state';

describe('scene state', () => {
  it('toggles selection and clears on Escape', () => {
    const state = createSceneState();
    state.select('book-atomic-habits');
    expect(state.selected()).toBe('book-atomic-habits');
    state.select('book-atomic-habits');
    expect(state.selected()).toBeNull();
    state.select('album-bloom');
    state.clear();
    expect(state.selected()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm test -- src/lib/shelf/scene-state.test.ts`
Expected: FAIL because `./scene-state` does not exist.

- [ ] **Step 3: Implement scene state**

Expose `hover(id | null)`, `select(id)`, `clear()`, `hovered()`, `selected()`, and `subscribe(listener)`. Emit only when state actually changes.

- [ ] **Step 4: Implement the scene controller**

Export `mountLibraryScene({ canvas, albums, books, reducedMotion, onSelection })` returning `{ focus(id), select(id), clear(), destroy() }`. Build three pale-birch shelf boards, jewel-case boxes with album cover maps, variable-size book boxes with cover maps or deterministic cloth materials, a perspective camera locked to the frontal composition, two soft area/directional lights, pointer raycasting, and damped forward movement for hovered/selected meshes. Cap pixel ratio at 1.75, pause on hidden documents, resize with `ResizeObserver`, and dispose textures, materials, geometry, observers, and listeners in `destroy()`.

- [ ] **Step 5: Run state tests and type-check**

Run: `npm test -- src/lib/shelf/scene-state.test.ts && npx astro check`
Expected: PASS with no TypeScript errors.

### Task 4: Semantic Shelf Component

**Files:**
- Create: `src/components/LibraryShelf.astro`
- Create: `src/styles/shelf.css`

- [ ] **Step 1: Render the complete non-JavaScript shelf**

The component receives normalized albums, books, and a month label. Render a `nav` with Work, Writing, Lab, and About; a `section` for albums; two ordered book shelf lists; buttons carrying `data-media-id`; a polite live region for selection; and ordinary external anchors inside the selected card.

- [ ] **Step 2: Add progressive scene hydration**

Embed JSON with `set:html={JSON.stringify(data).replace(/</g, '\\u003c')}`. In a module script, dynamically import `../lib/shelf/scene`, mount it only when WebGL and minimum viewport capability checks pass, synchronize pointer/keyboard DOM controls with the scene, clear on Escape, and set `data-scene-ready` only after successful initialization.

- [ ] **Step 3: Add shelf styling and fallbacks**

Make the static shell visible immediately, use pale birch rails and ash-paper backgrounds, show cover art in real aspect ratios, align labels like physical shelf plaques, and fade the fallback media only after `data-scene-ready`. Under 720px use horizontal snap rails and keep the DOM covers visible. Under reduced motion remove transforms and transitions.

### Task 5: Replace the Homepage

**Files:**
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Replace the current listing homepage with the shelf page**

Read `content/listening.json` and `content/reading.json`, normalize them through `media.ts`, compute the month label, and render `LibraryShelf` inside a shelf-specific full-width layout. Keep the existing page title, description, structured data, and links to all existing top-level content.

- [ ] **Step 2: Keep non-home routes unchanged**

Ensure the shelf stylesheet is component-scoped or imported only from the homepage component. Do not alter the existing Base layout, global tokens, work pages, writing pages, lab notes, now page, agent page, or APIs.

### Task 6: Verification and Visual Review

**Files:**
- Modify only files implicated by failures.

- [ ] **Step 1: Run automated verification**

Run: `npm test && npm run build`
Expected: all tests pass and Astro completes a static production build.

- [ ] **Step 2: Run the site and inspect desktop behavior**

Run: `npm run dev -- --host 127.0.0.1`
Verify at 1440×900: three shelf levels visible, correct labels, current album textures, book count 89, hover pull-forward, click card, Escape clear, and working navigation.

- [ ] **Step 3: Inspect mobile and fallback behavior**

Verify at 390×844: navigation remains reachable, shelf rails drag horizontally, tap selection works, text does not overflow, and the page is usable with WebGL disabled and with reduced motion enabled.

- [ ] **Step 4: Confirm bundle isolation and repository state**

Run: `rg -n 'three' dist/_astro` and inspect generated chunks.
Expected: Three.js is loaded from the homepage scene chunk and existing content routes build successfully. Run `git diff --check` and confirm only scoped implementation files are modified.
