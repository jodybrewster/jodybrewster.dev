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
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
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
/** Solid band across the top of the unit, carrying the nameplate. */
const CROWN_HEIGHT = 1.0;

const ALBUM_SIZE = 1.2;
/** A real jewel case is 142mm across and 10mm deep, so depth is 0.07 of width. */
const ALBUM_CASE_DEPTH = ALBUM_SIZE * 0.07;
const ALBUM_ROW_HEIGHT = ALBUM_SIZE + 0.32;
const ALBUMS_PER_ROW = 9;

const NOTEBOOK_ROW_HEIGHT = 2.32;
const BOOK_ROW_HEIGHT = 3.16;

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

  #composer: EffectComposer | null = null;
  #gtao: GTAOPass | null = null;
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
    this.#renderer.toneMappingExposure = 0.96;
    this.#renderer.shadowMap.enabled = true;
    this.#renderer.shadowMap.type = PCFSoftShadowMap;

    this.#scene.add(this.#unit);
    this.#addLights();

    const rows = this.#planRows(payload);
    this.#buildFrame(rows);
    this.#buildRows(rows);

    this.#buildComposer();
    this.#resize();
    this.#bindEvents();
    this.#unsubscribe = this.#store.subscribe(() => this.#onStateChange());

    // Paint the first frame here rather than waiting on the first animation
    // frame, so the shelf is on screen the moment the scene is ready.
    this.render();

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
  #buildComposer(): void {
    try {
      const composer = new EffectComposer(this.#renderer);
      composer.addPass(new RenderPass(this.#scene, this.#camera));

      const gtao = new GTAOPass(this.#scene, this.#camera, 1, 1);
      // Radius is world units: a book is ~0.3 thick and shelves are ~2 deep,
      // so this catches book-to-board and book-to-book contact without
      // smearing shadow across whole boards.
      gtao.updateGtaoMaterial({
        radius: 0.42,
        distanceExponent: 1.4,
        thickness: 0.6,
        scale: 1.1,
        samples: 16,
        screenSpaceRadius: false,
      });
      gtao.blendIntensity = 0.92;
      composer.addPass(gtao);

      // Applies the renderer's tone mapping and sRGB conversion at the end.
      composer.addPass(new OutputPass());

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
    this.#scene.environmentIntensity = 0.95;

    // One lamp remains, and it stays strong: the environment supplies bounce
    // and reflection, but without a dominant key the shelves lose the shadow
    // under each board that makes the niches read as deep.
    const key = new DirectionalLight(0xffeccd, 1.35);
    key.position.set(-5.5, 7.5, 16);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 5;
    this.#scene.add(key);
    this.#scene.add(key.target);
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
    const wood = new MeshStandardMaterial({ map: grainH, roughness: 0.72, metalness: 0.02 });
    const woodUpright = new MeshStandardMaterial({ map: grainV, roughness: 0.72, metalness: 0.02 });
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
        new BoxGeometry(SIDE_THICKNESS, outerHeight, INTERIOR_DEPTH),
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
    const crown = new Mesh(new BoxGeometry(outerWidth, CROWN_HEIGHT, INTERIOR_DEPTH), wood);
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
    const board = new Mesh(new BoxGeometry(width, BOARD_THICKNESS, INTERIOR_DEPTH), material);
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

      const spine = spineTexture(book, height / thickness);
      const spineMaterial = new MeshStandardMaterial({ map: spine, roughness: 0.82 });
      this.#spines.set(book.id, { book, material: spineMaterial, aspect: height / thickness });
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
        spine.dispose();
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

    if (this.#reduced) {
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
        // Parked in front of the camera, so it stays framed while the reader
        // keeps scrolling.
        const vFov = (CAMERA_FOV * Math.PI) / 180;
        const frameHeight = 2 * Math.tan(vFov / 2) * view.closeUp;
        const frameWidth = frameHeight * this.#camera.aspect;
        targetPosition
          .set(frameWidth * view.closeUpShift.x, frameHeight * view.closeUpShift.y, -view.closeUp)
          .applyQuaternion(this.#camera.quaternion)
          .add(this.#camera.position);
        targetQuaternion.copy(this.#camera.quaternion).multiply(view.activeSpin);
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
    entry.material.needsUpdate = true;
  }

  #refreshTextTextures(): void {
    // Spines were drawn before the webfonts resolved. Redrawing is cheaper than
    // blocking first paint on fonts.
    for (const id of this.#spines.keys()) this.#redrawSpine(id);
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
