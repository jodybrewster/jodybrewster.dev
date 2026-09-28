/**
 * Canvas-drawn textures for the shelf.
 *
 * Everything the scene shows is generated here except real album art, book
 * jackets and game box art, which load from the local cache in public/media.
 * Drawing the wood, spines, plaques and game cases keeps the page free of
 * binary texture downloads and lets every surface inherit the site's palette.
 *
 * Browser only: each function touches document/canvas.
 */

import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three';
import type { GameSystem, ShelfAlbum, ShelfBook, ShelfGame } from './media';
import { seededUnit } from './media';

const DISPLAY = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const SANS = '"Inter", -apple-system, system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';

const INK = '#14181d';

function canvas(width: number, height: number) {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  const ctx = element.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
  return { element, ctx };
}

function toTexture(element: HTMLCanvasElement, anisotropy = 4): CanvasTexture {
  const texture = new CanvasTexture(element);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** Deterministic 0..1 stream so a given seed always draws the same grain. */
function noise(seed: string) {
  let n = seededUnit(seed) * 1000;
  return () => {
    n = (n * 9301 + 49297) % 233280;
    return n / 233280;
  };
}

function shade(hex: string, amount: number): string {
  const value = hex.replace('#', '');
  const num = parseInt(value, 16);
  const clamp = (channel: number) => Math.max(0, Math.min(255, Math.round(channel)));
  const r = clamp(((num >> 16) & 255) * amount);
  const g = clamp(((num >> 8) & 255) * amount);
  const b = clamp((num & 255) * amount);
  return `rgb(${r}, ${g}, ${b})`;
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);

  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    if (ctx.measureText(last).width > maxWidth) {
      while (last.length > 1 && ctx.measureText(`${last}...`).width > maxWidth) {
        last = last.slice(0, -1);
      }
      lines[maxLines - 1] = `${last}...`;
    }
  }
  return lines;
}

/** Shrinks the font until the string fits, rather than truncating it. */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startSize: number,
  minSize: number,
  font: (size: number) => string,
): number {
  let size = startSize;
  ctx.font = font(size);
  while (size > minSize && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.font = font(size);
  }
  return size;
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}...`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}...`;
}

/* -------------------------------------------------------------------------- */
/* Wood                                                                        */
/* -------------------------------------------------------------------------- */

/* -- Procedural noise, shared by the wood and the wallpaper ---------------- */

function hash2(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

function fbm(x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i += 1) {
    sum += valueNoise(x * freq, y * freq) * amp;
    freq *= 2;
    amp *= 0.5;
  }
  return sum;
}

/**
 * Pale birch. Grain runs along the canvas X axis; callers rotate UVs for the
 * vertical members so the grain follows the length of each board.
 */
export function woodTexture(seed: string, repeatX = 1, repeatY = 1): CanvasTexture {
  const { element, ctx } = canvas(1024, 256);
  const random = noise(seed);

  const base = ctx.createLinearGradient(0, 0, 0, 256);
  base.addColorStop(0, '#e9d5b0');
  base.addColorStop(0.45, '#e2caa1');
  base.addColorStop(1, '#d8bd92');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 1024, 256);

  // Long grain lines with a slow vertical wander.
  for (let i = 0; i < 90; i += 1) {
    const y = random() * 256;
    const amplitude = 1 + random() * 5;
    const period = 180 + random() * 420;
    const phase = random() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 1024; x += 8) {
      ctx.lineTo(x, y + Math.sin(x / period + phase) * amplitude);
    }
    ctx.strokeStyle = `rgba(146, 108, 62, ${0.03 + random() * 0.09})`;
    ctx.lineWidth = 0.6 + random() * 1.8;
    ctx.stroke();
  }

  // A couple of soft knots so the boards are not perfectly uniform.
  for (let i = 0; i < 3; i += 1) {
    const cx = random() * 1024;
    const cy = random() * 256;
    const radius = 10 + random() * 26;
    const knot = ctx.createRadialGradient(cx, cy, 1, cx, cy, radius);
    knot.addColorStop(0, 'rgba(132, 94, 52, 0.28)');
    knot.addColorStop(1, 'rgba(132, 94, 52, 0)');
    ctx.fillStyle = knot;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius * 1.9, radius, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = toTexture(element, 8);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  return texture;
}

/**
 * Blue wallpaper for the wall behind the unit: tonal stripes with a small
 * repeating lattice motif. Deliberately low contrast so it reads as a room
 * rather than competing with the album art.
 */
