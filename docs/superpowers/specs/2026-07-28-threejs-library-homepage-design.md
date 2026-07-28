# Three.js Library Homepage Design

## Goal

Redesign the `jodybrewster.dev` homepage as a tactile, photographed-looking shelving unit inspired by the direct spatial interaction of Dynamicland's front shelf while remaining visually and technically original to Jody's site.

The shelf is the homepage navigation and the primary expression of Jody's current interests.
It contains a monthly music shelf driven by Spotify data and a long-term library containing all 89 supplied books.

## Approved Direction

The homepage uses a hybrid Three.js and semantic DOM architecture.
Three.js renders the shelves, media objects, lighting, depth, and interaction motion.
Astro-rendered HTML provides navigation, readable labels, selection details, keyboard controls, metadata, SEO, and a no-WebGL fallback.

The current Work, Writing, Lab, About, and supporting content pages remain intact.
The shelf replaces the current homepage presentation and links into those existing sections.

## Visual Design

The scene fills the browser viewport with three straight-on pale birch shelf levels.
It feels like an editorial interior photograph rather than a game or abstract 3D demo.
Natural wood grain, warm cream surroundings, soft window-like lighting, paper texture, glossy jewel cases, and imperfect media spacing supply realism.

The top rail carries `JODY BREWSTER` and the primary links `WORK`, `WRITING`, `LAB`, and `ABOUT`.
The upper media shelf is labeled `LISTENING · <MONTH YEAR>` and presents the 25 albums in the current rolling monthly snapshot.
The lower shelves are labeled `LIBRARY · 89 BOOKS` and contain the supplied Audible library.
Book dimensions, colors, and slight rotations vary so the collection reads as physical without becoming untidy.

The site's existing ash paper, deep ink, and quiet forest green remain the interface palette.
Album art and book jackets provide most of the saturated color.
Physical-looking labels and cards replace floating glass panels or conventional web cards.

## Interaction

Pointer movement produces restrained camera parallax rather than free camera orbiting.
The user cannot rotate behind the shelf or lose the intended composition.

Hovering or focusing a book or album moves it a short distance forward and slightly brightens its local lighting.
Only one item can be active at a time.
Selecting an album opens a physical information card with title, artist, and a Spotify link.
Selecting a book opens a forest-green information card with title, author, and its external catalog link.
Pressing Escape, activating the selected item again, or selecting another item closes or replaces the card.

Navigation labels behave as ordinary links.
Desktop users can scroll vertically if the complete shelf exceeds the viewport.
Touch users drag shelf rows horizontally and tap objects to select them.

## Architecture

### `LibraryScene`

A client-side Three.js controller owns the renderer, scene, camera, lights, raycasting, responsive sizing, pointer parallax, and animation loop.
It exposes selection changes as DOM custom events and accepts focus or selection commands from the semantic overlay.

### `ShelfBuilder`

Procedural geometry builds the birch frame, shelves, jewel cases, books, labels, and cards from data.
Simple box geometry and carefully tuned materials are preferred over a large downloaded 3D model so the page remains maintainable and responsive.
Instanced or shared geometries and materials are used where practical.

### `MediaTextures`

Album cover images already supplied by the Spotify cache become jewel-case textures.
Book cover images are resolved and cached locally at build time.
The runtime does not depend on cross-origin texture loading.
Missing covers fall back to deterministic cloth covers generated from title, author, and a restrained palette.

### `ShelfOverlay`

Astro emits semantic navigation, shelf headings, buttons for every media item, a live selection region, and descriptive fallback lists.
Overlay controls are visually aligned to the 3D scene on large screens but remain normal document content for assistive technology and fallback rendering.

### Data Modules

`content/listening.json` remains the source for the rolling monthly music snapshot.
Its existing `updated`, album title, artist, URL, and image fields are sufficient.

The book library moves into a complete structured JSON file with title, author, catalog URL, cover image path, and stable slug for all 89 supplied books.
Duplicate editions of *The Design of Everyday Things* remain distinct records.

## Data Flow

Astro reads both JSON sources at build time and passes normalized, serializable media data to the client scene.
The scene creates geometry in display order and attaches each mesh to a stable media ID.
Raycasting maps pointer interactions back to that ID.
DOM focus and click events use the same ID, keeping canvas and semantic controls synchronized.

The Spotify prebuild sync refreshes `content/listening.json` as it does today.
A separate idempotent book-cover sync command updates missing metadata and cached cover files without changing curated book order.

## Responsive and Accessible Behavior

Every interactive mesh has a corresponding semantic button or anchor with an accessible name.
Keyboard users move through items in shelf order and see the same selected state as pointer users.
The live selection card is announced without moving focus unexpectedly.
Focus indicators use the existing forest-mist token.

With `prefers-reduced-motion`, items change state without spring movement, camera parallax is disabled, and scene transitions become immediate.
If WebGL is unavailable, JavaScript fails, or the device is under the performance threshold, the semantic shelf view remains fully usable with real cover images and the same links.

On narrow screens, the header becomes a compact sticky strip.
Each shelf row becomes a horizontally scrollable media rail with snap points while retaining the physical shelf framing.

## Performance

Three.js loads only on the homepage and only after the static shelf shell is visible.
The renderer caps device pixel ratio, pauses when the page is hidden, and renders on demand once motion settles.
Textures use locally cached, appropriately sized WebP or JPEG assets with a fixed maximum dimension.
Geometry and materials are shared, and decorative objects remain deliberately sparse.

The first static HTML paint must not wait for Three.js.
The initial homepage remains navigable before scene hydration completes.

## Error Handling

Texture failures use generated fallback covers without removing the media item.
Malformed media records are skipped individually and reported in development rather than breaking the scene.
Renderer initialization failure leaves the semantic shelf visible and records a non-blocking console warning.
External Spotify and catalog links remain ordinary anchors and do not depend on Three.js state.

## Verification

Unit tests cover media normalization, stable IDs, deterministic fallback cover selection, and malformed records.
Browser tests cover pointer selection, keyboard selection, Escape behavior, navigation links, reduced motion, WebGL fallback, and mobile shelf scrolling.
Visual checks compare desktop and mobile screenshots against the approved warm birch mockup for composition, label legibility, selected state, and overflow.
Performance verification checks that Three.js is absent from non-homepage bundles and that the static fallback appears before hydration.

## Initial Implementation Scope

The first implementation delivers the replacement homepage, all 25 current albums, all 89 book records, real cover textures where reliably resolved, selection cards, desktop and mobile layouts, and accessible fallback behavior.
Free camera controls, physics, audio playback, user accounts, filtering, search, and per-book notes authoring are outside this initial scope.
The book card may link to an external catalog now and can gain Jody-authored notes later without changing the scene interface.
