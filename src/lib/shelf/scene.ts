/**
 * The /library scene: what Jody reads, plays and listens to, floating a page
 * at a time in front of a Miami morning.
 *
 * Owns the renderer, the backdrop, the objects, picking, paging and the move
 * that brings a picked item up to the reader. A page flies in from the right
 * and floats until something is picked; turning the page or changing what is
 * shown sends it off to the left as the next one comes in. Selection lives in
 * the ShelfStore, so the canvas and the semantic list beside it always agree.
 *
 * Browser only. Nothing here runs during the Astro build.
 */

import {
  BoxGeometry,
  Color,
  DirectionalLight,
  Euler,
  HemisphereLight,
  Material,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  Raycaster,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
// Postprocessing is pulled in after the first frame, so its parse cost and its
// shader compilation land once the room is already on screen. Types only here.
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import type { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { arcPose, arrange, DEFAULT_FILTER, pageOf, paginate } from './arc';
import type { LibraryFilter, Page } from './arc';
import type { GameSystem, ShelfAlbum, ShelfBook, ShelfGame, ShelfItem } from './media';
import { seededUnit } from './media';
import type { ShelfStore } from './scene-state';
import {
  albumBackTexture,
  artTexture,
  casePlastic,
  fallbackCoverTexture,
  fontsReady,
  gameCoverTexture,
  gameSpineTexture,
  loadImage,
  pageEdgeTexture,
  paletteFromImage,
  spineTexture,
} from './textures';

export interface ShelfPayload {
  albums: ShelfAlbum[];
  books: ShelfBook[];
  games: ShelfGame[];
}

export interface LibrarySceneOptions {
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  /** The filter column. The lane starts at its right edge. */
  rail?: HTMLElement | null;
  payload: ShelfPayload;
  store: ShelfStore;
  reducedMotion: boolean;
  /** What to show first, from the page's `?show=`. */
  filter?: LibraryFilter;
  /** Called whenever the page or the number of pages changes. */
  onPage?: (page: number, count: number) => void;
}

/* -- The room ------------------------------------------------------------- */

/**
 * The room is a photograph-like plate: concrete, a Miami sunset over the
 * water and a wet stone floor, made from the design mock with the objects
 * taken out. The camera below is set so the plate's horizon and the floor the
 * objects reflect in agree at desktop proportions.
 */
const BACKDROP = '/images/library/backdrop.webp';
const BACKDROP_ASPECT = 1536 / 1024;

const CAMERA_FOV = 30;
/** Low, a little over a metre off the wet floor, looking up at the arc. */
const CAMERA_Y = -0.9;
const LOOK_Y = 1.05;
const CAMERA_Z = 14;
/** Narrowest lane, in world units, a portrait phone is framed to show. */
const MIN_LANE = 4.4;
const MAX_CAMERA_Z = 19;
const FLOOR_Y = -2.6;
/** Height of the arc's lowest point, in the middle of the lane. */
const ARC_Y = 0.55;

/* -- The objects ------------------------------------------------------------ */

const BOOK_HEIGHT = 1.78;
const BOOK_ASPECT = 0.66;
const ALBUM_SIZE = 1.42;
const GAME_CASES: Record<GameSystem, { width: number; height: number; depth: number }> = {
  switch: { width: 1.1, height: 1.78, depth: 0.12 },
  ps5: { width: 1.41, height: 1.78, depth: 0.15 },
  other: { width: 1.41, height: 1.98, depth: 0.15 },
};
/** Space between neighbours on a page. */
const GAP = 0.2;
/** Share of the lane a page is packed into. The ends of the arc come forward
 *  and grow in perspective, so a page packed edge to edge runs off the screen. */
const PAGE_FILL = 0.86;

/** Faces with real art held on the GPU at once: this page, the next, and
 *  some of the pages already seen. The oldest go first. */
const FACE_BUDGET = 48;

/**
 * How each kind presents itself when picked: `fill` is the share of the frame
 * height it covers, `tilt` the turn layered on top of facing the reader so it
 * reads as an object in the hand and not a flat picture.
 */
const PRESENTATION: Record<ShelfItem['kind'], { fill: number; tilt: [number, number, number]; spinTurns: number }> = {
  album: { fill: 0.46, tilt: [0.05, 0.14, 0.015], spinTurns: 1 },
  book: { fill: 0.6, tilt: [0.07, 0.46, 0.04], spinTurns: 0 },
  game: { fill: 0.58, tilt: [0.05, 0.3, 0.02], spinTurns: 0 },
};
/** The picked item sits left of centre, clear of the card on the right, and a
 *  little high, clear of the pager and the Verso bar along the foot. */
const CLOSE_UP_SHIFT = { x: -0.14, y: 0.05 };

/* -- Timing ----------------------------------------------------------------- */

/** Seconds from pre-dawn to the full morning, while the first page flies in. */
const DAWN_SECONDS = 1.8;
/** An arriving page: when its first item sets off, the step between items,
 *  and how long each takes to glide in and settle. */
const ARRIVE_DELAY = 0.25;
const ARRIVE_STAGGER = 0.11;
const ARRIVE_SECONDS = 1.7;
/** The opening lets the light start coming up before anything moves. */
const OPENING_DELAY = 0.45;
/** A leaving page goes faster than one arrives: the eye is already on what is coming. */
const LEAVE_STAGGER = 0.045;
const LEAVE_SECONDS = 0.8;
/** Radians an item is turned edge-on while it flies, unwound as it lands. */
const FLIGHT_TURN = 0.95;
/** How long the opening waits on the first page's art before flying anyway. */
const ART_WAIT_MS = 1400;
const SPIN_SECONDS = 0.9;
/** Pixels of sideways travel that count as a swipe to the next page. */
const SWIPE = 48;

const Y_AXIS = new Vector3(0, 1, 0);

interface Flight {
  from: number;
  to: number;
  /** Seconds since the flight was scheduled; it moves once past `delay`. */
  elapsed: number;
  delay: number;
  duration: number;
  /** +1 travelling right to left, -1 left to right. */
  direction: number;
  leaving: boolean;
}

interface ItemView {
  item: ShelfItem;
  mesh: Mesh;
  width: number;
  height: number;
  /** The front face, where the art goes. */
  face: MeshStandardMaterial;
  /** Faces that warm up under the pointer. */
  lit: MeshStandardMaterial[];
  /** World x along the lane, before the arc is applied. */
  x: number;
  /** On the page being shown, or arriving on it. */
  onPage: boolean;
  /** Off screen and not on the page: nothing to draw. */
  parked: boolean;
  flight: Flight | null;
  hover: number;
  focus: number;
  spinElapsed: number;
  phase: number;
  jitter: { pitch: number; yaw: number; roll: number };
  art: 'none' | 'loading' | 'ready';
  /** Frame the item was last on screen, for evicting old art. */
  seen: number;
  /** Disposes whatever art the faces hold and returns them to plain stock. */
  release: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function jitter(seed: string, min: number, max: number): number {
  return min + seededUnit(seed) * (max - min);
}

/** Glides in and settles with the slightest overshoot, the way something
 *  floating in water comes to rest. */
function easeArrive(t: number): number {
  const c = 0.7;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

function easeLeave(t: number): number {
  return t * t * t;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/* -- Shaders ---------------------------------------------------------------- */

/**
 * The plate, cover-fitted to the screen. `uDawn` grades it from a pre-dawn
 * indigo, where only the brightest of the sky still reads, up to the full
 * morning. `uShift` slides it a touch against the head movement, so the
 * objects in front read as nearer than the room.
 */
const BACKDROP_SHADER = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 1.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tMap;
    uniform vec2 uScale;
    uniform vec2 uShift;
    uniform float uDawn;
    uniform float uReady;
    varying vec2 vUv;
    void main() {
      vec2 uv = (vUv - 0.5) * uScale + 0.5 + uShift;
      vec3 day = texture2D(tMap, uv).rgb;
      float light = dot(day, vec3(0.2126, 0.7152, 0.0722));
      // Linear-light indigo, with the sky's glow just showing through.
      vec3 night = vec3(0.004, 0.005, 0.03) + light * vec3(0.10, 0.05, 0.18);
      vec3 colour = mix(night, day, uDawn);
      // Before the plate has loaded, the night it fades up from.
      colour = mix(vec3(0.004, 0.005, 0.03), colour, uReady);
      gl_FragColor = vec4(colour, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};

/**
 * The wet floor, reflecting the objects only: the plate already has its own
 * reflections of the room. The mirror is rendered on a transparent ground, so
 * where nothing floats above it the plate shows through untouched. Softened
 * with a few taps and faded with distance, as polished stone does.
 */
const FLOOR_SHADER = {
  name: 'LibraryFloor',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uStrength: { value: 0 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    varying vec4 vUv;
    varying vec3 vWorld;
    void main() {
      vec2 step = vec2(0.003, 0.008) * vUv.w;
      vec4 reflection = texture2DProj(tDiffuse, vUv) * 0.32;
      reflection += texture2DProj(tDiffuse, vUv + vec4(0.0, step.y, 0.0, 0.0)) * 0.2;
      reflection += texture2DProj(tDiffuse, vUv - vec4(0.0, step.y, 0.0, 0.0)) * 0.2;
      reflection += texture2DProj(tDiffuse, vUv + vec4(step.x, 0.0, 0.0, 0.0)) * 0.14;
      reflection += texture2DProj(tDiffuse, vUv - vec4(step.x, 0.0, 0.0, 0.0)) * 0.14;
      float dist = length(vWorld.xz - cameraPosition.xz);
      float k = uStrength * smoothstep(40.0, 6.0, dist);
      // Premultiplied: the target was cleared to transparent black.
      gl_FragColor = reflection * k;
    }
  `,
};

export class LibraryScene {
  #renderer: WebGLRenderer;
  #scene = new Scene();
  #camera: PerspectiveCamera;
  #store: ShelfStore;
  #options: LibrarySceneOptions;

  #views = new Map<string, ItemView>();
  #order: ShelfItem[] = [];
  #filter: LibraryFilter = DEFAULT_FILTER;
  #pages: Page[] = [];
  #page = 0;

  #backdrop: Mesh<PlaneGeometry, ShaderMaterial> | null = null;
  #floor: Reflector | null = null;
  #key: DirectionalLight | null = null;
  #hemi: HemisphereLight | null = null;

  #raycaster = new Raycaster();
  #pointer = new Vector2(0, 0);
  #pointerInside = false;
  #parallax = new Vector2(0, 0);
  #parallaxTarget = new Vector2(0, 0);

  #halfWidth = 7;
  #laneCentre = 0;
  #laneWidth = 12;
  #visibleHeight = 8;

  #time = 0;
  /** Seconds into the opening; negative while it waits on the first page's art. */
  #intro = -1;
  #dawn = 0;
  #frameCount = 0;
  #raf = 0;
  #disposed = false;
  #onScreen = true;
  #unsubscribe: () => void = () => {};
  #cleanup: Array<() => void> = [];
  #lastActive: string | null = null;
  #reduced: boolean;

  #composer: EffectComposer | null = null;
  #bloom: UnrealBloomPass | null = null;

  /** Shared stock for every book's page block. */
  #pageEdges: MeshStandardMaterial | null = null;

  private constructor(options: LibrarySceneOptions, renderer: WebGLRenderer) {
    this.#options = options;
    this.#store = options.store;
    this.#renderer = renderer;
    this.#reduced = options.reducedMotion;
    this.#camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 400);
  }

  /**
   * Returns null when WebGL is unavailable, which leaves the semantic list as
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
      console.warn('[library] WebGL unavailable, keeping the semantic list.', error);
      return null;
    }

    const scene = new LibraryScene(options, renderer);
    try {
      scene.#build();
    } catch (error) {
      console.warn('[library] scene build failed, keeping the semantic list.', error);
      scene.dispose();
      return null;
    }
    return scene;
  }

  /* ---------------------------------------------------------------------- */
  /* Build                                                                   */
  /* ---------------------------------------------------------------------- */

  #build(): void {
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.#renderer.outputColorSpace = SRGBColorSpace;
    // Neutral keeps the pastels pastel. Filmic curves push a lilac sky grey
    // and a flamingo folio toward salmon.
    this.#renderer.toneMapping = NeutralToneMapping;

    this.#buildRoom();
    this.#buildItems();
    this.#filter = this.#options.filter ?? DEFAULT_FILTER;
    this.#order = arrange([...this.#views.values()].map(view => view.item), this.#filter);

    this.#resize();
    this.#bindEvents();
    this.#unsubscribe = this.#store.subscribe(() => this.#onStateChange());

    this.#setDawn(this.#reduced ? 1 : 0);
    this.#update(0);
    this.#draw();

    void this.#open();
    void this.#buildComposer().then(() => {
      if (!this.#disposed) this.#resize();
    });

    this.#loop();
  }

  /**
   * The opening: waits on the plate and the first page's art, or long enough,
   * then brings the morning up while the first page flies in.
   */
  async #open(): Promise<void> {
    const art = this.#pageViews(this.#page).map(view => this.#ensureArt(view));
    const plate = this.#loadBackdrop();
    await Promise.race([
      Promise.all([plate, ...art]),
      new Promise(resolve => setTimeout(resolve, ART_WAIT_MS)),
    ]);
    if (this.#disposed) return;
    this.#intro = 0;
    this.#show(this.#page, 1, this.#reduced);
    this.#preloadNext();
  }

  #loadBackdrop(): Promise<void> {
    return new Promise(resolve => {
      new TextureLoader().load(
        BACKDROP,
        texture => {
          if (this.#disposed) {
            texture.dispose();
            resolve();
            return;
          }
          texture.colorSpace = SRGBColorSpace;
          const material = this.#backdrop?.material;
          if (material) {
            material.uniforms.tMap.value = texture;
            material.uniforms.uReady.value = 1;
          }
          // The plate is also the light the objects are lit by: its peach and
          // lilac in their sheen, its sun in the clearcoat of the cases.
          const pmrem = new PMREMGenerator(this.#renderer);
          const environment = pmrem.fromEquirectangular(texture);
          pmrem.dispose();
          this.#scene.environment = environment.texture;
          this.#cleanup.push(() => {
            texture.dispose();
            environment.dispose();
          });
          resolve();
        },
        undefined,
        () => {
          console.warn('[library] backdrop failed to load.');
          resolve();
        },
      );
    });
  }

  #buildRoom(): void {
    const backdrop = new Mesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({
        uniforms: {
          tMap: { value: null as Texture | null },
          uScale: { value: new Vector2(1, 1) },
          uShift: { value: new Vector2(0, 0) },
          uDawn: { value: 0 },
          uReady: { value: 0 },
        },
        vertexShader: BACKDROP_SHADER.vertexShader,
        fragmentShader: BACKDROP_SHADER.fragmentShader,
        depthTest: false,
        depthWrite: false,
      }),
    );
    backdrop.renderOrder = -1;
    backdrop.frustumCulled = false;
    this.#scene.add(backdrop);
    this.#backdrop = backdrop;

    // Warm from the right, where the sun is in the plate, and a sky-and-floor
    // fill so the faces turned away from it never go dead.
    const key = new DirectionalLight(0xffdcc0, 1.9);
    key.position.set(9, 8, 10);
    this.#scene.add(key);
    this.#key = key;
    const hemi = new HemisphereLight(0xc6cdf4, 0xf2b38d, 0.55);
    this.#scene.add(hemi);
    this.#hemi = hemi;

    const floor = new Reflector(new PlaneGeometry(200, 200), {
      shader: FLOOR_SHADER,
      textureWidth: 512,
      textureHeight: 512,
      clipBias: 0.003,
      multisample: 0,
    });
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, FLOOR_Y, -60);
    const floorMaterial = floor.material as ShaderMaterial;
    floorMaterial.transparent = true;
    floorMaterial.premultipliedAlpha = true;
    floorMaterial.depthWrite = false;
    // The mirror sees only the objects: the plate is hidden and the target
    // cleared to transparent, so what the floor adds is their reflections.
    const reflect = floor.onBeforeRender.bind(floor);
    floor.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
      const clear = renderer.getClearAlpha();
      backdrop.visible = false;
      renderer.setClearAlpha(0);
      reflect(renderer, scene, camera, geometry, material, group);
      renderer.setClearAlpha(clear);
      backdrop.visible = true;
    };
    this.#scene.add(floor);
    this.#floor = floor;
    this.#cleanup.push(() => floor.dispose());
  }

  #buildItems(): void {
    const { payload } = this.#options;
    const edges = new MeshStandardMaterial({ map: pageEdgeTexture('library-pages'), roughness: 0.9 });
    this.#pageEdges = edges;
    this.#cleanup.push(() => {
      edges.map?.dispose();
      edges.dispose();
    });

    const all: ShelfItem[] = [...payload.books, ...payload.albums, ...payload.games];
    for (const item of all) this.#views.set(item.id, this.#buildItem(item));
  }

  #buildItem(item: ShelfItem): ItemView {
    switch (item.kind) {
      case 'book':
        return this.#buildBook(item);
      case 'album':
        return this.#buildAlbum(item);
      default:
        return this.#buildGame(item);
    }
  }

  /** Shared defaults for a new view; the builders fill in the rest. */
  #view(item: ShelfItem, mesh: Mesh, width: number, height: number, face: MeshStandardMaterial, lit: MeshStandardMaterial[], release: () => void): ItemView {
    mesh.userData.id = item.id;
    mesh.visible = false;
    this.#scene.add(mesh);
    return {
      item,
      mesh,
      width,
      height,
      face,
      lit,
      x: 0,
      onPage: false,
      parked: true,
      flight: null,
      hover: 0,
      focus: 0,
      spinElapsed: SPIN_SECONDS,
      phase: seededUnit(`${item.id}-phase`) * Math.PI * 2,
      jitter: {
        pitch: jitter(`${item.id}-pitch`, -0.1, 0.06),
        yaw: jitter(`${item.id}-yaw`, -0.14, 0.14),
        roll: jitter(`${item.id}-roll`, -0.2, 0.2),
      },
      art: 'none',
      seen: 0,
      release,
    };
  }

  #buildBook(book: ShelfBook): ItemView {
    const height = BOOK_HEIGHT;
    const width = height * BOOK_ASPECT;
    const depth = jitter(`${book.id}-depth`, 0.16, 0.34);
    const cloth = new Color(book.color);
    const face = new MeshStandardMaterial({ color: cloth, roughness: 0.62 });
    const spine = new MeshStandardMaterial({ color: cloth, roughness: 0.7 });
    const back = new MeshStandardMaterial({ color: cloth, roughness: 0.7 });
    const edges = this.#pageEdges as MeshStandardMaterial;
    const mesh = new Mesh(new BoxGeometry(width, height, depth), [edges, spine, edges, edges, face, back]);
    const release = () => {
      for (const material of [face, spine]) {
        material.map?.dispose();
        material.map = null;
        material.color.copy(cloth);
        material.needsUpdate = true;
      }
    };
    this.#cleanup.push(() => {
      release();
      face.dispose();
      spine.dispose();
      back.dispose();
    });
    return this.#view(book, mesh, width, height, face, [face, spine], release);
  }

  #buildAlbum(album: ShelfAlbum): ItemView {
    const size = ALBUM_SIZE;
    const depth = size * 0.07;
    const plastic = new MeshPhysicalMaterial({
      color: new Color('#1d1b26'),
      roughness: 0.2,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    });
    const sleeve = { roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04 };
    const face = new MeshPhysicalMaterial({ ...sleeve, color: new Color(album.color) });
    const back = new MeshPhysicalMaterial({ ...sleeve, color: new Color('#e8e4da') });
    const mesh = new Mesh(new BoxGeometry(size, size, depth), [plastic, plastic, plastic, plastic, face, back]);
    const release = () => {
      for (const material of [face, back]) {
        material.map?.dispose();
        material.map = null;
        material.needsUpdate = true;
      }
      face.color.set(album.color);
    };
    this.#cleanup.push(() => {
      release();
      face.dispose();
      back.dispose();
      plastic.dispose();
    });
    return this.#view(album, mesh, size, size, face, [face], release);
  }

  #buildGame(game: ShelfGame): ItemView {
    const { width, height, depth } = GAME_CASES[game.system];
    const plastic = new MeshPhysicalMaterial({
      color: new Color(casePlastic(game.system)),
      roughness: 0.34,
      clearcoat: 0.6,
      clearcoatRoughness: 0.12,
    });
    const sleeve = { roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.03 };
    const face = new MeshPhysicalMaterial({ ...sleeve, map: gameCoverTexture(game, width / height) });
    const spine = new MeshPhysicalMaterial({ ...sleeve, map: gameSpineTexture(game, height / depth) });
    const mesh = new Mesh(new BoxGeometry(width, height, depth), [plastic, spine, plastic, plastic, face, plastic]);
    // A case without its box art still prints its title, so release redraws
    // that rather than leaving a blank.
    const release = () => {
      face.map?.dispose();
      face.map = gameCoverTexture(game, width / height);
      face.needsUpdate = true;
    };
    this.#cleanup.push(() => {
      face.map?.dispose();
      face.dispose();
      spine.map?.dispose();
      spine.dispose();
      plastic.dispose();
    });
    return this.#view(game, mesh, width, height, face, [face, spine], release);
  }

  /* ---------------------------------------------------------------------- */
  /* Art                                                                     */
  /* ---------------------------------------------------------------------- */

  /**
   * Loads and prints an item's faces. Jackets, sleeves and folio covers only
   * reach the GPU for the page in view and the one after it, and are released
   * again by #evictArt once the budget is spent.
   */
  #ensureArt(view: ItemView): Promise<void> {
    view.seen = this.#frameCount;
    if (view.art !== 'none') return Promise.resolve();
    view.art = 'loading';
    const item = view.item;

    const apply = (paint: (image: HTMLImageElement | null) => void) => async () => {
      const image = item.cover ? await loadImage(item.cover) : null;
      // Spines and case bands are set in the webfonts.
      await fontsReady();
      // Released or torn down while loading: nothing to print onto.
      if (this.#disposed || view.art !== 'loading') return;
      paint(image);
      view.art = 'ready';
    };

    const run = (() => {
      switch (item.kind) {
        case 'book':
          return apply(image => {
            const [face, spine] = view.lit;
            face.map = image ? artTexture(image, 640) : fallbackCoverTexture(item);
            face.color.set(0xffffff);
            face.needsUpdate = true;
            const depth = (view.mesh.geometry as BoxGeometry).parameters.depth;
            spine.map = spineTexture(item, view.height / depth, image ? paletteFromImage(image) ?? undefined : undefined);
            spine.color.set(0xffffff);
            spine.needsUpdate = true;
            // Jackets are not all the same shape. Matching the real one is
            // what keeps a cover from looking stretched over the board.
            if (image) {
              const aspect = image.naturalWidth / image.naturalHeight;
              view.mesh.scale.x = clamp(aspect / BOOK_ASPECT, 0.85, 1.15);
            }
          });
        case 'album':
          return apply(image => {
            view.face.map = image ? artTexture(image, 640) : fallbackCoverTexture(item);
            view.face.color.set(0xffffff);
            view.face.needsUpdate = true;
            const back = (view.mesh.material as Material[])[5] as MeshStandardMaterial;
            back.map = albumBackTexture(item);
            back.needsUpdate = true;
          });
        default:
          return apply(image => {
            view.face.map?.dispose();
            view.face.map = gameCoverTexture(item, view.width / view.height, image);
            view.face.needsUpdate = true;
          });
      }
    })();

    return run().catch(error => {
      console.warn('[library] art failed to load', item.id, error);
      view.art = 'none';
    });
  }

  /** Lets go of the art seen longest ago once more is held than the budget. */
  #evictArt(): void {
    const held = [...this.#views.values()].filter(view => view.art === 'ready' && !view.onPage && view.focus === 0);
    const total = [...this.#views.values()].filter(view => view.art === 'ready').length;
    if (total <= FACE_BUDGET) return;
    held.sort((a, b) => a.seen - b.seen);
    for (const view of held.slice(0, total - FACE_BUDGET)) {
      view.release();
      view.mesh.scale.x = 1;
      view.art = 'none';
    }
  }

  /** The next page's art, so turning to it never shows blank stock. */
  #preloadNext(): void {
    for (const view of this.#pageViews(this.#page + 1)) void this.#ensureArt(view);
  }

  /* ---------------------------------------------------------------------- */
  /* Pages                                                                   */
  /* ---------------------------------------------------------------------- */

  #pageViews(page: number): ItemView[] {
    const bounds = this.#pages[page];
    if (!bounds) return [];
    return this.#order.slice(bounds.start, bounds.end).map(item => this.#views.get(item.id)!);
  }

  get page(): number {
    return this.#page;
  }

  get pageCount(): number {
    return this.#pages.length;
  }

  /** Ordered ids under the current filter, for stepping with the arrow keys. */
  get order(): string[] {
    return this.#order.map(item => item.id);
  }

  /** Turns to a page. Forward pages come in from the right; going back, from the left. */
  goToPage(page: number): void {
    const target = clamp(Math.round(page), 0, Math.max(0, this.#pages.length - 1));
    if (target === this.#page || this.#intro < 0) return;
    this.#store.dispatch({ type: 'dismiss' });
    const direction = target > this.#page ? 1 : -1;
    this.#page = target;
    this.#show(target, direction, this.#reduced);
    this.#preloadNext();
    this.#options.onPage?.(this.#page, this.#pages.length);
  }

  /** Shows one kind, or everything, from its first page. */
  setFilter(filter: LibraryFilter): void {
    if (filter === this.#filter) return;
    this.#store.dispatch({ type: 'dismiss' });
    this.#filter = filter;
    this.#order = arrange([...this.#views.values()].map(view => view.item), filter);
    this.#paginate();
    this.#page = 0;
    if (this.#intro >= 0) {
      this.#show(0, 1, this.#reduced);
      this.#preloadNext();
    }
    this.#options.onPage?.(this.#page, this.#pages.length);
  }

  /** Turns to the page holding an item, so a keyboard step never lands off screen. */
  reveal(id: string): void {
    const index = this.#order.findIndex(item => item.id === id);
    if (index !== -1) this.goToPage(pageOf(this.#pages, index));
  }

  /** Public entry used by the semantic list when one of its links takes focus. */
  focus(id: string): void {
    this.reveal(id);
    if (this.#views.get(id)?.onPage) this.#store.dispatch({ type: 'hover', id });
  }

  #paginate(): void {
    this.#pages = paginate(this.#order.map(item => this.#views.get(item.id)!.width), GAP, this.#laneWidth * PAGE_FILL);
  }

  /** Where a leaving item flies to, or an arriving one from: just off screen. */
  #offstage(view: ItemView, side: number, rank: number): number {
    return this.#laneCentre + side * (this.#halfWidth + this.#laneWidth * 0.15 + view.width + rank * 0.5);
  }

  /**
   * Sends the page in view off and brings `page` on. With `direction` 1 the
   * old page leaves to the left and the new one arrives from the right, its
   * leftmost item first, so the row draws itself across the screen the way it
   * reads. `instant` skips the flight, for reduced motion and for resizes.
   */
  #show(page: number, direction: number, instant: boolean): void {
    const bounds = this.#pages[page];
    const arriving = this.#pageViews(page);
    const arrivingSet = new Set(arriving);

    // Leaving: whatever is on screen and not on the new page.
    const leaving = [...this.#views.values()]
      .filter(view => view.onPage && !arrivingSet.has(view))
      .sort((a, b) => direction * (a.x - b.x));
    leaving.forEach((view, rank) => {
      view.onPage = false;
      if (instant) {
        view.flight = null;
        view.parked = true;
        return;
      }
      view.flight = {
        from: view.x,
        to: this.#offstage(view, -direction, rank),
        elapsed: 0,
        delay: rank * LEAVE_STAGGER,
        duration: LEAVE_SECONDS,
        direction,
        leaving: true,
      };
    });

    // Arriving, leading edge first.
    const ranked = arriving
      .map((view, index) => ({ view, to: this.#laneCentre + (bounds?.centres[index] ?? 0) }))
      .sort((a, b) => direction * (a.to - b.to));
    const outgoing = leaving.length > 0 && !instant;
    ranked.forEach(({ view, to }, rank) => {
      void this.#ensureArt(view);
      const already = view.onPage && !view.parked;
      view.onPage = true;
      view.parked = false;
      if (instant) {
        view.flight = null;
        view.x = to;
        return;
      }
      view.flight = {
        from: already ? view.x : this.#offstage(view, direction, rank),
        to,
        elapsed: 0,
        delay: (outgoing ? ARRIVE_DELAY : this.#intro < OPENING_DELAY ? OPENING_DELAY : 0.05) + rank * ARRIVE_STAGGER,
        duration: ARRIVE_SECONDS,
        direction,
        leaving: false,
      };
      if (!already) view.x = view.flight.from;
    });
  }

  #resize(): void {
    const { stage, rail } = this.#options;
    const width = stage.clientWidth || window.innerWidth;
    const height = stage.clientHeight || window.innerHeight;

    this.#renderer.setSize(width, height, false);
    this.#composer?.setPixelRatio(this.#renderer.getPixelRatio());
    this.#composer?.setSize(width, height);
    this.#bloom?.setSize(width, height);
    const ratio = this.#renderer.getPixelRatio();
    this.#floor?.getRenderTarget().setSize(Math.round(width * ratio * 0.5), Math.round(height * ratio * 0.5));

    const aspect = width / height;
    this.#camera.aspect = aspect;
    const tan = Math.tan((CAMERA_FOV * Math.PI) / 360);
    // A portrait phone pulls back until a usable stretch of the lane fits.
    const distance = clamp(MIN_LANE / (2 * tan * aspect), CAMERA_Z, MAX_CAMERA_Z);
    this.#camera.position.set(0, CAMERA_Y, distance);
    this.#camera.updateProjectionMatrix();

    this.#visibleHeight = 2 * tan * distance;
    this.#halfWidth = (this.#visibleHeight * aspect) / 2;
    const worldPerPixel = this.#visibleHeight / height;

    // Cover-fit the plate.
    const scale = this.#backdrop?.material.uniforms.uScale.value as Vector2 | undefined;
    if (scale) {
      if (aspect > BACKDROP_ASPECT) scale.set(1, BACKDROP_ASPECT / aspect);
      else scale.set(aspect / BACKDROP_ASPECT, 1);
    }

    // The lane runs from just right of the filter column to the right edge.
    // On phones the filters are a row under the nav and the lane takes the width.
    const railBox = rail?.offsetParent ? rail.getBoundingClientRect() : null;
    const railRight = railBox && railBox.width < width * 0.5 ? railBox.right - stage.getBoundingClientRect().left : 0;
    const left = (railRight > 0 ? railRight + 48 : 16) * worldPerPixel;
    const right = 32 * worldPerPixel;
    const laneLeft = -this.#halfWidth + left;
    this.#laneWidth = Math.max(1, this.#halfWidth * 2 - left - right);
    this.#laneCentre = laneLeft + this.#laneWidth / 2;

    // Keep the first item of the page in view on the page after the resize.
    const first = this.#pages[this.#page]?.start ?? 0;
    const count = this.#pages.length;
    this.#paginate();
    this.#page = pageOf(this.#pages, first);
    if (this.#intro >= 0) this.#show(this.#page, 1, true);
    if (count !== this.#pages.length) this.#options.onPage?.(this.#page, this.#pages.length);
  }

  /* ---------------------------------------------------------------------- */
  /* Interaction                                                             */
  /* ---------------------------------------------------------------------- */

  #bindEvents(): void {
    const { canvas, stage } = this.#options;

    const onResize = () => this.#resize();

    // A sideways swipe or trackpad gesture turns the page. The canvas keeps
    // `touch-action: pan-y`, so vertical swipes stay a native page scroll.
    let swipeFrom: { x: number; y: number } | null = null;
    let swiped = false;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      swipeFrom = { x: event.clientX, y: event.clientY };
      swiped = false;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!swipeFrom) return;
      const dx = event.clientX - swipeFrom.x;
      const dy = event.clientY - swipeFrom.y;
      swipeFrom = null;
      if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy) * 1.4) {
        swiped = true;
        this.goToPage(this.#page + (dx < 0 ? 1 : -1));
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      this.#pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      this.#parallaxTarget.copy(this.#pointer);
      this.#pointerInside = true;
    };
    const onPointerLeave = () => {
      this.#pointerInside = false;
      this.#parallaxTarget.set(0, 0);
      this.#store.dispatch({ type: 'hover', id: null });
      canvas.style.cursor = '';
    };
    const onClick = (event: MouseEvent) => {
      // A swipe that ends over something is not a click on it.
      if (swiped) {
        swiped = false;
        return;
      }
      const id = this.#pick(event.clientX, event.clientY);
      if (id) this.#store.dispatch({ type: 'activate', id });
      else this.#store.dispatch({ type: 'dismiss' });
    };

    let wheel = 0;
    let wheelLock = 0;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      if (performance.now() < wheelLock) return;
      wheel += event.deltaX;
      if (Math.abs(wheel) > 60) {
        this.goToPage(this.#page + Math.sign(wheel));
        wheel = 0;
        // One gesture, one page: a trackpad keeps sending deltas for a while.
        wheelLock = performance.now() + 700;
      }
    };

    // Stop drawing while the stage is scrolled away under the footer.
    const observer = new IntersectionObserver(entries => {
      this.#onScreen = entries.some(entry => entry.isIntersecting);
    });
    observer.observe(stage);

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('resize', onResize);

    this.#cleanup.push(() => {
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('resize', onResize);
    });
  }

  #pick(clientX: number, clientY: number): string | null {
    const rect = this.#options.canvas.getBoundingClientRect();
    const point = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    return this.#hit(point);
  }

  #hit(point: Vector2): string | null {
    this.#raycaster.setFromCamera(point, this.#camera);
    const targets: Object3D[] = [];
    for (const view of this.#views.values()) {
      // Only what has landed: nothing still flying in or out.
      if (view.onPage && !view.flight && view.mesh.visible) targets.push(view.mesh);
    }
    const hit = this.#raycaster.intersectObjects(targets, false)[0];
    const id = hit?.object.userData.id;
    return typeof id === 'string' ? id : null;
  }

  #hoverTest(): void {
    if (!this.#pointerInside) return;
    const id = this.#hit(this.#pointer);
    this.#options.canvas.style.cursor = id ? 'pointer' : '';
    this.#store.dispatch({ type: 'hover', id });
  }

  #onStateChange(): void {
    const { active } = this.#store.state;
    if (active && active !== this.#lastActive) {
      const view = this.#views.get(active);
      if (view) {
        view.spinElapsed = 0;
        void this.#ensureArt(view);
      }
    }
    this.#lastActive = active;
  }

  /* ---------------------------------------------------------------------- */
  /* Animation                                                               */
  /* ---------------------------------------------------------------------- */

  #setDawn(dawn: number): void {
    this.#dawn = dawn;
    if (this.#backdrop) this.#backdrop.material.uniforms.uDawn.value = dawn;
    if (this.#floor) (this.#floor.material as ShaderMaterial).uniforms.uStrength.value = 0.45 * dawn;
    const light = 0.08 + 0.92 * dawn;
    if (this.#key) this.#key.intensity = 1.9 * light;
    if (this.#hemi) this.#hemi.intensity = 0.55 * light;
    this.#scene.environmentIntensity = 0.1 + 0.5 * dawn;
    if (this.#bloom) this.#bloom.strength = 0.22 * dawn;
  }

  /** Where a picked item parks: in front of the camera, turned to the
   *  reader, shifted clear of the card. */
  #closeUp(view: ItemView, position: Vector3, quaternion: Quaternion): void {
    const look = PRESENTATION[view.item.kind];
    const tan = Math.tan((CAMERA_FOV * Math.PI) / 360);
    const byHeight = view.height / (2 * tan * look.fill);
    const byWidth = (view.width * 1.3) / (2 * tan * look.fill * this.#camera.aspect);
    const distance = Math.max(byHeight, byWidth);
    const frameHeight = 2 * tan * distance;
    position
      .set(frameHeight * this.#camera.aspect * CLOSE_UP_SHIFT.x, frameHeight * CLOSE_UP_SHIFT.y, -distance)
      .applyQuaternion(this.#camera.quaternion)
      .add(this.#camera.position);
    quaternion.copy(this.#camera.quaternion).multiply(
      new Quaternion().setFromEuler(new Euler(look.tilt[0], look.tilt[1], look.tilt[2])),
    );
  }

  #update(delta: number): void {
    this.#time += delta;

    if (this.#intro >= 0 && this.#intro < DAWN_SECONDS + 1 && !this.#reduced) {
      this.#intro += delta;
      this.#setDawn(easeInOut(clamp(this.#intro / DAWN_SECONDS, 0, 1)));
    }

    // Head movement: the camera drifts with the pointer and the plate drifts
    // a little less, which is what puts the objects in front of the room.
    if (!this.#reduced) this.#parallax.lerp(this.#parallaxTarget, 1 - Math.pow(0.02, delta));
    const camera = this.#camera;
    camera.position.x = this.#parallax.x * 0.35;
    camera.position.y = CAMERA_Y + this.#parallax.y * 0.18;
    camera.lookAt(this.#parallax.x * 0.12, LOOK_Y, 0);
    camera.updateMatrixWorld();
    (this.#backdrop?.material.uniforms.uShift.value as Vector2 | undefined)?.set(this.#parallax.x * 0.006, this.#parallax.y * 0.004);

    const { hovered, active } = this.#store.state;
    const ease = this.#reduced ? 1 : 1 - Math.pow(0.004, delta);
    const restPosition = new Vector3();
    const restQuaternion = new Quaternion();
    const closePosition = new Vector3();
    const closeQuaternion = new Quaternion();
    const euler = new Euler();
    const spin = new Quaternion();
    const halfLane = this.#laneWidth / 2;

    for (const view of this.#views.values()) {
      view.hover += ((hovered === view.item.id && active !== view.item.id ? 1 : 0) - view.hover) * ease;
      view.focus += ((active === view.item.id ? 1 : 0) - view.focus) * (this.#reduced ? 1 : 1 - Math.pow(0.0015, delta));
      if (view.focus < 0.0005) view.focus = 0;

      // Flight: along the lane, turned edge-on, lifting a little mid-air.
      let turn = 0;
      let lift = 0;
      const flight = view.flight;
      if (flight) {
        flight.elapsed += delta;
        const t = clamp((flight.elapsed - flight.delay) / flight.duration, 0, 1);
        const travel = flight.leaving ? easeLeave(t) : easeArrive(t);
        view.x = flight.from + (flight.to - flight.from) * travel;
        // An arriving item comes in turned and straightens as it lands; a
        // leaving one turns away as it goes. Both turn into their direction of travel.
        turn = (flight.leaving ? t : 1 - Math.min(1, travel)) * FLIGHT_TURN * flight.direction;
        lift = Math.sin(Math.min(1, t) * Math.PI) * 0.18;
        if (t >= 1) {
          view.flight = null;
          if (flight.leaving) view.parked = true;
        }
      }

      if (view.parked && view.focus === 0) {
        view.mesh.visible = false;
        continue;
      }
      view.mesh.visible = true;
      view.seen = this.#frameCount;

      const arc = arcPose(view.x - this.#laneCentre, halfLane);
      const bob = this.#reduced ? 0 : Math.sin(this.#time * 0.7 + view.phase) * 0.06;
      restPosition.set(view.x, ARC_Y + arc.y + bob + lift + view.hover * 0.12, arc.z + view.hover * 0.7);

      const sway = this.#reduced ? 0 : Math.sin(this.#time * 0.45 + view.phase * 1.7) * 0.025;
      const straighten = 1 - view.hover * 0.55;
      euler.set(
        view.jitter.pitch * straighten,
        arc.yaw + view.jitter.yaw * straighten + turn,
        (view.jitter.roll + sway) * straighten,
      );
      restQuaternion.setFromEuler(euler);

      if (view.focus > 0) {
        this.#closeUp(view, closePosition, closeQuaternion);
        const f = easeInOut(clamp(view.focus, 0, 1));
        view.mesh.position.lerpVectors(restPosition, closePosition, f);
        view.mesh.quaternion.slerpQuaternions(restQuaternion, closeQuaternion, f);
        // A jewel case turns all the way round on the way in.
        const turns = PRESENTATION[view.item.kind].spinTurns;
        if (active === view.item.id && turns > 0 && !this.#reduced) {
          view.spinElapsed = Math.min(SPIN_SECONDS, view.spinElapsed + delta);
          const t = view.spinElapsed / SPIN_SECONDS;
          const angle = Math.pow(1 - t, 3) * Math.PI * 2 * turns;
          view.mesh.quaternion.multiply(spin.setFromAxisAngle(Y_AXIS, angle));
        }
      } else {
        view.mesh.position.copy(restPosition);
        view.mesh.quaternion.copy(restQuaternion);
      }

      // Kept low: emissive lifts blacks, and art goes grey long before the
      // highlight reads as lit.
      const glow = view.hover * 0.06;
      for (const material of view.lit) material.emissive.setScalar(glow);
    }

    this.#frameCount += 1;
    if (this.#frameCount % 30 === 0) this.#evictArt();
    this.#hoverTest();
  }

  #draw(): void {
    if (this.#composer) this.#composer.render();
    else this.#renderer.render(this.#scene, this.#camera);
  }

  /** Advances by `delta` seconds and draws, for tests that want a frame
   *  without racing the animation loop. */
  step(delta: number): void {
    this.#update(delta);
    this.#draw();
  }

  /**
   * Bloom on the sun and the brightest sheen, then grain and falloff, so the
   * objects sit in the same photograph as the plate behind them. If the
   * passes will not build, the scene draws straight to the canvas instead.
   */
  async #buildComposer(): Promise<void> {
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }, { ShaderPass }] = await Promise.all([
        import('three/examples/jsm/postprocessing/EffectComposer.js'),
        import('three/examples/jsm/postprocessing/RenderPass.js'),
        import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
        import('three/examples/jsm/postprocessing/OutputPass.js'),
        import('three/examples/jsm/postprocessing/ShaderPass.js'),
      ]);
      if (this.#disposed) return;

      const composer = new EffectComposer(this.#renderer);
      composer.addPass(new RenderPass(this.#scene, this.#camera));
      const bloom = new UnrealBloomPass(new Vector2(256, 256), 0.22 * this.#dawn, 0.7, 0.9);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      composer.addPass(new ShaderPass({
        uniforms: {
          tDiffuse: { value: null },
          uVignette: { value: 0.28 },
          uGrain: { value: 0.025 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D tDiffuse;
          uniform float uVignette;
          uniform float uGrain;
          varying vec2 vUv;
          void main() {
            vec4 colour = texture2D(tDiffuse, vUv);
            vec2 offset = vUv - 0.5;
            colour.rgb *= 1.0 - dot(offset, offset) * uVignette;
            float n = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
            colour.rgb += (n - 0.5) * uGrain;
            gl_FragColor = colour;
          }
        `,
      }));

      this.#composer = composer;
      this.#bloom = bloom;
      this.#cleanup.push(() => {
        bloom.dispose();
        composer.dispose();
      });
    } catch (error) {
      console.warn('[library] postprocessing unavailable, drawing directly.', error);
      this.#composer = null;
      this.#bloom = null;
    }
  }

  #loop(): void {
    let last = performance.now();
    const tick = (now: number) => {
      if (this.#disposed) return;
      this.#raf = requestAnimationFrame(tick);
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (document.hidden || !this.#onScreen) return;
      this.#update(delta);
      this.#draw();
    };
    this.#raf = requestAnimationFrame(tick);
    this.#cleanup.push(() => cancelAnimationFrame(this.#raf));
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribe();
    for (const teardown of this.#cleanup.splice(0)) {
      try {
        teardown();
      } catch {
        /* teardown is best effort */
      }
    }
    this.#scene.traverse(object => {
      if (object instanceof Mesh) object.geometry.dispose();
    });
    this.#backdrop?.material.dispose();
    this.#views.clear();
    this.#renderer.dispose();
  }
}
