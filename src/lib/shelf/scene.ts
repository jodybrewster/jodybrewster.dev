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
  TorusGeometry,
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
import { CSS3DObject, CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import type { ShelfAlbum, ShelfBook, ShelfItem, ShelfNotebook } from './media';
import { seededUnit } from './media';
import type { ShelfStore } from './scene-state';
import {
  albumBackTexture,
  fallbackCoverTexture,
  fontsReady,
  loadCoverTexture,
  notebookCoverTexture,
  notebookPageTexture,
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
  notebooks: ShelfNotebook[];
  listeningLabel: string;
  libraryLabel: string;
  notebookLabel: string;
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

const NOTEBOOK_ROW_HEIGHT = 2.58;
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
    // Held close: nearly the full frame, turned to a three-quarter view so the
    // spine reads alongside the cover, and dropped so the tail runs off screen.
    fill: 1.15,
    shiftX: -0.13,
    // Centre it so the head of the book lands on the top edge of the window:
    // half the fill above centre is 0.575, and the frame's half-height is 0.5.
    shiftY: 0.5 - 1.15 / 2,
    tilt: { x: 0.075, y: 0.52, z: 0.05 },
    spinTurns: 0,
  },
  notebook: {
    // Sized against the opened spread, not the closed notebook, so the ruled
    // page lands big enough to actually read.
    fill: 0.84,
    shiftX: 0,
    shiftY: 0,
    tilt: { x: 0.05, y: -0.16, z: 0.015 },
    spinTurns: 0,
  },
} as const;

const SETTLE_EPSILON = 0.0006;
/** Seconds for the site's notebook to travel between held-open and shelved. */
const SITE_FOLD_SECONDS = 1.05;
/** Beat the notebook stays open on arrival before it closes. */
const SITE_FOLD_HOLD = 0.7;
/** Seconds for a selected item to unwind its entry spin. */
const SPIN_SECONDS = 0.9;
const Y_AXIS = new Vector3(0, 1, 0);

interface ItemView {
  id: string;
  item: ShelfItem;
  /** Pickable root. Books and albums are meshes, notebooks are groups. */
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
  /** How far in front of the camera this item parks, from its own size. */
  closeUp: number;
  /** Offsets when active, as fractions of the framed width and height. */
  closeUpShift: { x: number; y: number };
  /** Materials whose emissive is raised while hovered or active. */
  lit: MeshStandardMaterial[];
  /** Notebook front cover pivot. */
  hinge?: Object3D;
  /** Lazily swapped in when a book is opened up close. */
  coverMaterial?: MeshStandardMaterial;
  coverLoaded?: boolean;
  rowIndex: number;
}

