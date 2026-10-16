# The /library room

A Three.js room at `/library`, linked from the main menu, where Jody's experiences and taste float on a shallow arc in front of a sunset, a page at a time.
It is a Studio page, so the home nav, the Verso dock and the footer are the site's own.
The filter column and `?show=<kind>` choose what is shown, Books by default; the pager above the Verso bar turns pages.
The site's own writing and case studies are deliberately not here: they live under Writing and Work.

| Filter | Object | Source |
|---|---|---|
| Books (`book`) | book | `content/library.json`, `npm run books` |
| Music (`album`) | jewel case | `content/listening.json`, `npm run spotify` |
| Films (`film`) | video store box with the poster | `content/films.json`, by hand: `title`, `year`, `coverSource` (the Wikipedia file page of the poster), then `npm run films` |
| Podcasts (`podcast`) | cassette | `content/podcasts.json`, by hand |
| Games (`game`) | game case | `content/games.json`, `npm run games` |
| Tools (`tool`) | 3.5 inch disk | `content/tools.json`, by hand: `title`, `maker`, `note`, `url` |
| Experiences (`place`) | postcard | `content/places.json`, by hand: `title`, `location`, `year`, `note` (written on the back), `scene` (what `npm run postcards` paints) and `photo` (site-absolute, under `public/media/places/`; the generated fronts are made-up illustrations, and Jody's own photo replaces one by setting `photo` to it) |

Rows marked `"sample": true` are placeholders and say so on their card; replace them before merging.

- `src/lib/shelf/payload.ts` builds the data from the content files above.
- `src/lib/shelf/media.ts` normalizes every source into `ShelfItem`s with stable ids. Pure, never throws, drops bad rows individually.
- `src/lib/shelf/arc.ts` is the pure layout: the filters, pagination, the pager's numbers and the arc pose.
- `src/lib/shelf/scene-state.ts` holds hover/active selection. Canvas and DOM dispatch into the same store, which is what keeps them in sync.
- `src/lib/shelf/textures.ts` draws spines, game cases, disks, tapes, cassettes and postcards on canvas, with labels in the site's script face. Real jackets, album art, box art and postcard photos come from files and are redrawn no larger than 640px. `fontsReady()` loads each face by name, because `document.fonts.ready` skips faces the page itself never used.
- `src/lib/shelf/scene.ts` owns the renderer, the backdrop, the objects, picking, paging and the flights.
- `src/components/LibraryShelf.astro` renders a complete, linked, image-bearing list in HTML, with the filter column working on it too. Three.js progressively enhances it; that markup is the whole experience without WebGL or scripts and for assistive tech.

The room is one image, `public/images/library/backdrop.webp`, made with gpt-image-2 from the design mock with its objects and interface removed.
It is drawn as a cover-fitted backdrop inside WebGL so the opening can grade it from pre-dawn to morning.
The floor is a `Reflector` that sees only the objects (the backdrop is hidden and the target cleared to transparent while it renders), so their reflections land on the plate's own wet floor.
The camera height and tilt are set so the plate's horizon and that floor agree at desktop proportions; moving the camera means checking the reflections again.

Motion: a page flies in from the right, leading edge first, and floats until something is picked.
A new filter or page sends the current one off to the left as the next arrives; going back runs the other way.
Arrow keys step the selection and turn the page when they run off it; PageUp and PageDown turn pages; a sideways swipe or trackpad gesture does too.
With reduced motion everything is placed instantly.

Game cases are drawn at their real proportions (a Switch case narrower than a PS5 one) in their plastic; only the cover art is a file.
`content/games.json` is kept by hand: title, platform, optional `note` (shown on the card), optional `url` to the game's official page, and `coverSource`, the Wikipedia file page the art comes from.
`npm run games` downloads each cover once into `public/media/games/` and writes `cover` back; the cached files are committed like the book jackets and nothing in the build fetches them.

Gotchas: art loads only for the page in view and the next one, and at most `FACE_BUDGET` faces are held at once, oldest released first; the opening waits on the plate and the first page's art (up to `ART_WAIT_MS`) so nothing flies in blank; a swipe must not also register as a click on whatever it ended over.
Pages are packed to `PAGE_FILL` of the lane because the arc's ends come forward and grow in perspective.
Automation browsers often report the tab hidden, which stops requestAnimationFrame and image decoding there; review the scene with headless Playwright instead.
Devices without WebGL still get the semantic list.