export function wallpaperTexture(): CanvasTexture {
  const size = 512;
  const { element, ctx } = canvas(size, size);

  ctx.fillStyle = '#33506a';
  ctx.fillRect(0, 0, size, size);

  // Paper grain, laid down first so the pattern sits on top of it.
  const grain = ctx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const n = fbm(x / 26, y / 26, 3);
      const i = (y * size + x) * 4;
      const v = Math.round(255 * (0.5 + n * 0.5));
      grain.data[i] = v;
      grain.data[i + 1] = v;
      grain.data[i + 2] = v;
      grain.data[i + 3] = 26;
    }
  }
  ctx.putImageData(grain, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(51, 80, 106, 0.86)';
  ctx.fillRect(0, 0, size, size);

  // Tonal stripes.
  for (let x = 0; x < size; x += 64) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.030)';
    ctx.fillRect(x, 0, 32, size);
  }

  // Lattice motif, repeated on a half-drop so the tile seam does not read.
  const cell = size / 4;
  ctx.strokeStyle = 'rgba(206, 224, 236, 0.16)';
  ctx.fillStyle = 'rgba(206, 224, 236, 0.10)';
  ctx.lineWidth = 1.6;
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const cx = col * cell + (row % 2 ? 0 : cell / 2);
      const cy = row * cell + cell / 2;
      const r = cell * 0.3;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.quadraticCurveTo(cx + r * 0.62, cy - r * 0.62, cx + r, cy);
      ctx.quadraticCurveTo(cx + r * 0.62, cy + r * 0.62, cx, cy + r);
      ctx.quadraticCurveTo(cx - r * 0.62, cy + r * 0.62, cx - r, cy);
      ctx.quadraticCurveTo(cx - r * 0.62, cy - r * 0.62, cx, cy - r);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.16, r * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const texture = toTexture(element, 8);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

/* -------------------------------------------------------------------------- */
/* Book spines                                                                 */
/* -------------------------------------------------------------------------- */

/** Colours lifted off a real jacket so the spine belongs to the same book. */
export interface SpinePalette {
  /** Continues the jacket's binding edge. */
  base: string;
  /** Stamped title colour, chosen for contrast against `base`. */
  ink: string;
  /** The jacket's liveliest colour, used for the head and tail bands. */
  accent: string;
}

function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function hex(r: number, g: number, b: number): string {
  const part = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/**
 * Reads a cached jacket and returns the colours its spine should be printed in.
 *
 * Decoded into a 24x36 scratch canvas and thrown away immediately: this exists
 * to avoid holding 80-odd full-size cover textures in GPU memory just to know
 * what colour each book is. Same-origin only, or the canvas taints and
 * getImageData throws.
 */
export async function sampleCoverPalette(url: string): Promise<SpinePalette | null> {
  if (!url.startsWith('/')) return null;
  try {
    const image = new Image();
    image.decoding = 'async';
    image.fetchPriority = 'low';
    image.src = url;
    await image.decode();

    const w = 24;
    const h = 36;
    const { ctx } = canvas(w, h);
    ctx.drawImage(image, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);

    // The binding edge: a real wraparound jacket continues the cover's left
    // side around the spine, so that strip is what the spine should match.
    let er = 0;
    let eg = 0;
    let eb = 0;
    let count = 0;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < 3; x += 1) {
        const i = (y * w + x) * 4;
        er += data[i];
        eg += data[i + 1];
        eb += data[i + 2];
        count += 1;
      }
    }
    er /= count;
    eg /= count;
    eb /= count;

    // Liveliest pixel anywhere on the jacket, for the bands.
    let best = -1;
    let ar = er;
    let ag = eg;
    let ab = eb;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const chroma = max - min;
      // Ignore near-black and near-white; they carry no usable hue.
      if (max < 40 || min > 225) continue;
      if (chroma > best) {
        best = chroma;
        ar = r;
        ag = g;
        ab = b;
      }
    }

    return {
      base: hex(er, eg, eb),
      ink: luminance(er, eg, eb) < 0.48 ? '#f4ead6' : '#17191a',
      accent: hex(ar, ag, ab),
    };
  } catch {
    return null;
  }
}

/**
 * A bound spine. The canvas is sized to the real face aspect so type is never
 * stretched, and the text is drawn rotated to run bottom-to-top like a shelved
 * book. Narrow spines drop the author and shrink the title.
 */
