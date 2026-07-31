/**
 * Canvas-drawn textures for the shelf.
 *
 * Everything the scene shows is generated here except real album art and book
 * jackets, which load from the local cache in public/media. Drawing the wood,
 * spines, plaques, and notebook pages keeps the page free of binary texture
 * downloads and lets every surface inherit the site's palette.
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
import type { ShelfAlbum, ShelfBook, ShelfNotebook } from './media';
import { seededUnit } from './media';

const DISPLAY = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const SANS = '"Inter", -apple-system, system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';

const PAPER = '#f4f1e8';
const INK = '#14181d';
const FOREST = '#2d5d4f';

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
/* Notebooks                                                                   */
/* -------------------------------------------------------------------------- */

/** Pressboard cover with a stamped label, in the section's cloth color. */
export function notebookCoverTexture(notebook: ShelfNotebook): CanvasTexture {
  const { element, ctx } = canvas(384, 512);
  const random = noise(`${notebook.id}-cover`);

  ctx.fillStyle = notebook.color;
  ctx.fillRect(0, 0, 384, 512);
  for (let i = 0; i < 12000; i += 1) {
    ctx.fillStyle = `rgba(20, 16, 12, ${random() * 0.09})`;
    ctx.fillRect(random() * 384, random() * 512, 2, 2);
  }

  ctx.fillStyle = PAPER;
  ctx.fillRect(56, 150, 272, 150);
  ctx.strokeStyle = 'rgba(20, 24, 29, 0.22)';
  ctx.lineWidth = 2;
  ctx.strokeRect(56, 150, 272, 150);

  ctx.textAlign = 'center';
  ctx.fillStyle = FOREST;
  ctx.font = `500 15px ${MONO}`;
  ctx.fillText(notebook.section.toUpperCase(), 192, 182);

  ctx.fillStyle = INK;
  const titleSize = fitText(ctx, notebook.title, 236, 30, 15, size => `600 ${size}px ${DISPLAY}`);
  ctx.font = `600 ${titleSize}px ${DISPLAY}`;
  const lines = wrapLines(ctx, notebook.title, 236, 3);
  let y = 224 - ((lines.length - 1) * titleSize * 1.2) / 2;
  for (const line of lines) {
    ctx.fillText(line, 192, y);
    y += titleSize * 1.2;
  }

  if (notebook.date) {
    ctx.font = `400 13px ${MONO}`;
    ctx.fillStyle = 'rgba(20, 24, 29, 0.55)';
    ctx.fillText(notebook.date, 192, 286);
  }

  return toTexture(element, 8);
}

/**
 * The ruled page revealed when a notebook opens: the real title, date, and
 * opening paragraphs of that entry, set on lined paper.
 */
export function notebookPageTexture(notebook: ShelfNotebook): CanvasTexture {
  const width = 1024;
  const height = 1365;
  const { element, ctx } = canvas(width, height);

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);

  const marginX = 168;
  const ruleTop = 300;
  const ruleGap = 54;

  ctx.strokeStyle = 'rgba(94, 122, 138, 0.30)';
  ctx.lineWidth = 1.4;
  for (let y = ruleTop; y < height - 90; y += ruleGap) {
    ctx.beginPath();
    ctx.moveTo(96, y);
    ctx.lineTo(width - 88, y);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(150, 74, 66, 0.42)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(marginX, 120);
  ctx.lineTo(marginX, height - 70);
  ctx.stroke();

  // Punch holes for the spiral.
  ctx.fillStyle = 'rgba(20, 24, 29, 0.16)';
  for (let y = 130; y < height - 100; y += 118) {
    ctx.beginPath();
    ctx.ellipse(52, y, 15, 15, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = FOREST;
  ctx.font = `500 22px ${MONO}`;
  const stamp = notebook.date
    ? `${notebook.section.toUpperCase()}  /  ${notebook.date}`
    : notebook.section.toUpperCase();
  ctx.fillText(stamp, marginX + 26, 150);

  ctx.fillStyle = INK;
  const titleSize = fitText(
    ctx,
    notebook.title,
    width - marginX - 130,
    58,
    32,
    size => `600 ${size}px ${DISPLAY}`,
  );
  ctx.font = `600 ${titleSize}px ${DISPLAY}`;
  const titleLines = wrapLines(ctx, notebook.title, width - marginX - 130, 2);
  let y = 218;
  for (const line of titleLines) {
    ctx.fillText(line, marginX + 26, y);
    y += titleSize * 1.12;
  }

  ctx.font = `400 30px ${SANS}`;
  ctx.fillStyle = 'rgba(20, 24, 29, 0.82)';
  const bodyLines = wrapLines(
    ctx,
    notebook.excerpt || 'No preview available for this entry.',
    width - marginX - 130,
    Math.floor((height - ruleTop - 190) / ruleGap),
  );
  let ruleY = ruleTop + 34;
  for (const line of bodyLines) {
    ctx.fillText(line, marginX + 26, ruleY);
    ruleY += ruleGap;
  }

  ctx.font = `500 24px ${MONO}`;
  ctx.fillStyle = FOREST;
  ctx.fillText('READ THE FULL ENTRY ->', marginX + 26, Math.min(ruleY + 44, height - 74));

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

/** Text textures pick up the display and sans faces only once the webfonts land. */
export async function fontsReady(): Promise<void> {
  if (!('fonts' in document)) return;
  try {
    await document.fonts.ready;
  } catch {
    /* keep going with fallback faces */
  }
}
