/**
 * The Three.js shelf.
 *
 * Owns the renderer, the procedural shelving unit, raycast picking, the
 * scroll-driven camera, and the spring that pulls a selected item off the shelf
 * and turns it to face the reader. Selection itself lives in the ShelfStore, so
 * the canvas and the semantic overlay always agree.
 *
 * Browser only. Nothing here runs during the Astro build.
 */

import {
  ACESFilmicToneMapping,
  BackSide,
  BoxGeometry,
  Color,
  DirectionalLight,
  Euler,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
// Postprocessing is pulled in after the first frame, so its parse cost and its
// shader compilation land once the shelf is already on screen. Types only here.
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import type { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import type { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { GameSystem, ShelfAlbum, ShelfBook, ShelfGame, ShelfItem } from './media';
import { seededUnit } from './media';
import type { ShelfStore } from './scene-state';
import {
  albumBackTexture,
  casePlastic,
  fallbackCoverTexture,
  fontsReady,
  gameCoverTexture,
  gameSpineTexture,
  loadCoverTexture,
  loadImage,
  pageEdgeTexture,
  plaqueTexture,
  sampleCoverPalette,
  spineTexture,
  wallpaperTexture,
  woodTexture,
} from './textures';
import type { SpinePalette } from './textures';

export interface ShelfPayload {
  albums: ShelfAlbum[];
  books: ShelfBook[];
  games: ShelfGame[];
  listeningLabel: string;
  libraryLabel: string;
  gamesLabel: string;
}

export interface LibrarySceneOptions {
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  scroller: HTMLElement;
  payload: ShelfPayload;
  store: ShelfStore;
  reducedMotion: boolean;
}

/* -- Proportions. One unit is roughly a third of a shelf's depth. ---------- */

const INTERIOR_WIDTH = 11.5;
const INTERIOR_DEPTH = 2.05;
const SIDE_THICKNESS = 0.42;
/** Shelf boards are the same stock as the uprights. */
const BOARD_THICKNESS = SIDE_THICKNESS;
const ROW_PAD = 0.22;
/** Eased edge on the timber. Nothing in the real world has a true 90 degree
 *  corner, and a sharp one never catches the highlight that says "solid". */
const EDGE_RADIUS = 0.022;
/** Solid band across the top of the unit, carrying the nameplate. */
const CROWN_HEIGHT = 1.0;

const ALBUM_SIZE = 1.2;
/** A real jewel case is 142mm across and 10mm deep, so depth is 0.07 of width. */
const ALBUM_CASE_DEPTH = ALBUM_SIZE * 0.07;
const ALBUM_ROW_HEIGHT = ALBUM_SIZE + 0.55;
const ALBUMS_PER_ROW = 9;

/** Game cases at real size against the jewel cases: a 142mm CD case is
 *  ALBUM_SIZE across, so this is one centimetre in world units. */
const CM = ALBUM_SIZE / 14.2;
const GAME_CASES: Record<GameSystem, { width: number; height: number; depth: number }> = {
  switch: { width: 10.5 * CM, height: 17 * CM, depth: 1.0 * CM },
  ps5: { width: 13.5 * CM, height: 17 * CM, depth: 1.4 * CM },
  other: { width: 13.5 * CM, height: 19 * CM, depth: 1.4 * CM },
};
/** Five cases spread to the full width stand too far apart to read as a set.
 *  Past this they close up rather than drift further apart. */
const GAME_SLOT_MAX = 1.75;
const GAME_ROW_HEIGHT = 1.92;
const BOOK_ROW_HEIGHT = 3.44;

/** Per-frame ceiling for drawing spine artwork. Comfortably inside a 60fps
 *  frame, so filling the shelf in never costs a dropped frame while scrolling. */
const SPINE_PAINT_BUDGET_MS = 6;

const CAMERA_FOV = 32;
/** How far an item slides out of the shelf under the pointer. Has to clear the
 *  board's front edge to read as picked out rather than just brightened. */
const HOVER_LIFT = 0.42;

/**
 * How each kind of thing presents itself when selected.
 *
 * `fill` is the share of viewport height the item's own height covers, so a
 * book at 1.15 deliberately runs off the bottom of the frame. `shiftX`/`shiftY`
 * are fractions of the framed size, and `tilt` is layered on top of the
 * orientation that turns the item's face toward the reader.
 */
const PRESENTATION = {
  album: {
    fill: 0.58,
    shiftX: -0.13,
    shiftY: 0,
    tilt: { x: 0.05, y: 0.12, z: 0.015 },
    // A jewel case is the one item with nothing to reveal by turning, so it
    // takes a full turn on the way in and lands facing the reader.
    spinTurns: 1,
  },
  book: {
    // Held close, turned to a three-quarter view so the spine reads alongside
    // the cover. It used to be framed at 1.15 with its tail running off the
    // bottom, which put the jacket in your face rather than in your hands.
    fill: 0.92,
    shiftX: -0.13,
    shiftY: 0,
    tilt: { x: 0.075, y: 0.52, z: 0.05 },
    spinTurns: 0,
  },
  game: {
    // Turned a little toward its spine, which carries the platform band and
    // the title, so the case reads as an object and not a flat picture.
    fill: 0.74,
    shiftX: -0.13,
    shiftY: 0,
    tilt: { x: 0.05, y: 0.34, z: 0.02 },
    spinTurns: 0,
  },
} as const;

/**
 * Ceiling on how far the width may push the camera back, as a multiple of the
 * distance the height asks for. Narrow viewports want a distance that grows
 * without limit to fit the unit across; this is where that stops being framing
 * and starts being a diagram of a bookcase.
 */
const MAX_WIDTH_FIT = 1.08;

/** Pixels of travel past which a pointer was panning, not picking. */
const DRAG_SLOP = 6;

const SETTLE_EPSILON = 0.0006;
/** Seconds for a selected item to unwind its entry spin. */
const SPIN_SECONDS = 0.9;
const Y_AXIS = new Vector3(0, 1, 0);

interface ItemView {
  id: string;
  item: ShelfItem;
  /** Pickable root. */
  object: Object3D;
  restPosition: Vector3;
  restQuaternion: Quaternion;
  /** Direction the item slides when hovered (out of the shelf). */
  hoverAxis: Vector3;
  /** Extra spin applied on top of the camera orientation when active. */
  activeSpin: Quaternion;
  /** Orientation the springs track. The entry spin is layered on top of this,
   *  because a quaternion cannot express a turn beyond half a revolution. */
  baseQuaternion: Quaternion;
  /** Full turns taken on the way in. */
  spinTurns: number;
  spinElapsed: number;
  /** The item's framed size, which the parking distance is worked out from. */
  closeUpSize: { width: number; height: number };
  /** Share of the frame that size should cover. */
  closeUpFill: number;
  /** Offsets when active, as fractions of the framed width and height. */
  closeUpShift: { x: number; y: number };
  /** Materials whose emissive is raised while hovered or active. */
  lit: MeshStandardMaterial[];
  /** Lazily swapped in when a book is opened up close. */
  coverMaterial?: MeshStandardMaterial;
  coverLoaded?: boolean;
  rowIndex: number;
}

function jitter(seed: string, min: number, max: number): number {
  return min + seededUnit(seed) * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Distance at which an object of `size` covers `fill` of the frame height. */
function closeUpDistance(size: number, fill: number): number {
  const vFov = (CAMERA_FOV * Math.PI) / 180;
  return size / (2 * Math.tan(vFov / 2) * fill);
}

export class LibraryScene {
  #renderer: WebGLRenderer;
  #scene = new Scene();
  #camera: PerspectiveCamera;
  #store: ShelfStore;
  #options: LibrarySceneOptions;

  #unit = new Group();
  #views = new Map<string, ItemView>();
  #pickable: Object3D[] = [];
  #animating = new Set<string>();

  #raycaster = new Raycaster();
  #pointer = new Vector2(0, 0);
  #pointerInside = false;
  #pointerDirty = false;

  #parallax = new Vector2(0, 0);
  #parallaxTarget = new Vector2(0, 0);

  #scrollProgress = 0;
  #cameraTopY = 0;
  #cameraBottomY = 0;
  #cameraDistance = 14;
  /** Sideways offset from dragging, and how far it is allowed to travel. */
  #panX = 0;
  #panLimitX = 0;
  #visibleHeight = 0;
  #unitHeight = 0;
  #rowBounds: Array<{ top: number; bottom: number; centre: number }> = [];

  #needsRender = true;
  #frame = 0;
  #disposed = false;
  #unsubscribe: () => void = () => {};
  #cleanup: Array<() => void> = [];
  #coverCache = new Map<string, Texture>();
  /** Everything needed to redraw a spine when its jacket colours arrive. */
  #spines = new Map<string, {
    book: ShelfBook;
    material: MeshStandardMaterial;
    aspect: number;
    palette?: SpinePalette;
  }>();
  /**
   * Books whose spine artwork has not been drawn yet. Drawing all 86 up front
   * costs about two thirds of the boot, and the result is thrown away twice
   * over anyway: once when the webfonts land and again as jacket colours are
   * sampled. They start as flat cloth and get their lettering in slices.
   */
  #pendingSpines = new Set<string>();
  #spinePaint = 0;
  /** Game case faces, redrawn when their box art or the webfonts land. */
  #gameFaces = new Map<string, {
    game: ShelfGame;
    front: MeshPhysicalMaterial;
    spine: MeshPhysicalMaterial;
    frontAspect: number;
    spineAspect: number;
    image?: HTMLImageElement | null;
  }>();

  #composer: EffectComposer | null = null;
  #gtao: GTAOPass | null = null;
  #lens: ShaderPass | null = null;
  #keyLight: DirectionalLight | null = null;
  #lastActive: string | null = null;
  #reduced: boolean;

  private constructor(options: LibrarySceneOptions, renderer: WebGLRenderer) {
    this.#options = options;
    this.#store = options.store;
    this.#renderer = renderer;
    this.#reduced = options.reducedMotion;
    this.#camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 120);
  }

  /**
   * Returns null when WebGL is unavailable, which leaves the semantic shelf as
   * the only view. Never throws at the call site.
   */
  static create(options: LibrarySceneOptions): LibraryScene | null {
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({
        canvas: options.canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch (error) {
      console.warn('[library] WebGL unavailable, keeping the semantic shelf.', error);
      return null;
    }

    const scene = new LibraryScene(options, renderer);
    try {
      scene.#build();
    } catch (error) {
      console.warn('[library] shelf build failed, keeping the semantic shelf.', error);
      scene.dispose();
      return null;
    }
    return scene;
  }

  /* ---------------------------------------------------------------------- */
  /* Build                                                                   */
  /* ---------------------------------------------------------------------- */

  #build(): void {
    const { payload } = this.#options;

    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.#renderer.setClearColor(new Color('#e9e3d6'), 1);
    this.#renderer.outputColorSpace = SRGBColorSpace;
    this.#renderer.toneMapping = ACESFilmicToneMapping;
    this.#renderer.toneMappingExposure = 0.88;
    this.#renderer.shadowMap.enabled = true;
    this.#renderer.shadowMap.type = PCFSoftShadowMap;

    this.#scene.add(this.#unit);
    this.#addLights();

    const rows = this.#planRows(payload);
    this.#buildFrame(rows);
    this.#fitShadowCamera();
    this.#buildRows(rows);

    this.#resize();
    this.#bindEvents();
    this.#unsubscribe = this.#store.subscribe(() => this.#onStateChange());

    // Paint the first frame here rather than waiting on the first animation
    // frame, so the shelf is on screen the moment the scene is ready.
    this.render();

    // Shelf is on screen. Everything from here fills in behind it: the spine
    // lettering, then the ambient occlusion once its shaders have compiled.
    this.#paintSpines();
    void this.#buildComposer().then(() => {
      if (this.#disposed) return;
      // The composer needs the current size, and the frame already on screen
      // was drawn without it.
      this.#resize();
      this.#invalidate();
    });

    // Text textures need the webfonts; redraw once they land.
    void fontsReady().then(() => {
      if (!this.#disposed) this.#refreshTextTextures();
      // Only after the shelf is painted and legible: restyle each spine to its
      // own jacket. Nothing depends on this finishing.
      void this.#adoptJacketColours();
    });

    this.#loop();
  }

  /**
   * Advances the item springs by `delta` seconds and draws. The rAF loop does
   * this every frame; exposing it lets tests drive the scene deterministically
   * instead of racing a real animation frame.
   */
  step(delta: number): void {
    this.#animateItems(delta);
    this.render();
  }

  /** Draws one frame immediately, camera first. The loop calls this only when
   *  something actually changed. */
  render(): void {
    if (this.#disposed) return;
    this.#needsRender = false;
    // Zero delta so this only resolves scroll position; it never advances the
    // parallax ease, which stays owned by the loop.
    this.#updateCamera(0);
    if (this.#composer) this.#composer.render();
    else this.#renderer.render(this.#scene, this.#camera);
  }

  /**
   * Ambient occlusion. Direct lights and an environment map still cannot darken
   * the crevice where a book meets its board, and that contact darkening is
   * most of what reads as global illumination. GTAO supplies it in screen
   * space. If the pass will not build, we fall back to rendering straight to
   * the canvas rather than losing the shelf.
   */
  async #buildComposer(): Promise<void> {
    try {
      const [
        { EffectComposer },
        { GTAOPass },
        { OutputPass },
        { RenderPass },
        { ShaderPass },
      ] = await Promise.all([
        import('three/examples/jsm/postprocessing/EffectComposer.js'),
        import('three/examples/jsm/postprocessing/GTAOPass.js'),
        import('three/examples/jsm/postprocessing/OutputPass.js'),
        import('three/examples/jsm/postprocessing/RenderPass.js'),
        import('three/examples/jsm/postprocessing/ShaderPass.js'),
      ]);
      if (this.#disposed) return;

      const composer = new EffectComposer(this.#renderer);
      composer.addPass(new RenderPass(this.#scene, this.#camera));

      const gtao = new GTAOPass(this.#scene, this.#camera, 1, 1);
      // Radius is world units: a book is ~0.3 thick and shelves are ~2 deep,
      // so this catches book-to-board and book-to-book contact without
      // smearing shadow across whole boards.
      // Radius has to match the cavity you want darkened. A shelf niche is
      // ~2 units deep, so a 0.4 radius only ever found hairline crevices and
      // left the whole niche as bright as the board fronts.
      gtao.updateGtaoMaterial({
        radius: 1.7,
        distanceExponent: 1.0,
        thickness: 1.4,
        scale: 1.25,
        samples: 16,
        screenSpaceRadius: false,
      });
      gtao.blendIntensity = 1;
      composer.addPass(gtao);

      // Applies the renderer's tone mapping and sRGB conversion at the end.
      composer.addPass(new OutputPass());

      // Nothing in the real world is evenly lit corner to corner or perfectly
      // clean. A little falloff and grain is most of the difference between
      // reading as a render and reading as a photograph.
      const lens = new ShaderPass({
        uniforms: {
          tDiffuse: { value: null },
          uVignette: { value: 0.38 },
          uGrain: { value: 0.035 },
          uShade: { value: 0.46 },
          uShadeSlide: { value: 0 },
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float uVignette;
          uniform float uGrain;
          uniform float uShade;
          uniform float uShadeSlide;
          varying vec2 vUv;
          void main() {
            vec4 colour = texture2D(tDiffuse, vUv);

            // Standing in for something out of frame across the window: the
            // light falls off along a diagonal, leaving the right of the unit
            // in shade. Slides with the scroll so it behaves like a cast
            // shadow rather than a mark on the lens.
            float edge = 0.35 + 0.30 * (vUv.y + uShadeSlide);
            float shade = smoothstep(edge - 0.26, edge + 0.26, vUv.x);
            colour.rgb *= 1.0 - shade * uShade;

            vec2 offset = vUv - 0.5;
            colour.rgb *= 1.0 - dot(offset, offset) * uVignette;
            float n = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
            colour.rgb += (n - 0.5) * uGrain;
            gl_FragColor = colour;
          }
        `,
      });
      composer.addPass(lens);
      this.#lens = lens;

      this.#composer = composer;
      this.#gtao = gtao;
      this.#cleanup.push(() => {
        gtao.dispose();
        composer.dispose();
      });
    } catch (error) {
      console.warn('[library] ambient occlusion unavailable, rendering directly.', error);
      this.#composer = null;
      this.#gtao = null;
    }
  }

  #addLights(): void {
    // Image-based lighting does most of the work. A hemisphere light plus a
    // couple of lamps cannot produce bounce, so surfaces facing away from the
    // key read as dead flat; an environment map gives every material light
    // from every direction, which is what reads as global illumination.
    this.#scene.environment = this.#buildEnvironment();
    this.#scene.environmentIntensity = 0.8;

    // One lamp remains, and it stays strong: the environment supplies bounce
    // and reflection, but without a dominant key the shelves lose the shadow
    // under each board that makes the niches read as deep.
    // Raking from the left, not head-on. A frontal key flattens everything it
    // touches; the angle is what gives the boards and spines form.
    const key = new DirectionalLight(0xffeccd, 2.15);
    key.position.set(-13, 9.5, 7.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 5;
    this.#scene.add(key);
    this.#scene.add(key.target);
    this.#keyLight = key;
  }

  /**
   * Sizes the shadow camera to the whole unit.
   *
   * A directional light's shadow frustum defaults to a 10x10 box. The shelf is
   * over 20 units tall, so everything outside the middle was silently getting
   * no cast shadow at all.
   */
  #fitShadowCamera(): void {
    const key = this.#keyLight;
    if (!key) return;

    const centre = -this.#unitHeight / 2;
    key.target.position.set(0, centre, 0);
    key.position.set(-13, centre + 11, 7.5);
    key.target.updateMatrixWorld();

    const reach = this.#unitHeight / 2 + 4;
    const shadow = key.shadow.camera;
    shadow.left = -reach;
    shadow.right = reach;
    shadow.top = reach;
    shadow.bottom = -reach;
    shadow.near = 0.5;
    shadow.far = 60;
    shadow.updateProjectionMatrix();
  }

  /**
   * A warm room, rendered once and prefiltered into an environment map: dim
   * walls for bounce, a bright ceiling, a large window panel up and to the
   * left, and a soft front fill that the jewel cases pick up as reflections.
   * Colours run above 1.0 on purpose so the map carries real range.
   */
  #buildEnvironment(): Texture {
    const room = new Scene();
    const parts: Array<{ geometry: PlaneGeometry | BoxGeometry; material: MeshBasicMaterial }> = [];

    const surface = (
      geometry: PlaneGeometry | BoxGeometry,
      hex: number,
      intensity: number,
      place: (mesh: Mesh) => void,
    ) => {
      const material = new MeshBasicMaterial({
        color: new Color(hex).multiplyScalar(intensity),
        side: BackSide,
      });
      const mesh = new Mesh(geometry, material);
      place(mesh);
      room.add(mesh);
      parts.push({ geometry, material });
    };

    // Enclosing shell: the ambient warmth everything sits in.
    surface(new BoxGeometry(34, 22, 34), 0xc6b79c, 0.36, mesh => mesh.position.set(0, 0, 0));

    const panel = (
      width: number,
      height: number,
      hex: number,
      intensity: number,
      place: (mesh: Mesh) => void,
    ) => {
      const material = new MeshBasicMaterial({
        color: new Color(hex).multiplyScalar(intensity),
      });
      const geometry = new PlaneGeometry(width, height);
      const mesh = new Mesh(geometry, material);
      place(mesh);
      room.add(mesh);
      parts.push({ geometry, material });
    };

    // Window, high and to the left. This is the light with direction.
    panel(11, 13, 0xfff6ea, 7.2, mesh => {
      mesh.position.set(-15.5, 4.5, 3);
      mesh.rotation.y = Math.PI / 2;
    });
    // Ceiling wash.
    panel(26, 26, 0xfff2df, 1.35, mesh => {
      mesh.position.set(0, 10.5, 0);
      mesh.rotation.x = Math.PI / 2;
    });
    // Front fill, behind the reader: what glossy jewel cases reflect.
    panel(26, 16, 0xf4ede0, 0.95, mesh => mesh.position.set(0, 1, 15.5));
    // Floor, darker so objects are grounded rather than floating in even light.
    panel(26, 26, 0x6d5c46, 0.3, mesh => {
      mesh.position.set(0, -10.5, 0);
      mesh.rotation.x = -Math.PI / 2;
    });

    const pmrem = new PMREMGenerator(this.#renderer);
    const target = pmrem.fromScene(room, 0.035);
    pmrem.dispose();

    for (const part of parts) {
      part.geometry.dispose();
      part.material.dispose();
    }
    this.#cleanup.push(() => target.dispose());

    return target.texture;
  }

  /* -- Row planning ------------------------------------------------------- */

  #planRows(payload: ShelfPayload): ShelfRow[] {
    const rows: ShelfRow[] = [];
    const usable = INTERIOR_WIDTH - ROW_PAD * 2;

    // Albums keep their art readable, so they wrap rather than shrink. The
    // count is levelled across shelves so the last one is never a lone case.
    if (payload.albums.length) {
      const rowCount = Math.ceil(payload.albums.length / ALBUMS_PER_ROW);
      const base = Math.floor(payload.albums.length / rowCount);
      let extra = payload.albums.length % rowCount;
      let taken = 0;

      for (let i = 0; i < rowCount; i += 1) {
        const size = base + (extra > 0 ? 1 : 0);
        if (extra > 0) extra -= 1;
        rows.push({
          kind: 'album',
          items: payload.albums.slice(taken, taken + size),
          height: ALBUM_ROW_HEIGHT,
          label: i === 0 ? payload.listeningLabel : '',
          bottomY: 0,
        });
        taken += size;
      }
    }

    if (payload.games.length) {
      rows.push({
        kind: 'game',
        items: payload.games,
        height: GAME_ROW_HEIGHT,
        label: payload.gamesLabel,
        bottomY: 0,
      });
    }

    // Books pack by real thickness, so shelves fill the way a shelf actually
    // fills rather than at a tidy count per row.
    let current: ShelfBook[] = [];
    let width = 0;
    const bookRows: ShelfBook[][] = [];
    for (const book of payload.books) {
      const thickness = bookThickness(book);
      if (width + thickness > usable && current.length) {
        bookRows.push(current);
        current = [];
        width = 0;
      }
      current.push(book);
      width += thickness;
    }
    if (current.length) bookRows.push(current);

    bookRows.forEach((items, index) => {
      rows.push({
        kind: 'book',
        items,
        height: BOOK_ROW_HEIGHT,
        label: index === 0 ? payload.libraryLabel : '',
        bottomY: 0,
      });
    });

    return rows;
  }

  /* -- Frame -------------------------------------------------------------- */

  #buildFrame(rows: ShelfRow[]): void {
    const interiorHeight = rows.reduce((sum, row) => sum + row.height + BOARD_THICKNESS, 0);
    const outerHeight = interiorHeight + BOARD_THICKNESS * 2 + CROWN_HEIGHT;
    this.#unitHeight = outerHeight;

    const grainH = woodTexture('boards', 4, 1);
    const grainV = woodTexture('uprights', 1, 6);
    const wood = new MeshStandardMaterial({
      map: grainH,
      roughness: 0.54,
      metalness: 0.02,
      envMapIntensity: 1.15,
    });
    const woodUpright = new MeshStandardMaterial({
      map: grainV,
      roughness: 0.54,
      metalness: 0.02,
      envMapIntensity: 1.15,
    });
    this.#cleanup.push(() => {
      grainH.dispose();
      grainV.dispose();
      wood.dispose();
      woodUpright.dispose();
    });

    const top = 0;
    const outerWidth = INTERIOR_WIDTH + SIDE_THICKNESS * 2;

    // Back panel, run well past the unit on every side so the shelf sits in a
    // lit room rather than floating on a flat clear colour. Tone mapping treats
    // real geometry and a cleared buffer differently, and the difference shows.
    const wallWidth = outerWidth * 4;
    const wallHeight = outerHeight + 40;
    const wallTexture = wallpaperTexture();
    // One motif tile is about 2.2 world units, so the pattern reads at room
    // scale instead of being stretched across the whole wall.
    wallTexture.repeat.set(wallWidth / 2.2, wallHeight / 2.2);
    const wallMaterial = new MeshStandardMaterial({
      map: wallTexture,
      roughness: 0.94,
      metalness: 0,
      envMapIntensity: 0.7,
    });
    const wall = new Mesh(new PlaneGeometry(wallWidth, wallHeight), wallMaterial);
    wall.position.set(0, top - outerHeight / 2, -INTERIOR_DEPTH / 2 - 0.02);
    wall.receiveShadow = true;
    this.#unit.add(wall);
    this.#cleanup.push(() => {
      wallTexture.dispose();
      wallMaterial.dispose();
    });

    // Back panel in the same birch. The wallpaper is the room behind the unit,
    // not something you should see through the shelves.
    const backPanel = new Mesh(new PlaneGeometry(INTERIOR_WIDTH, outerHeight), wood);
    backPanel.position.set(0, top - outerHeight / 2, -INTERIOR_DEPTH / 2 + 0.012);
    backPanel.receiveShadow = true;
    this.#unit.add(backPanel);

    // Uprights.
    for (const side of [-1, 1]) {
      const upright = new Mesh(
        new RoundedBoxGeometry(SIDE_THICKNESS, outerHeight, INTERIOR_DEPTH, 2, EDGE_RADIUS),
        woodUpright,
      );
      upright.position.set(
        side * (INTERIOR_WIDTH + SIDE_THICKNESS) / 2,
        top - outerHeight / 2,
        0,
      );
      upright.castShadow = true;
      upright.receiveShadow = true;
      this.#unit.add(upright);
    }

    // Crown: a solid band across the top of the unit that carries the
    // nameplate, the way a fitted library shelf does.
    const crown = new Mesh(
      new RoundedBoxGeometry(outerWidth, CROWN_HEIGHT, INTERIOR_DEPTH, 2, EDGE_RADIUS),
      wood,
    );
    crown.position.set(0, top - CROWN_HEIGHT / 2, 0);
    crown.castShadow = true;
    crown.receiveShadow = true;
    this.#unit.add(crown);
    this.#addPlaque("JODY'S LIBRARY", top - CROWN_HEIGHT / 2, 0.4);

    // Boards: one under the crown, then one under each row.
    let y = top - CROWN_HEIGHT - BOARD_THICKNESS / 2;
    this.#addBoard(y, outerWidth, wood);
    this.#rowBounds = [];

    for (const row of rows) {
      const rowTop = y - BOARD_THICKNESS / 2;
      row.bottomY = rowTop - row.height;
      this.#rowBounds.push({
        top: rowTop,
        bottom: row.bottomY,
        centre: rowTop - row.height / 2,
      });
      y = row.bottomY - BOARD_THICKNESS / 2;
      this.#addBoard(y, outerWidth, wood);
    }
  }

  #addBoard(y: number, width: number, material: MeshStandardMaterial): void {
    const board = new Mesh(
      new RoundedBoxGeometry(width, BOARD_THICKNESS, INTERIOR_DEPTH, 2, EDGE_RADIUS),
      material,
    );
    board.position.set(0, y, 0);
    board.castShadow = true;
    board.receiveShadow = true;
    this.#unit.add(board);
  }

  /* -- Rows --------------------------------------------------------------- */

  #buildRows(rows: ShelfRow[]): void {
    const pageTexture = pageEdgeTexture('pages');
    const pageMaterial = new MeshStandardMaterial({ map: pageTexture, roughness: 0.9 });
    this.#cleanup.push(() => {
      pageTexture.dispose();
      pageMaterial.dispose();
    });

    // The clear hinge strip down the left edge of every jewel case. One
    // geometry and one material shared across all of them.
    const hingeGeometry = new BoxGeometry(
      ALBUM_SIZE * 0.075,
      ALBUM_SIZE * 0.995,
      ALBUM_CASE_DEPTH * 1.3,
    );
    const hingeMaterial = new MeshPhysicalMaterial({
      color: 0xeef3f6,
      transparent: true,
      opacity: 0.34,
      roughness: 0.04,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      ior: 1.52,
      envMapIntensity: 2.2,
    });
    this.#cleanup.push(() => {
      hingeGeometry.dispose();
      hingeMaterial.dispose();
    });

    rows.forEach((row, rowIndex) => {
      if (row.label) this.#addPlaque(row.label, row.bottomY - BOARD_THICKNESS / 2);

      switch (row.kind) {
        case 'album':
          this.#buildAlbumRow(row as ShelfRow<ShelfAlbum>, rowIndex, hingeGeometry, hingeMaterial);
          break;
        case 'game':
          this.#buildGameRow(row as ShelfRow<ShelfGame>, rowIndex);
          break;
        case 'book':
          this.#buildBookRow(row as ShelfRow<ShelfBook>, rowIndex, pageMaterial);
          break;
      }
    });
  }

  #addPlaque(label: string, centreY: number, height = 0.26): void {
    // Kept close to board thickness so it reads as a fixed shelf label rather
    // than a card floating over the row below.
    const width = Math.min(6.4, (0.5 + label.length * 0.132) * (height / 0.26));
    const texture = plaqueTexture(label, width / height);
    const plaque = new Mesh(
      new PlaneGeometry(width, height),
      new MeshBasicMaterial({ map: texture, toneMapped: false }),
    );
    plaque.position.set(0, centreY, INTERIOR_DEPTH / 2 + 0.012);
    this.#unit.add(plaque);
    this.#cleanup.push(() => texture.dispose());
  }

  #buildAlbumRow(
    row: ShelfRow<ShelfAlbum>,
    rowIndex: number,
    hingeGeometry: BoxGeometry,
    hingeMaterial: MeshPhysicalMaterial,
  ): void {
    const spacing = ALBUM_SIZE + 0.055;
    const totalWidth = row.items.length * spacing;
    let x = -totalWidth / 2 + spacing / 2;

    for (const album of row.items) {
      const lean = jitter(`${album.id}-lean`, -0.035, 0.035);
      const depth = jitter(`${album.id}-depth`, -0.12, 0.04);

      // Printed card under clear plastic: the sharp clearcoat is what throws a
      // highlight across the art as the case turns.
      const front = new MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 0.26,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.015,
        reflectivity: 0.62,
        envMapIntensity: 1.5,
      });
      const shell = new MeshPhysicalMaterial({
        color: 0xdfe3e7,
        roughness: 0.12,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        envMapIntensity: 2,
      });

      const backInlay = albumBackTexture(album);
      const back = new MeshPhysicalMaterial({
        map: backInlay,
        roughness: 0.3,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.02,
        envMapIntensity: 1.4,
      });

      const mesh = new Mesh(
        new BoxGeometry(ALBUM_SIZE, ALBUM_SIZE, ALBUM_CASE_DEPTH),
        [shell, shell, shell, shell, front, back],
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(x, row.bottomY + ALBUM_SIZE / 2 + 0.02, depth);
      mesh.rotation.z = lean;
      mesh.userData.id = album.id;

      const hinge = new Mesh(hingeGeometry, hingeMaterial);
      hinge.position.x = -ALBUM_SIZE / 2 + ALBUM_SIZE * 0.0375;
      hinge.renderOrder = 1;
      mesh.add(hinge);

      this.#unit.add(mesh);
      this.#register({
        id: album.id,
        item: album,
        object: mesh,
        hoverAxis: new Vector3(0, 0, 1),
        activeSpin: new Quaternion().setFromEuler(
          new Euler(PRESENTATION.album.tilt.x, PRESENTATION.album.tilt.y, PRESENTATION.album.tilt.z),
        ),
        closeUpSize: { width: ALBUM_SIZE, height: ALBUM_SIZE },
        closeUpFill: PRESENTATION.album.fill,
        closeUpShift: { x: PRESENTATION.album.shiftX, y: PRESENTATION.album.shiftY },
        spinTurns: PRESENTATION.album.spinTurns,
        lit: [front],
        rowIndex,
      });

      // Real art, loaded straight onto the case front.
      if (album.cover) {
        void loadCoverTexture(album.cover).then(texture => {
          if (this.#disposed) return;
          front.map = texture ?? fallbackCoverTexture(album);
          front.needsUpdate = true;
          this.#invalidate();
        });
      } else {
        front.map = fallbackCoverTexture(album);
        front.needsUpdate = true;
      }
      this.#cleanup.push(() => {
        front.map?.dispose();
        front.dispose();
        backInlay.dispose();
        back.dispose();
        shell.dispose();
      });

      x += spacing;
    }
  }

  #buildBookRow(row: ShelfRow<ShelfBook>, rowIndex: number, pageMaterial: MeshStandardMaterial): void {
    const widths = row.items.map(bookThickness);
    const total = widths.reduce((sum, value) => sum + value, 0);
    // Books sit left-aligned with an honest gap at the end of a short row.
    let x = -INTERIOR_WIDTH / 2 + ROW_PAD;
    const slack = Math.max(0, INTERIOR_WIDTH - ROW_PAD * 2 - total);
    const gap = row.items.length > 1 ? Math.min(0.05, slack / (row.items.length - 1)) : 0;

    row.items.forEach((book, i) => {
      const thickness = widths[i];
      const height = jitter(`${book.id}-h`, 2.02, 2.78);
      const depth = jitter(`${book.id}-d`, 1.42, 1.74);
      const lean = seededUnit(`${book.id}-lean`) > 0.9
        ? jitter(`${book.id}-tilt`, -0.055, 0.055)
        : 0;
      const setBack = jitter(`${book.id}-set`, -0.14, 0.02);

      // Real shelves mix matte paperbacks, satin cloth, and glossy dust
      // jackets. One roughness across 86 books is a dead giveaway.
      const jacketed = seededUnit(`${book.id}-finish`) > 0.62;
      const spineMaterial = new MeshPhysicalMaterial({
        // The book's own cloth, standing in until #paintSpines draws the
        // lettering over it. Right colour from the first frame, so filling it
        // in reads as the titles arriving rather than the shelf changing.
        color: new Color(book.color),
        roughness: jacketed
          ? jitter(`${book.id}-rough`, 0.28, 0.46)
          : jitter(`${book.id}-rough`, 0.62, 0.94),
        metalness: 0,
        clearcoat: jacketed ? 0.85 : 0,
        clearcoatRoughness: jacketed ? jitter(`${book.id}-cc`, 0.06, 0.2) : 0,
        envMapIntensity: jacketed ? 1.25 : 0.85,
      });
      this.#spines.set(book.id, { book, material: spineMaterial, aspect: height / thickness });
      this.#pendingSpines.add(book.id);
      const boards = new MeshStandardMaterial({ color: new Color(book.color), roughness: 0.85 });
      const cover = new MeshStandardMaterial({ color: new Color(book.color), roughness: 0.78 });

      const mesh = new Mesh(new BoxGeometry(thickness, height, depth), [
        cover, // +x front cover, revealed when the book turns
        boards, // -x back cover
        pageMaterial, // +y head
        pageMaterial, // -y tail
        spineMaterial, // +z spine, what you see on the shelf
        pageMaterial, // -z fore edge
      ]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(
        x + thickness / 2,
        row.bottomY + height / 2 + 0.02,
        INTERIOR_DEPTH / 2 - depth / 2 + setBack,
      );
      mesh.rotation.z = lean;
      mesh.userData.id = book.id;

      this.#unit.add(mesh);
      this.#register({
        id: book.id,
        item: book,
        object: mesh,
        hoverAxis: new Vector3(0, 0, 1),
        // Turning -90 degrees about Y brings the +x cover round to the reader;
        // stopping a little short of square leaves the spine visible.
        activeSpin: new Quaternion().setFromEuler(
          new Euler(
            PRESENTATION.book.tilt.x,
            -Math.PI / 2 + PRESENTATION.book.tilt.y,
            PRESENTATION.book.tilt.z,
          ),
        ),
        // Turned three-quarter, so what has to fit across is the cover plus the
        // sliver of spine still facing the reader.
        closeUpSize: { width: depth + thickness, height },
        closeUpFill: PRESENTATION.book.fill,
        closeUpShift: { x: PRESENTATION.book.shiftX, y: PRESENTATION.book.shiftY },
        spinTurns: PRESENTATION.book.spinTurns,
        lit: [spineMaterial, cover],
        coverMaterial: cover,
        rowIndex,
      });

      this.#cleanup.push(() => {
        // Drawn lazily and swapped on redraw, so dispose whatever is current.
        spineMaterial.map?.dispose();
        spineMaterial.dispose();
        boards.dispose();
        cover.map?.dispose();
        cover.dispose();
      });

      x += thickness + gap;
    });
  }

  /**
   * Game cases stand cover-out. Spine-out, five of them would be a finger's
   * width of red on a shelf built for eighty books; the box art is the point.
   * They are spaced as a set rather than stretched to the walls, each set back
   * and turned a little differently, tipped back as a propped case stands.
   */
  #buildGameRow(row: ShelfRow<ShelfGame>, rowIndex: number): void {
    const count = Math.max(1, row.items.length);
    const slot = Math.min(GAME_SLOT_MAX, (INTERIOR_WIDTH - ROW_PAD * 2) / count);
    let x = -((count - 1) * slot) / 2;
    // One case out of true, so the row reads as put there by hand. Chosen off
    // the ids, so it is the same case on every visit.
    const leaning = row.items.length > 2
      ? row.items.reduce((best, game) =>
        seededUnit(`${game.id}-lean`) > seededUnit(`${best.id}-lean`) ? game : best).id
      : '';

    for (const game of row.items) {
      const { width, height, depth } = GAME_CASES[game.system];
      const plastic = new MeshPhysicalMaterial({
        color: new Color(casePlastic(game.system)),
        roughness: 0.34,
        metalness: 0,
        clearcoat: 0.6,
        clearcoatRoughness: 0.12,
        envMapIntensity: 1.2,
      });
      // Printed insert under the clear sleeve, the same finish as a jewel
      // case's card: the clearcoat is what throws a highlight across the art.
      const sleeve = {
        roughness: 0.28,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        envMapIntensity: 1.4,
      };
      const frontAspect = width / height;
      const spineAspect = height / depth;
      const front = new MeshPhysicalMaterial({ ...sleeve, map: gameCoverTexture(game, frontAspect) });
      const spine = new MeshPhysicalMaterial({ ...sleeve, map: gameSpineTexture(game, spineAspect) });

      const mesh = new Mesh(new BoxGeometry(width, height, depth), [
        plastic, // +x opening edge
        spine, // -x spine, on the left as the cover faces you
        plastic, // +y
        plastic, // -y
        front, // +z cover
        plastic, // -z back
      ]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(
        x + jitter(`${game.id}-x`, -0.1, 0.1),
        row.bottomY + height / 2 + 0.02,
        INTERIOR_DEPTH / 2 - depth / 2 - jitter(`${game.id}-set`, 0.22, 0.5),
      );
      mesh.rotation.set(
        jitter(`${game.id}-tip`, -0.11, -0.07),
        jitter(`${game.id}-turn`, -0.09, 0.09),
        game.id === leaning ? 0.06 : jitter(`${game.id}-roll`, -0.012, 0.012),
      );
      mesh.userData.id = game.id;

      this.#unit.add(mesh);
      this.#register({
        id: game.id,
        item: game,
        object: mesh,
        hoverAxis: new Vector3(0, 0, 1),
        activeSpin: new Quaternion().setFromEuler(
          new Euler(PRESENTATION.game.tilt.x, PRESENTATION.game.tilt.y, PRESENTATION.game.tilt.z),
        ),
        closeUpSize: { width: width + depth, height },
        closeUpFill: PRESENTATION.game.fill,
        closeUpShift: { x: PRESENTATION.game.shiftX, y: PRESENTATION.game.shiftY },
        spinTurns: PRESENTATION.game.spinTurns,
        lit: [front, spine],
        rowIndex,
      });

      this.#gameFaces.set(game.id, { game, front, spine, frontAspect, spineAspect });
      // Five covers, all facing out and all in view: loaded up front, unlike
      // the book jackets, which only ever show once a book is turned round.
      if (game.cover) {
        void loadImage(game.cover).then(image => {
          const face = this.#gameFaces.get(game.id);
          if (!face || this.#disposed || !image) return;
          face.image = image;
          this.#redrawGame(game.id);
          this.#invalidate();
        });
      }

      this.#cleanup.push(() => {
        front.map?.dispose();
        front.dispose();
        spine.map?.dispose();
        spine.dispose();
        plastic.dispose();
      });

      x += slot;
    }
  }

  /** Reprints a case's faces, keeping whatever art has arrived for it. */
  #redrawGame(id: string): void {
    const face = this.#gameFaces.get(id);
    if (!face || this.#disposed) return;
    face.front.map?.dispose();
    face.front.map = gameCoverTexture(face.game, face.frontAspect, face.image);
    face.front.needsUpdate = true;
    face.spine.map?.dispose();
    face.spine.map = gameSpineTexture(face.game, face.spineAspect);
    face.spine.needsUpdate = true;
  }

  #register(
    view: Omit<ItemView, 'restPosition' | 'restQuaternion' | 'baseQuaternion' | 'spinElapsed'>,
  ): void {
    const full: ItemView = {
      ...view,
      restPosition: view.object.position.clone(),
      restQuaternion: view.object.quaternion.clone(),
      baseQuaternion: view.object.quaternion.clone(),
      spinElapsed: 0,
    };
    this.#views.set(view.id, full);
    this.#pickable.push(view.object);
  }

  /* ---------------------------------------------------------------------- */
  /* Layout and camera                                                       */
  /* ---------------------------------------------------------------------- */

  #resize(): void {
    const { stage, scroller } = this.#options;
    const width = stage.clientWidth || window.innerWidth;
    const height = stage.clientHeight || window.innerHeight;

    this.#renderer.setSize(width, height, false);
    this.#composer?.setPixelRatio(this.#renderer.getPixelRatio());
    this.#composer?.setSize(width, height);
    this.#gtao?.setSize(width, height);
    this.#camera.aspect = width / height;

    // Pull back far enough that the full unit width is in frame with margin.
    const half = (INTERIOR_WIDTH + SIDE_THICKNESS * 2) / 2 + 0.55;
    const vFov = (CAMERA_FOV * Math.PI) / 180;
    const byWidth = half / (Math.tan(vFov / 2) * this.#camera.aspect);
    const byHeight = 3.4 / Math.tan(vFov / 2);
    // Fitting the whole width is right until the viewport gets narrow enough
    // that obeying it puts the entire unit on screen at once - which is what a
    // phone was doing, every shelf visible and nothing on any of them legible.
    // Past that the width is handed to dragging, and the framing follows the
    // height, so a phone stands at roughly the same distance as a desktop.
    const fit = Math.min(Math.max(byWidth, byHeight), byHeight * MAX_WIDTH_FIT);
    this.#cameraDistance = fit + INTERIOR_DEPTH;
    this.#camera.updateProjectionMatrix();

    this.#visibleHeight = 2 * Math.tan(vFov / 2) * this.#cameraDistance;
    // How far the camera may be dragged sideways before it leaves the unit.
    // Zero whenever the whole width already fits, which is the desktop case.
    this.#panLimitX = Math.max(0, half - (this.#visibleHeight * this.#camera.aspect) / 2);
    this.#panX = clamp(this.#panX, -this.#panLimitX, this.#panLimitX);
    this.#cameraTopY = -this.#visibleHeight / 2 + 0.25;
    this.#cameraBottomY = Math.min(
      this.#cameraTopY,
      -this.#unitHeight + this.#visibleHeight / 2 - 0.25,
    );

    // Tell the document how far it needs to scroll to walk the whole unit.
    const travel = Math.max(0, this.#cameraTopY - this.#cameraBottomY);
    const travelVh = Math.round((travel / this.#visibleHeight) * 100);
    scroller.style.setProperty('--shelf-travel', `${travelVh}vh`);

    this.#readScroll();
    this.#invalidate();
  }

  #readScroll(): void {
    const { scroller } = this.#options;
    const rect = scroller.getBoundingClientRect();
    const range = scroller.offsetHeight - window.innerHeight;
    this.#scrollProgress = range > 0 ? Math.min(1, Math.max(0, -rect.top / range)) : 0;
    this.#invalidate();
  }

  #updateCamera(delta: number): void {
    const targetY = this.#cameraTopY + (this.#cameraBottomY - this.#cameraTopY) * this.#scrollProgress;

    if (this.#reduced) {
      this.#parallaxTarget.set(0, 0);
      this.#parallax.set(0, 0);
    } else {
      const ease = 1 - Math.pow(0.0015, delta);
      this.#parallax.lerp(this.#parallaxTarget, ease);
    }

    const drift = this.#parallax.x * 0.62;
    const x = this.#panX + drift;
    const y = targetY + this.#parallax.y * 0.34;
    const previous = this.#camera.position.clone();

    this.#camera.position.set(x, y, this.#cameraDistance);
    // Aim just short of the shelf so the parallax reads as a head shift rather
    // than a camera orbit. The composition can never be lost. The pan is added
    // to both, so dragging moves the camera along the unit instead of turning
    // it to look down the shelf from where it already stood.
    this.#camera.lookAt(this.#panX + drift * 0.4, targetY + this.#parallax.y * 0.12, 0);

    if (this.#lens) {
      this.#lens.uniforms.uShadeSlide.value = (this.#scrollProgress - 0.5) * 0.55;
    }

    if (previous.distanceToSquared(this.#camera.position) > SETTLE_EPSILON) this.#invalidate();
  }

  /* ---------------------------------------------------------------------- */
  /* Interaction                                                             */
  /* ---------------------------------------------------------------------- */

  #bindEvents(): void {
    const { canvas } = this.#options;

    const onScroll = () => this.#readScroll();
    const onResize = () => this.#resize();
    const onVisibility = () => {
      if (!document.hidden) this.#invalidate();
    };

    // Dragging walks the camera along the unit. Only sideways: the canvas keeps
    // `touch-action: pan-y`, so a vertical drag stays a page scroll and keeps
    // the momentum the browser gives it, which the scroll-driven camera already
    // follows. Taking that axis too would mean reimplementing flick physics to
    // arrive back where we started.
    let dragFrom: number | null = null;
    let dragged = 0;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || this.#panLimitX <= 0) return;
      dragFrom = event.clientX;
      dragged = 0;
      canvas.setPointerCapture?.(event.pointerId);
    };

    const onPointerUp = (event: PointerEvent) => {
      dragFrom = null;
      canvas.releasePointerCapture?.(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();

      if (dragFrom !== null && rect.width > 0) {
        const delta = event.clientX - dragFrom;
        dragFrom = event.clientX;
        dragged += Math.abs(delta);
        // A pixel of drag should move the shelf a pixel: the frame's world
        // width over its pixel width. Negated so the shelf follows the finger
        // rather than sliding away from it.
        const worldPerPixel = (this.#visibleHeight * this.#camera.aspect) / rect.width;
        this.#panX = clamp(
          this.#panX - delta * worldPerPixel,
          -this.#panLimitX,
          this.#panLimitX,
        );
        this.#invalidate();
      }

      this.#pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      this.#parallaxTarget.set(this.#pointer.x, this.#pointer.y);
      this.#pointerInside = true;
      this.#pointerDirty = true;
      this.#invalidate();
    };

    const onPointerLeave = () => {
      this.#pointerInside = false;
      this.#parallaxTarget.set(0, 0);
      this.#store.dispatch({ type: 'hover', id: null });
      this.#invalidate();
    };

    const onClick = (event: MouseEvent) => {
      // A drag that finishes over a book is not a click on it. Anything past a
      // few pixels was someone moving along the shelf, not picking from it.
      if (dragged > DRAG_SLOP) {
        dragged = 0;
        return;
      }
      const id = this.#pick(event);
      if (id) this.#store.dispatch({ type: 'activate', id });
      else this.#store.dispatch({ type: 'dismiss' });
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('click', onClick);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);

    this.#cleanup.push(() => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('click', onClick);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    });
  }

  #pick(event: MouseEvent): string | null {
    const rect = this.#options.canvas.getBoundingClientRect();
    const point = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.#raycaster.setFromCamera(point, this.#camera);
    const hits = this.#raycaster.intersectObjects(this.#pickable, true);
    for (const hit of hits) {
      const id = findId(hit.object);
      if (id) return id;
    }
    return null;
  }

  #hoverTest(): void {
    if (!this.#pointerInside) return;
    this.#raycaster.setFromCamera(this.#pointer, this.#camera);
    const hits = this.#raycaster.intersectObjects(this.#pickable, true);
    let id: string | null = null;
    for (const hit of hits) {
      id = findId(hit.object);
      if (id) break;
    }
    this.#options.canvas.style.cursor = id ? 'pointer' : '';
    this.#store.dispatch({ type: 'hover', id });
  }

  #onStateChange(): void {
    for (const view of this.#views.values()) this.#animating.add(view.id);
    const { active } = this.#store.state;
    if (active) {
      this.#ensureCover(active);
      const view = this.#views.get(active);
      if (view) {
        // Only on a genuinely new selection. Hover changes fire this too, and
        // restarting the spin every time the pointer grazed another case made
        // the open one twitch.
        if (active !== this.#lastActive) view.spinElapsed = 0;
        this.#scrollRowIntoView(view.rowIndex);
      }
    }
    this.#lastActive = active;
    this.#invalidate();
  }

  /**
   * Brings a row into frame so a keyboard user never activates something
   * sitting off screen. Rows already comfortably in view are left alone: a
   * reader who clicks a book they can see should not have the page yanked.
   */
  #scrollRowIntoView(rowIndex: number): void {
    const row = this.#rowBounds[rowIndex];
    if (!row) return;
    const range = this.#cameraTopY - this.#cameraBottomY;
    if (range <= 0) return;

    // Already fully framed, margin included: leave the reader's scroll alone.
    const cameraY = this.#cameraTopY - range * this.#scrollProgress;
    const half = this.#visibleHeight / 2;
    const margin = 0.3;
    if (row.top <= cameraY + half - margin && row.bottom >= cameraY - half + margin) return;

    const scrollRange = this.#options.scroller.offsetHeight - window.innerHeight;
    if (scrollRange <= 0) return;
    const progress = Math.min(1, Math.max(0, (this.#cameraTopY - row.centre) / range));
    const top = this.#options.scroller.offsetTop + progress * scrollRange;
    window.scrollTo({ top, behavior: this.#reduced ? 'auto' : 'smooth' });
  }

  /** Real jackets cost memory, so they load only when a book is opened. */
  #ensureCover(id: string): void {
    const view = this.#views.get(id);
    if (!view || view.coverLoaded || !view.coverMaterial) return;
    view.coverLoaded = true;

    const book = view.item as ShelfBook;
    const material = view.coverMaterial;

    const apply = (texture: Texture) => {
      if (this.#disposed) return;
      material.map = texture;
      material.color.set(0xffffff);
      material.needsUpdate = true;
      this.#invalidate();
    };

    const cached = this.#coverCache.get(id);
    if (cached) {
      apply(cached);
      return;
    }

    if (!book.cover) {
      const fallback = fallbackCoverTexture(book);
      this.#coverCache.set(id, fallback);
      apply(fallback);
      return;
    }

    void loadCoverTexture(book.cover).then(texture => {
      const resolved = texture ?? fallbackCoverTexture(book);
      this.#coverCache.set(id, resolved);
      apply(resolved);
    });
  }

  /** Public entry used by the overlay when a control receives focus. */
  focus(id: string): void {
    const view = this.#views.get(id);
    if (!view) return;
    this.#scrollRowIntoView(view.rowIndex);
    this.#store.dispatch({ type: 'hover', id });
  }

  /* ---------------------------------------------------------------------- */
  /* Animation                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * How far in front of the camera a selected item parks.
   *
   * Framed by its height, then pulled back further if the frame is too narrow
   * to take its width. A portrait phone is far narrower than it is tall, so an
   * item sized only against the height runs off both edges there.
   */
  #closeUpDistance(view: ItemView): number {
    const byHeight = closeUpDistance(view.closeUpSize.height, view.closeUpFill);
    const byWidth =
      closeUpDistance(view.closeUpSize.width, view.closeUpFill) / this.#camera.aspect;
    return Math.max(byHeight, byWidth);
  }

  /** Where a selected item parks: in front of the camera, turned to face the
   *  reader, offset clear of the card. */
  #activePose(view: ItemView, position: Vector3, quaternion: Quaternion): void {
    const vFov = (CAMERA_FOV * Math.PI) / 180;
    const closeUp = this.#closeUpDistance(view);
    const frameHeight = 2 * Math.tan(vFov / 2) * closeUp;
    const frameWidth = frameHeight * this.#camera.aspect;
    position
      .set(frameWidth * view.closeUpShift.x, frameHeight * view.closeUpShift.y, -closeUp)
      .applyQuaternion(this.#camera.quaternion)
      .add(this.#camera.position);
    quaternion.copy(this.#camera.quaternion).multiply(view.activeSpin);
  }

  #animateItems(delta: number): void {
    if (!this.#animating.size) return;
    const { hovered, active } = this.#store.state;
    const ease = this.#reduced ? 1 : 1 - Math.pow(0.00035, delta);
    const settled: string[] = [];

    const targetPosition = new Vector3();
    const targetQuaternion = new Quaternion();
    const spinQuaternion = new Quaternion();

    for (const id of this.#animating) {
      const view = this.#views.get(id);
      if (!view) {
        settled.push(id);
        continue;
      }

      const isActive = active === id;
      const isHovered = hovered === id && !isActive;

      if (isActive) {
        this.#activePose(view, targetPosition, targetQuaternion);
      } else {
        targetPosition.copy(view.restPosition);
        if (isHovered) targetPosition.addScaledVector(view.hoverAxis, HOVER_LIFT);
        targetQuaternion.copy(view.restQuaternion);
      }

      view.object.position.lerp(targetPosition, ease);
      view.baseQuaternion.slerp(targetQuaternion, ease);

      // The entry spin unwinds from a full turn to nothing, so the item is
      // still rotating as it arrives and comes to rest square to the reader.
      let spinAngle = 0;
      if (isActive && view.spinTurns > 0 && !this.#reduced) {
        view.spinElapsed = Math.min(SPIN_SECONDS, view.spinElapsed + delta);
        const t = view.spinElapsed / SPIN_SECONDS;
        const eased = 1 - Math.pow(1 - t, 3);
        spinAngle = (1 - eased) * Math.PI * 2 * view.spinTurns;
      }

      view.object.quaternion.copy(view.baseQuaternion);
      if (spinAngle !== 0) {
        view.object.quaternion.multiply(spinQuaternion.setFromAxisAngle(Y_AXIS, spinAngle));
      }

      // Kept low: emissive lifts blacks, and album art goes grey long before
      // the highlight reads as "lit". Hover needs it more than active, which is
      // already framed and unmistakable.
      const glow = isActive ? 0.025 : isHovered ? 0.07 : 0;
      for (const material of view.lit) {
        const current = material.emissive.r;
        const next = current + (glow - current) * ease;
        material.emissive.setScalar(next);
      }

      const positionSettled = view.object.position.distanceToSquared(targetPosition) < SETTLE_EPSILON;
      const rotationSettled = Math.abs(view.baseQuaternion.dot(targetQuaternion)) > 0.99999;
      if (positionSettled && rotationSettled && !isActive) {
        view.object.position.copy(targetPosition);
        view.baseQuaternion.copy(targetQuaternion);
        view.object.quaternion.copy(targetQuaternion);
        settled.push(id);
      }
    }

    for (const id of settled) this.#animating.delete(id);
    this.#invalidate();
  }

  #redrawSpine(id: string): void {
    const entry = this.#spines.get(id);
    if (!entry || this.#disposed) return;
    const fresh = spineTexture(entry.book, entry.aspect, entry.palette);
    entry.material.map?.dispose();
    entry.material.map = fresh;
    // Cloth colour was standing in for the artwork; leaving it on would tint
    // the drawn spine.
    entry.material.color.set(0xffffff);
    entry.material.needsUpdate = true;
    this.#pendingSpines.delete(id);
  }

  /**
   * Draws queued spines a slice at a time.
   *
   * Each spine is a canvas draw, and 86 of them back to back is a single task
   * long enough to stall the first frame. A frame budget keeps the shelf
   * interactive while the lettering fills in behind it.
   */
  #paintSpines(): void {
    if (this.#disposed) return;
    const started = performance.now();
    for (const id of this.#pendingSpines) {
      this.#redrawSpine(id);
      if (performance.now() - started > SPINE_PAINT_BUDGET_MS) break;
    }
    this.#invalidate();
    this.#spinePaint = this.#pendingSpines.size
      ? requestAnimationFrame(() => this.#paintSpines())
      : 0;
  }

  #refreshTextTextures(): void {
    // Spines were drawn before the webfonts resolved. Redrawing is cheaper than
    // blocking first paint on fonts.
    for (const id of this.#spines.keys()) this.#pendingSpines.add(id);
    if (!this.#spinePaint) this.#paintSpines();
    for (const id of this.#gameFaces.keys()) this.#redrawGame(id);
    this.#invalidate();
  }

  /**
   * Reprints every spine in its own jacket's colours.
   *
   * A generated cloth spine beside a real cover reads as two different books,
   * which is exactly what a wraparound jacket avoids. Runs in the background
   * with a small concurrency cap so it never competes with first paint, and
   * each spine restyles the moment its own jacket is sampled.
   */
  async #adoptJacketColours(): Promise<void> {
    const pending = [...this.#spines.values()].filter(entry => entry.book.cover);
    let next = 0;

    const worker = async (): Promise<void> => {
      while (next < pending.length && !this.#disposed) {
        const entry = pending[next];
        next += 1;
        const palette = await sampleCoverPalette(entry.book.cover as string);
        if (this.#disposed) return;
        if (!palette) continue;
        entry.palette = palette;
        this.#redrawSpine(entry.book.id);
        this.#invalidate();
      }
    };

    await Promise.all(Array.from({ length: 6 }, worker));
  }

  /* ---------------------------------------------------------------------- */
  /* Loop                                                                    */
  /* ---------------------------------------------------------------------- */

  #invalidate(): void {
    this.#needsRender = true;
  }

  #loop(): void {
    let last = performance.now();

    const tick = (now: number) => {
      if (this.#disposed) return;
      this.#frame = requestAnimationFrame(tick);

      if (document.hidden) {
        last = now;
        return;
      }

      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (this.#pointerDirty) {
        this.#pointerDirty = false;
        this.#hoverTest();
      }

      this.#updateCamera(delta);
      this.#animateItems(delta);

      if (this.#needsRender) this.render();
    };

    this.#frame = requestAnimationFrame(tick);
    this.#cleanup.push(() => cancelAnimationFrame(this.#frame));
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#spinePaint) cancelAnimationFrame(this.#spinePaint);
    this.#pendingSpines.clear();
    this.#unsubscribe();
    for (const teardown of this.#cleanup.splice(0)) {
      try {
        teardown();
      } catch {
        /* teardown is best effort */
      }
    }
    for (const texture of this.#coverCache.values()) texture.dispose();
    this.#coverCache.clear();
    this.#spines.clear();
    this.#gameFaces.clear();
    this.#scene.traverse(object => {
      if (object instanceof Mesh) object.geometry.dispose();
    });
    this.#views.clear();
    this.#pickable = [];
    this.#renderer.dispose();
  }
}

interface ShelfRow<T extends ShelfItem = ShelfItem> {
  kind: 'album' | 'book' | 'game';
  items: T[];
  height: number;
  label: string;
  /** Board level the row stands on. Filled in by #buildFrame. */
  bottomY: number;
}

function bookThickness(book: ShelfBook): number {
  return jitter(`${book.id}-t`, 0.19, 0.46);
}

function findId(object: Object3D): string | null {
  let node: Object3D | null = object;
  while (node) {
    const id = node.userData?.id;
    if (typeof id === 'string') return id;
    node = node.parent;
  }
  return null;
}