export function spineTexture(
  book: ShelfBook,
  aspect: number,
  palette?: SpinePalette,
): CanvasTexture {
  const width = 72;
  const height = Math.round(Math.max(288, Math.min(1080, width * aspect)));
  const { element, ctx } = canvas(width, height);
  const random = noise(book.id);
  // Without a jacket to read, fall back to the deterministic cloth colour.
  const cloth = palette?.base ?? book.color;

  ctx.fillStyle = cloth;
  ctx.fillRect(0, 0, width, height);

  // Cloth weave.
  for (let i = 0; i < 900; i += 1) {
    ctx.fillStyle = `rgba(255, 250, 240, ${random() * 0.05})`;
    ctx.fillRect(random() * width, random() * height, 1, 1);
  }

  // Rounded shading: spines catch light in the middle and fall off at the joints.
  const round = ctx.createLinearGradient(0, 0, width, 0);
  round.addColorStop(0, 'rgba(0, 0, 0, 0.34)');
  round.addColorStop(0.18, 'rgba(0, 0, 0, 0.06)');
  round.addColorStop(0.5, 'rgba(255, 255, 255, 0.10)');
  round.addColorStop(0.82, 'rgba(0, 0, 0, 0.08)');
  round.addColorStop(1, 'rgba(0, 0, 0, 0.36)');
  ctx.fillStyle = round;
  ctx.fillRect(0, 0, width, height);

  const light = shade(cloth, 1.9);
  const foil = palette?.ink ?? (random() > 0.45 ? '#e8dcc0' : light);

  // Head and tail bands.
  const bandInset = height * 0.055;
  ctx.fillStyle = palette?.accent ?? 'rgba(255, 255, 255, 0.16)';
  ctx.globalAlpha = palette ? 0.85 : 1;
  ctx.fillRect(width * 0.16, bandInset, width * 0.68, 2.5);
  ctx.fillRect(width * 0.16, height - bandInset - 2.5, width * 0.68, 2.5);
  ctx.globalAlpha = 1;

  // Type runs bottom-to-top.
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-Math.PI / 2);

  const runLength = height - bandInset * 4;
  const titleSize = fitText(
    ctx,
    book.title,
    runLength,
    Math.round(width * 0.42),
    Math.round(width * 0.2),
    size => `600 ${size}px ${DISPLAY}`,
  );

  ctx.fillStyle = foil;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const roomy = width * aspect > 420;
  ctx.font = `600 ${titleSize}px ${DISPLAY}`;
  ctx.fillText(truncate(ctx, book.title, runLength), 0, roomy ? -width * 0.14 : 0);

  if (roomy) {
    const authorSize = Math.max(9, Math.round(titleSize * 0.62));
    ctx.font = `500 ${authorSize}px ${SANS}`;
    ctx.fillStyle = foil;
    ctx.globalAlpha = 0.66;
    ctx.fillText(truncate(ctx, book.author.split(',')[0], runLength * 0.8), 0, width * 0.24);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  return toTexture(element, 8);
}

/** Page block seen at the top and fore edge of a closed book. */
export function pageEdgeTexture(seed: string): CanvasTexture {
  const { element, ctx } = canvas(128, 128);
  const random = noise(seed);
  ctx.fillStyle = '#e8e0cd';
  ctx.fillRect(0, 0, 128, 128);
  for (let x = 0; x < 128; x += 1) {
    ctx.fillStyle = `rgba(120, 106, 78, ${0.05 + random() * 0.18})`;
    ctx.fillRect(x, 0, 0.7, 128);
  }
  return toTexture(element, 2);
}

/* -------------------------------------------------------------------------- */
/* Covers                                                                      */
/* -------------------------------------------------------------------------- */