function jitter(seed: string, min: number, max: number): number {
  return min + seededUnit(seed) * (max - min);
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

  #composer: EffectComposer | null = null;
  #gtao: GTAOPass | null = null;
  #lens: ShaderPass | null = null;
  /** Second renderer for the live page set into the notebook. */
  #cssRenderer: CSS3DRenderer | null = null;
  #page: {
    object: CSS3DObject;
    element: HTMLElement;
    notebookId: string;
    parent: Object3D;
  } | null = null;
  /** Where a mounted page sits, keyed by notebook id. */
  #pageSlots = new Map<string, { parent: Object3D; width: number; height: number; z: number }>();
  #docked = false;
  /** One-shot arrival animation: the site's notebook closing onto the shelf. */
  #siteFold: {
    id: string;
    progress: number;
    direction: 1 | -1;
    hold: number;
    settle: () => void;
  } | null = null;
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

    this.#updatePage();
    // While docked the page has been lifted out of the 3D layer into a plain
    // full-window element. Rendering the layer would stamp the scene's matrix
    // back onto it and fight the takeover.
    if (!this.#docked) this.#cssRenderer?.render(this.#scene, this.#camera);
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

    if (payload.notebooks.length) {
      rows.push({
        kind: 'notebook',
        items: payload.notebooks,
        height: NOTEBOOK_ROW_HEIGHT,
        label: payload.notebookLabel,
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
        case 'notebook':
          this.#buildNotebookRow(row as ShelfRow<ShelfNotebook>, rowIndex);
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
        closeUp: closeUpDistance(ALBUM_SIZE, PRESENTATION.album.fill),
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
        closeUp: closeUpDistance(height, PRESENTATION.book.fill),
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
   * Notebooks stand cover-out rather than spine-out. Their whole point is that
   * the cover names a piece of writing, and a wire binding seen edge-on just
   * reads as a ladder.
   */
  #buildNotebookRow(row: ShelfRow<ShelfNotebook>, rowIndex: number): void {
    const count = Math.max(1, row.items.length);
    const spacing = Math.min(1.72, (INTERIOR_WIDTH - ROW_PAD * 2) / count);
    let x = -((count - 1) * spacing) / 2;

    const ringGeometry = new TorusGeometry(0.052, 0.013, 6, 16);
    const ringMaterial = new MeshStandardMaterial({
      color: 0xc2c5c9,
      roughness: 0.3,
      metalness: 0.85,
    });
    this.#cleanup.push(() => {
      ringGeometry.dispose();
      ringMaterial.dispose();
    });

    for (const notebook of row.items) {
      const width = jitter(`${notebook.id}-w`, 1.22, 1.4);
      const height = jitter(`${notebook.id}-h`, 1.78, 2.0);
      const thickness = jitter(`${notebook.id}-t`, 0.28, 0.4);
      const board = 0.035;

      const group = new Group();
      group.position.set(
        x,
        row.bottomY + height / 2 + 0.02,
        INTERIOR_DEPTH / 2 - thickness / 2 - jitter(`${notebook.id}-set`, 0.12, 0.3),
      );
      // Leaned back against the shelf, the way a display copy actually stands.
      group.rotation.x = jitter(`${notebook.id}-tip`, -0.07, -0.03);
      group.rotation.z = jitter(`${notebook.id}-lean`, -0.02, 0.02);
      group.userData.id = notebook.id;

      const coverTexture = notebookCoverTexture(notebook);
      const coverMaterial = new MeshStandardMaterial({ map: coverTexture, roughness: 0.84 });
      const backMaterial = new MeshStandardMaterial({
        color: new Color(notebook.color),
        roughness: 0.88,
      });
      const pageTexture = notebookPageTexture(notebook);
      const leafMaterial = new MeshStandardMaterial({ map: pageTexture, roughness: 0.94 });
      const blockMaterial = new MeshStandardMaterial({ color: 0xeee7d6, roughness: 0.95 });

      // Page block. Its front face carries the ruled page the cover hides.
      const block = new Mesh(new BoxGeometry(width - 0.03, height - 0.05, thickness - board * 2), [
        blockMaterial,
        blockMaterial,
        blockMaterial,
        blockMaterial,
        leafMaterial,
        blockMaterial,
      ]);
      block.castShadow = true;
      block.receiveShadow = true;
      group.add(block);

      const back = new Mesh(new BoxGeometry(width, height, board), backMaterial);
      back.position.z = -thickness / 2 + board / 2;
      back.castShadow = true;
      group.add(back);

      // Front cover, hinged on the bound left edge like a real notebook.
      const hinge = new Object3D();
      hinge.position.set(-width / 2, 0, thickness / 2 - board / 2);
      const front = new Mesh(new BoxGeometry(width, height, board), coverMaterial);
      front.position.x = width / 2;
      front.castShadow = true;
      hinge.add(front);
      group.add(hinge);

      // Wire binding down that same edge.
      const rings = Math.max(9, Math.round(height / 0.15));
      for (let i = 0; i < rings; i += 1) {
        const ring = new Mesh(ringGeometry, ringMaterial);
        ring.rotation.y = Math.PI / 2;
        ring.position.set(
          -width / 2 + 0.03,
          -height / 2 + 0.1 + (i * (height - 0.2)) / (rings - 1),
          0,
        );
        ring.castShadow = true;
        group.add(ring);
      }

      this.#pageSlots.set(notebook.id, {
        parent: group,
        width: width - 0.03,
        height: height - 0.05,
        z: thickness / 2 + 0.006,
      });

      this.#unit.add(group);
      this.#register({
        id: notebook.id,
        item: notebook,
        object: group,
        hoverAxis: new Vector3(0, 0, 1),
        // Already facing the reader, so it only needs to come forward and open.
        activeSpin: new Quaternion().setFromEuler(
          new Euler(
            PRESENTATION.notebook.tilt.x,
            PRESENTATION.notebook.tilt.y,
            PRESENTATION.notebook.tilt.z,
          ),
        ),
        // Extra room: the cover swings out well past the notebook's own width.
        closeUp: closeUpDistance(Math.max(height, width * 1.55), PRESENTATION.notebook.fill),
        closeUpShift: { x: PRESENTATION.notebook.shiftX, y: PRESENTATION.notebook.shiftY },
        spinTurns: PRESENTATION.notebook.spinTurns,
        lit: [coverMaterial, leafMaterial],
        hinge,
        rowIndex,
      });

      this.#cleanup.push(() => {
        coverTexture.dispose();
        pageTexture.dispose();
        coverMaterial.dispose();
        backMaterial.dispose();
        leafMaterial.dispose();
        blockMaterial.dispose();
      });

      x += spacing;
    }
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
    this.#cssRenderer?.setSize(width, height);
    this.#gtao?.setSize(width, height);
    this.#camera.aspect = width / height;

    // Pull back far enough that the full unit width is in frame with margin.
    const half = (INTERIOR_WIDTH + SIDE_THICKNESS * 2) / 2 + 0.55;
    const vFov = (CAMERA_FOV * Math.PI) / 180;
    const byWidth = half / (Math.tan(vFov / 2) * this.#camera.aspect);
    const byHeight = 3.4 / Math.tan(vFov / 2);
    this.#cameraDistance = Math.max(byWidth, byHeight) + INTERIOR_DEPTH;
    this.#camera.updateProjectionMatrix();

    this.#visibleHeight = 2 * Math.tan(vFov / 2) * this.#cameraDistance;
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

    // Nothing moves during the handoff: a drifting camera under a page that is
    // itself resizing reads as the whole scene sliding.
    if (this.#reduced || this.#siteFold || this.#docked) {
      this.#parallaxTarget.set(0, 0);
      this.#parallax.set(0, 0);
    } else {
      const ease = 1 - Math.pow(0.0015, delta);
      this.#parallax.lerp(this.#parallaxTarget, ease);
    }

    const x = this.#parallax.x * 0.62;
    const y = targetY + this.#parallax.y * 0.34;
    const previous = this.#camera.position.clone();

    this.#camera.position.set(x, y, this.#cameraDistance);
    // Aim just short of the shelf so the parallax reads as a head shift rather
    // than a camera orbit. The composition can never be lost.
    this.#camera.lookAt(x * 0.4, targetY + this.#parallax.y * 0.12, 0);

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

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
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
      const id = this.#pick(event);
      if (id) this.#store.dispatch({ type: 'activate', id });
      else this.#store.dispatch({ type: 'dismiss' });
    };

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('click', onClick);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);

    this.#cleanup.push(() => {
      canvas.removeEventListener('pointermove', onPointerMove);
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

  /**
   * Sets a live DOM element into a notebook's page.
   *
   * Rendered by CSS3DRenderer on a second layer that shares this camera, so it
   * is real interactive markup sitting exactly where the page is, not a picture
   * of one. The two layers do not share a depth buffer, so the page is only
   * shown once the notebook is open and facing the reader, and is pulled the
   * moment the cover starts back across it.
   */
  mountPage(notebookId: string, element: HTMLElement): void {
    const slot = this.#pageSlots.get(notebookId);
    if (!slot || this.#disposed) return;

    // Mounting twice would leave an orphaned layer holding a stale reference,
    // and the stranded one never gets hidden again.
    this.#teardownPage();

    const css = new CSS3DRenderer();
    css.setSize(this.#options.stage.clientWidth, this.#options.stage.clientHeight);
    const layer = css.domElement;
    layer.style.position = 'absolute';
    layer.style.inset = '0';
    // The layer must not swallow pointer events meant for the shelf; only the
    // page itself takes them, and only while it is visible.
    layer.style.pointerEvents = 'none';
    this.#options.stage.appendChild(layer);

    // CSS3D maps one CSS pixel to one world unit, so the element is authored at
    // a readable pixel size and scaled down to the page's real dimensions.
    const pixelWidth = 1000;
    const pixelHeight = Math.round(pixelWidth * (slot.height / slot.width));
    element.style.width = `${pixelWidth}px`;
    element.style.height = `${pixelHeight}px`;
    element.dataset.pageWidth = `${pixelWidth}px`;
    element.dataset.pageHeight = `${pixelHeight}px`;
    element.style.pointerEvents = 'auto';

    // CSS3DRenderer only inserts the element once it is first shown, and an
    // iframe that is not in the document never fetches. Park it in a hidden
    // holder so the site is loaded and painted before the page is revealed.
    const holder = document.createElement('div');
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;opacity:0';
    holder.appendChild(element);
    this.#options.stage.appendChild(holder);
    this.#cleanup.push(() => holder.remove());

    const object = new CSS3DObject(element);
    object.visible = false;
    object.position.set(0, 0, slot.z);
    object.scale.setScalar(slot.width / pixelWidth);
    slot.parent.add(object);

    this.#cssRenderer = css;
    this.#page = { object, element, notebookId, parent: slot.parent };
    this.#cleanup.push(() => this.#teardownPage());
    this.#invalidate();
  }

  #teardownPage(): void {
    this.#page?.parent.remove(this.#page.object);
    this.#cssRenderer?.domElement.remove();
    this.#cssRenderer = null;
    this.#page = null;
  }

  /** True while the page is square enough to the reader to be readable. */
  isPageOpen(): boolean {
    const page = this.#page;
    if (!page) return false;
    const view = this.#views.get(page.notebookId);
    const open = view?.hinge ? Math.abs(view.hinge.rotation.y) : 0;
    const engaged = this.#store.state.active === page.notebookId
      || this.#siteFold?.id === page.notebookId;
    // Below half open the cover starts crossing the page, and the page cannot
    // be occluded by it, so it has to be gone before then.
    return engaged && open > Math.PI * 0.5;
  }

  /**
   * Plays the site's notebook between held-open and shelved.
   *
   * `-1` puts it away, which is the arrival animation: the shelf opens on the
   * notebook already open in front of the reader, page showing, and closes it
   * onto the shelf. Resolves when it lands, or on a timeout so a background tab
   * can never strand it.
   */
  /** Places the folding notebook at a given point between shelf and held-open. */
  #poseSiteFold(view: ItemView, progress: number): void {
    const p = progress * progress * (3 - 2 * progress);
    const position = new Vector3();
    const quaternion = new Quaternion();
    this.#activePose(view, position, quaternion);
    view.object.position.lerpVectors(view.restPosition, position, p);
    view.object.quaternion.copy(view.restQuaternion).slerp(quaternion, p);
    view.baseQuaternion.copy(view.object.quaternion);
    if (view.hinge) view.hinge.rotation.y = -Math.PI * 0.78 * p;
  }

  /** Releases a fold that was posed and held, letting it run. */
  releaseSiteFold(): void {
    if (this.#siteFold) this.#siteFold.hold = 0;
    this.#invalidate();
  }

  playSiteFold(id: string, direction: 1 | -1, holdSeconds?: number): Promise<void> {
    const view = this.#views.get(id);
    if (!view || this.#disposed) return Promise.resolve();

    return new Promise<void>(resolve => {
      let done = false;
      const settle = () => {
        if (done) return;
        done = true;
        resolve();
      };
      this.#siteFold = {
        id,
        progress: direction > 0 ? 0 : 1,
        direction,
        hold: holdSeconds ?? (direction < 0 ? SITE_FOLD_HOLD : 0),
        settle,
      };
      // Pose it now rather than on the next animation frame: callers render
      // immediately to find where the page has landed, and an unposed notebook
      // reports the page as shut.
      this.#poseSiteFold(view, this.#siteFold.progress);
      this.#animating.add(id);
      this.#invalidate();
      if (holdSeconds === undefined) {
        window.setTimeout(settle, (SITE_FOLD_SECONDS + SITE_FOLD_HOLD) * 1000 + 600);
      }
    });
  }

  /** Shows the page only while its notebook is open and turned to the reader. */
  #updatePage(): void {
    const page = this.#page;
    if (!page) return;
    // Visibility goes through the object, not the element: CSS3DRenderer
    // rewrites element.style.display and the element's transform on every
    // render, so anything set directly on the element is overwritten.
    page.object.visible = this.isPageOpen();
    if (this.#docked) page.element.style.display = '';
  }

  /** While docked the page has left the book and covers the viewport. */
  setPageDocked(docked: boolean): void {
    this.#docked = docked;
    this.#invalidate();
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

  /** Where a selected item parks: in front of the camera, turned to face the
   *  reader, offset clear of the card. */
  #activePose(view: ItemView, position: Vector3, quaternion: Quaternion): void {
    const vFov = (CAMERA_FOV * Math.PI) / 180;
    const frameHeight = 2 * Math.tan(vFov / 2) * view.closeUp;
    const frameWidth = frameHeight * this.#camera.aspect;
    position
      .set(frameWidth * view.closeUpShift.x, frameHeight * view.closeUpShift.y, -view.closeUp)
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

      // Mid-fold the notebook is driven straight off a clock, so the arrival
      // lands on an exact frame instead of easing in from wherever it was.
      const fold = this.#siteFold;
      if (fold && fold.id === id) {
        // Held open for a beat first, so the site on the inner page is actually
        // readable before the cover comes across it.
        if (fold.hold > 0) {
          fold.hold -= delta;
          this.#invalidate();
        }
        if (fold.hold <= 0) fold.progress = Math.min(1, Math.max(
          0,
          fold.progress + (delta / SITE_FOLD_SECONDS) * fold.direction,
        ));

        this.#poseSiteFold(view, fold.progress);

        if (fold.progress === (fold.direction > 0 ? 1 : 0)) {
          this.#siteFold = null;
          fold.settle();
          if (fold.direction < 0) settled.push(id);
        }
        continue;
      }

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

      // Notebooks open their cover only once they are turned toward the reader.
      if (view.hinge) {
        const openTo = isActive ? -Math.PI * 0.78 : 0;
        view.hinge.rotation.y += (openTo - view.hinge.rotation.y) * ease;
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
      const hingeSettled = !view.hinge
        || Math.abs(view.hinge.rotation.y - (isActive ? -Math.PI * 0.78 : 0)) < 0.001;

      if (positionSettled && rotationSettled && hingeSettled && !isActive) {
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
    this.#scene.traverse(object => {
      if (object instanceof Mesh) object.geometry.dispose();
    });
    this.#views.clear();
    this.#pickable = [];
    this.#renderer.dispose();
  }
}

interface ShelfRow<T extends ShelfItem = ShelfItem> {
  kind: 'album' | 'book' | 'notebook';
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