/** Cloth jacket drawn from the record itself when no real cover resolved. */
export function fallbackCoverTexture(item: ShelfBook | ShelfAlbum): CanvasTexture {
  const width = 512;
  const height = item.kind === 'album' ? 512 : 768;
  const { element, ctx } = canvas(width, height);
  const random = noise(item.id);

  ctx.fillStyle = item.color;
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 9000; i += 1) {
    ctx.fillStyle = `rgba(255, 248, 236, ${random() * 0.045})`;
    ctx.fillRect(random() * width, random() * height, 1.6, 1.6);
  }

  const inset = width * 0.09;
  ctx.strokeStyle = 'rgba(255, 246, 230, 0.34)';
  ctx.lineWidth = 2;
  ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);

  const maxWidth = width - inset * 3;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f6efe0';
  const titleSize = fitText(ctx, item.title, maxWidth, 60, 26, size => `600 ${size}px ${DISPLAY}`);
  ctx.font = `600 ${titleSize}px ${DISPLAY}`;
  const titleLines = wrapLines(ctx, item.title, maxWidth, 4);
  const lineHeight = titleSize * 1.16;
  let y = height * 0.42 - ((titleLines.length - 1) * lineHeight) / 2;
  for (const line of titleLines) {
    ctx.fillText(line, width / 2, y);
    y += lineHeight;
  }

  ctx.font = `500 ${Math.round(titleSize * 0.42)}px ${SANS}`;
  ctx.fillStyle = 'rgba(246, 239, 224, 0.72)';
  const credit = item.kind === 'album' ? item.artist : item.author;
  ctx.fillText(truncate(ctx, credit, maxWidth), width / 2, y + titleSize * 0.7);

  return toTexture(element, 4);
}

/**
 * The back of a jewel case: a printed inlay card. Carries only what we actually
 * know - artist and title - plus the rules and barcode block that make it read
 * as printed matter. No invented track names.
 */
export function albumBackTexture(album: ShelfAlbum): CanvasTexture {
  const size = 512;
  const { element, ctx } = canvas(size, size);
  const random = noise(`${album.id}-back`);

  ctx.fillStyle = '#e8e4da';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 6000; i += 1) {
    ctx.fillStyle = `rgba(120, 112, 98, ${random() * 0.05})`;
    ctx.fillRect(random() * size, random() * size, 1.4, 1.4);
  }

  // Spine strips down both edges, as on a real inlay card.
  const spine = 34;
  ctx.fillStyle = album.color;
  ctx.fillRect(0, 0, spine, size);
  ctx.fillRect(size - spine, 0, spine, size);

  const left = spine + 26;
  const inner = size - spine * 2 - 52;

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(20, 24, 29, 0.62)';
  ctx.font = `500 15px ${MONO}`;
  ctx.letterSpacing = '3px';
  ctx.fillText(truncate(ctx, album.artist.toUpperCase(), inner), left, 58);
  ctx.letterSpacing = '0px';

  ctx.fillStyle = INK;
  const titleSize = fitText(ctx, album.title, inner, 40, 18, s => `600 ${s}px ${DISPLAY}`);
  ctx.font = `600 ${titleSize}px ${DISPLAY}`;
  const lines = wrapLines(ctx, album.title, inner, 2);
  let y = 104;
  for (const line of lines) {
    ctx.fillText(line, left, y);
    y += titleSize * 1.14;
  }

  // Rules standing in for a track listing, deliberately unlabelled.
  ctx.strokeStyle = 'rgba(20, 24, 29, 0.16)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 9; i += 1) {
    const ry = y + 26 + i * 24;
    if (ry > size - 120) break;
    ctx.beginPath();
    ctx.moveTo(left, ry);
    ctx.lineTo(left + inner * (0.45 + random() * 0.5), ry);
    ctx.stroke();
  }

  // Barcode block, bottom right.
  const bw = 128;
  const bx = size - spine - 26 - bw;
  const by = size - 96;
  ctx.fillStyle = '#f6f4ee';
  ctx.fillRect(bx - 8, by - 10, bw + 16, 74);
  ctx.fillStyle = '#14181d';
  let x = bx;
  while (x < bx + bw) {
    const w = 1 + Math.round(random() * 3);
    ctx.fillRect(x, by, w, 52);
    x += w + 1 + Math.round(random() * 3);
  }

  return toTexture(element, 8);
}

/* -------------------------------------------------------------------------- */
/* Game cases                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What each kind of case looks like: the moulded plastic, and the printed band
 * across the head of the insert that says which machine it is for. The mark is
 * set in type rather than copied from a logo.
 */
const CASE_STYLE: Record<GameSystem, {
  plastic: string;
  band: string;
  bandInk: string;
  paper: string;
}> = {
  switch: { plastic: '#c3161f', band: '#e1141d', bandInk: '#ffffff', paper: '#f3f2ef' },
  ps5: { plastic: '#1d4f9e', band: '#f5f6f8', bandInk: '#101317', paper: '#f5f6f8' },
  other: { plastic: '#25292f', band: '#1b2026', bandInk: '#efe7d8', paper: '#ebe7de' },
};

/** Plastic colour for the parts of the case that carry no print. */
export function casePlastic(system: GameSystem): string {
  return CASE_STYLE[system].plastic;
}

function caseMark(game: ShelfGame): string {
  if (game.system === 'switch') return 'NINTENDO SWITCH';
  if (game.system === 'ps5') return 'PS5';
  return game.platform.toUpperCase();
}

/** The two-part mark beside the Switch wordmark, drawn as plain shapes. */
function drawSwitchGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, ink: string) {
  const w = size * 0.42;
  const r = w * 0.5;
  ctx.save();
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = size * 0.1;
  ctx.beginPath();
  ctx.roundRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, w - ctx.lineWidth, size - ctx.lineWidth, r);
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(x + w + size * 0.06, y, w, size, r);
  ctx.fill();
  ctx.restore();
}

/**
 * Lays real box art into a frame. Art that is about the frame's shape, or
 * taller, is cropped to fill it. Wider art is not: its title usually runs edge
 * to edge, and cropping the sides cuts the name off. That is set whole across
 * the frame over a blurred bleed of itself instead.
 */
function drawArt(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const ratio = (image.naturalWidth / image.naturalHeight) / (w / h);
  const cover = (scale: number) => {
    const dw = image.naturalWidth * scale;
    const dh = image.naturalHeight * scale;
    ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  };
  const fill = Math.max(w / image.naturalWidth, h / image.naturalHeight);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  if (ratio <= 1.08) {
    cover(fill);
  } else {
    ctx.filter = `blur(${Math.round(w * 0.05)}px) saturate(1.1)`;
    cover(fill * 1.15);
    ctx.filter = 'none';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.fillRect(x, y, w, h);
    cover(w / image.naturalWidth);
  }
  ctx.restore();
}

/**
 * The front of a game case: the plastic rim, the platform band, and the box
 * art under the clear sleeve. Canvas is cut to the face's real aspect, so
 * nothing is stretched. Without art it prints the title on the game's cloth
 * colour, so a missing file still reads as a finished case.
 */
export function gameCoverTexture(
  game: ShelfGame,
  aspect: number,
  image?: HTMLImageElement | null,
): CanvasTexture {
  const width = 512;
  const height = Math.round(width / aspect);
  const { element, ctx } = canvas(width, height);
  const style = CASE_STYLE[game.system];

  ctx.fillStyle = style.plastic;
  ctx.fillRect(0, 0, width, height);

  const rim = Math.round(width * 0.024);
  const ix = rim;
  const iy = rim;
  const iw = width - rim * 2;
  const ih = height - rim * 2;
  const band = Math.round(ih * (game.system === 'switch' ? 0.094 : 0.082));

  ctx.fillStyle = style.band;
  ctx.fillRect(ix, iy, iw, band);

  // The mark, set small at the left of the band as the real inserts do it.
  const markSize = band * 0.44;
  let tx = ix + band * 0.42;
  if (game.system === 'switch') {
    drawSwitchGlyph(ctx, tx, iy + (band - markSize) / 2, markSize, style.bandInk);
    tx += markSize * 1.15;
  }
  ctx.fillStyle = style.bandInk;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = game.system === 'ps5' ? '1px' : '3px';
  ctx.font = game.system === 'ps5'
    ? `700 ${Math.round(band * 0.5)}px ${SANS}`
    : `700 ${Math.round(band * 0.3)}px ${SANS}`;
  ctx.fillText(truncate(ctx, caseMark(game), iw * 0.7), tx, iy + band / 2 + 1);
  ctx.letterSpacing = '0px';

  const ay = iy + band;
  const ah = ih - band;
  if (image) {
    drawArt(ctx, image, ix, ay, iw, ah);
  } else {
    ctx.fillStyle = game.color;
    ctx.fillRect(ix, ay, iw, ah);
    const maxWidth = iw * 0.78;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f6efe0';
    const titleSize = fitText(ctx, game.title, maxWidth, 58, 24, size => `600 ${size}px ${DISPLAY}`);
    ctx.font = `600 ${titleSize}px ${DISPLAY}`;
    const lines = wrapLines(ctx, game.title, maxWidth, 4);
    let y = ay + ah * 0.42 - ((lines.length - 1) * titleSize * 1.16) / 2;
    for (const line of lines) {
      ctx.fillText(line, width / 2, y);
      y += titleSize * 1.16;
    }
  }

  // The seam where the sleeve's print meets the band.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
  ctx.fillRect(ix, ay, iw, 1.5);

  return toTexture(element, 8);
}

/**
 * The spine of the insert, seen through the sleeve: the platform band at the
 * head, then the title running top to bottom on plain stock.
 */
export function gameSpineTexture(game: ShelfGame, aspect: number): CanvasTexture {
  const width = 64;
  const height = Math.round(Math.max(512, Math.min(1400, width * aspect)));
  const { element, ctx } = canvas(width, height);
  const style = CASE_STYLE[game.system];

  ctx.fillStyle = style.plastic;
  ctx.fillRect(0, 0, width, height);

  const rim = 3;
  ctx.fillStyle = style.paper;
  ctx.fillRect(rim, rim, width - rim * 2, height - rim * 2);

  const band = Math.round(height * 0.11);
  ctx.fillStyle = style.band;
  ctx.fillRect(rim, rim, width - rim * 2, band);
  if (game.system === 'switch') {
    drawSwitchGlyph(ctx, width / 2 - width * 0.2, rim + band / 2 - width * 0.22, width * 0.44, style.bandInk);
  } else {
    ctx.fillStyle = style.bandInk;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const size = fitText(ctx, caseMark(game), width * 0.8, width * 0.34, 10, value => `700 ${value}px ${SANS}`);
    ctx.font = `700 ${size}px ${SANS}`;
    ctx.fillText(caseMark(game), width / 2, rim + band / 2);
  }

  // Title runs top to bottom, the way a game spine reads.
  ctx.save();
  ctx.translate(width / 2, rim + band + (height - band - rim * 2) / 2);
  ctx.rotate(Math.PI / 2);
  const run = height - band - rim * 2 - width * 0.8;
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = fitText(ctx, game.title, run, Math.round(width * 0.4), Math.round(width * 0.2), value => `600 ${value}px ${SANS}`);
  ctx.font = `600 ${size}px ${SANS}`;
  ctx.fillText(truncate(ctx, game.title, run), 0, 0);
  ctx.restore();

  return toTexture(element, 8);
}

/* -------------------------------------------------------------------------- */
/* Plaques                                                                     */
/* -------------------------------------------------------------------------- */

/** Small dark shelf-edge plaque, e.g. "LISTENING - JULY 2026". The canvas is
 *  cut to the real plaque aspect so the mono type is never stretched. */
export function plaqueTexture(label: string, aspect: number): CanvasTexture {
  const width = 1024;
  const height = Math.round(Math.max(48, Math.min(256, width / aspect)));
  const { element, ctx } = canvas(width, height);

  ctx.fillStyle = '#1b2026';
  ctx.fillRect(0, 0, width, height);

  const sheen = ctx.createLinearGradient(0, 0, 0, height);
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.10)');
  sheen.addColorStop(0.5, 'rgba(255, 255, 255, 0.02)');
  sheen.addColorStop(1, 'rgba(0, 0, 0, 0.18)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, width, height);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#efe7d8';
  ctx.letterSpacing = '4px';
  const size = fitText(ctx, label, width * 0.9, height * 0.62, 18, value => `500 ${value}px ${MONO}`);
  ctx.font = `500 ${size}px ${MONO}`;
  ctx.fillText(label, width / 2, height / 2 + size * 0.04);

  return toTexture(element, 8);
}

/* -------------------------------------------------------------------------- */
/* External images                                                             */
/* -------------------------------------------------------------------------- */

const loader = new TextureLoader();

/**
 * Loads a cached cover. Resolves to null instead of rejecting so a missing file
 * degrades to the generated cloth cover rather than breaking the scene.
 */
export function loadCoverTexture(url: string): Promise<Texture | null> {
  return new Promise(resolve => {
    loader.load(
      url,
      texture => {
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = 8;
        texture.minFilter = LinearMipmapLinearFilter;
        texture.magFilter = LinearFilter;
        resolve(texture);
      },
      undefined,
      () => resolve(null),
    );
  });
}

/**
 * Decodes a cached image for drawing onto a canvas rather than straight onto a
 * face. Resolves to null on any failure, like loadCoverTexture.
 */
export async function loadImage(url: string): Promise<HTMLImageElement | null> {
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return image;
  } catch {
    return null;
  }
}

/** Text textures pick up the display and sans faces only once the webfonts land. */
export async function fontsReady(): Promise<void> {
  if (!('fonts' in document)) return;
  try {
    await document.fonts.ready;
  } catch {
    /* keep going with fallback faces */
  }
}
