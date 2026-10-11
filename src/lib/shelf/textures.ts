/**
 * Canvas-drawn textures for the /library scene.
 *
 * Everything the scene shows is generated here except real album art, book
 * jackets, game box art and the site's own article and case study images,
 * which load from this origin. Drawing the folios, spines, cases and concrete
 * keeps the page free of binary texture downloads.
 *
 * Browser only: each function touches document/canvas.
 */

import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
} from 'three';
import type { GameSystem, ShelfAlbum, ShelfBook, ShelfFolio, ShelfGame } from './media';
import { hash, seededUnit } from './media';

const DISPLAY = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const HEADLINE = '"Barlow Semi Condensed", "Arial Narrow", sans-serif';
const SANS = '"Plus Jakarta Sans", -apple-system, system-ui, sans-serif';
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
 * The colours a book's spine should be printed in, read off its jacket.
 *
 * Sampled through a 24x36 scratch canvas, so it costs nothing to keep. The
 * image must be same-origin, or the canvas taints and getImageData throws;
 * that returns null rather than a guess.
 */
export function paletteFromImage(image: HTMLImageElement): SpinePalette | null {
  try {
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
/* Folios                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Card stock for the site's own pieces, in Miami's daytime colours: flamingo,
 * pool teal, Deco cream, cobalt and the lilac of the sky at six. Each pairs
 * with the ink that reads on it.
 */
const FOLIO_STOCK = [
  { paper: '#efe6d6', ink: '#262838', accent: '#c94f74' },
  { paper: '#34479c', ink: '#f6efe4', accent: '#ffc9a8' },
  { paper: '#6c9ad3', ink: '#f8f3ec', accent: '#24315f' },
  { paper: '#3c4168', ink: '#f4ece2', accent: '#f2a3bb' },
  { paper: '#e8d1b0', ink: '#2a2632', accent: '#3f8e8b' },
  { paper: '#cc4f78', ink: '#fff3ee', accent: '#ffd6a6' },
  { paper: '#3e8d8a', ink: '#f3fbf8', accent: '#ffd8c2' },
  { paper: '#d9d5e5', ink: '#272a3c', accent: '#6c5fb0' },
] as const;

export type FolioStock = (typeof FOLIO_STOCK)[number];

/** The stock a piece is printed on. Chosen off its id, so it never changes colour between visits. */
export function folioStock(folio: ShelfFolio): FolioStock {
  return FOLIO_STOCK[hash(folio.id) % FOLIO_STOCK.length];
}

const MONTH_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * The cover of a folio: a numbered booklet with the piece's title set large at
 * the foot, its kind and date across the head, and its picture between them.
 * Article illustrations are ink drawings, so they are printed into the stock
 * with multiply, the way ink sits on coloured paper. Case study screenshots are
 * tipped in as a framed plate instead. Lab notes have no picture and get the
 * ruled page of a notebook.
 */
export function folioTexture(
  folio: ShelfFolio,
  aspect: number,
  number: number,
  image?: HTMLImageElement | null,
): CanvasTexture {
  const width = 640;
  const height = Math.round(width / aspect);
  const { element, ctx } = canvas(width, height);
  const stock = folioStock(folio);
  const random = noise(`${folio.id}-stock`);

  ctx.fillStyle = stock.paper;
  ctx.fillRect(0, 0, width, height);

  // Faceted light across the stock, as if the card had been folded and pressed
  // flat again. Kept faint: it should read as surface, not pattern.
  for (let i = 0; i < 5; i += 1) {
    ctx.beginPath();
    ctx.moveTo(random() * width, 0);
    ctx.lineTo(width, random() * height);
    ctx.lineTo(random() * width * 0.6, height);
    ctx.closePath();
    ctx.fillStyle = random() > 0.5 ? 'rgba(255, 255, 255, 0.07)' : 'rgba(20, 16, 40, 0.06)';
    ctx.fill();
  }
  for (let i = 0; i < 7000; i += 1) {
    ctx.fillStyle = `rgba(${random() > 0.5 ? '255, 255, 255' : '0, 0, 0'}, ${random() * 0.05})`;
    ctx.fillRect(random() * width, random() * height, 1.5, 1.5);
  }

  const margin = width * 0.085;
  const inner = width - margin * 2;

  // Head: kind on the left, month on the right.
  ctx.fillStyle = stock.ink;
  ctx.globalAlpha = 0.74;
  ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = '4px';
  ctx.font = `500 ${Math.round(width * 0.03)}px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillText(folio.label.toUpperCase(), margin, margin + width * 0.03);
  if (folio.date) {
    const [year, month] = folio.date.split('-');
    ctx.textAlign = 'right';
    ctx.fillText(`${MONTH_SHORT[Number(month) - 1] ?? ''} ${year}`, width - margin, margin + width * 0.03);
  }
  ctx.letterSpacing = '0px';
  ctx.globalAlpha = 1;

  // Picture band.
  const top = margin + width * 0.09;
  const bandHeight = height * 0.42;
  if (image && folio.kind === 'article') {
    ctx.save();
    ctx.beginPath();
    ctx.rect(margin, top, inner, bandHeight);
    ctx.clip();
    ctx.globalCompositeOperation = 'multiply';
    ctx.filter = 'grayscale(1) contrast(1.15)';
    const fill = Math.max(inner / image.naturalWidth, bandHeight / image.naturalHeight);
    const dw = image.naturalWidth * fill;
    const dh = image.naturalHeight * fill;
    ctx.drawImage(image, margin + (inner - dw) / 2, top + (bandHeight - dh) / 2, dw, dh);
    ctx.restore();
  } else if (image) {
    const fill = Math.max(inner / image.naturalWidth, bandHeight / image.naturalHeight);
    const dw = image.naturalWidth * fill;
    const dh = image.naturalHeight * fill;
    ctx.save();
    ctx.shadowColor = 'rgba(10, 8, 30, 0.28)';
    ctx.shadowBlur = width * 0.03;
    ctx.shadowOffsetY = width * 0.012;
    ctx.fillStyle = stock.paper;
    ctx.fillRect(margin, top, inner, bandHeight);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(margin, top, inner, bandHeight);
    ctx.clip();
    // Screens are drawn from their top, where the interface's header is.
    ctx.drawImage(image, margin + (inner - dw) / 2, top, dw, dh);
    ctx.restore();
    ctx.strokeStyle = stock.ink;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 2;
    ctx.strokeRect(margin, top, inner, bandHeight);
    ctx.globalAlpha = 1;
  } else {
    ctx.strokeStyle = stock.ink;
    ctx.globalAlpha = 0.14;
    ctx.lineWidth = 2;
    for (let y = top + width * 0.05; y < top + bandHeight; y += width * 0.055) {
      ctx.beginPath();
      ctx.moveTo(margin, y);
      ctx.lineTo(width - margin, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.moveTo(margin + width * 0.07, top);
    ctx.lineTo(margin + width * 0.07, top + bandHeight);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Foot: the number, a short rule, then the title set from the bottom up.
  const titleSize = fitText(ctx, folio.title.split(' ').reduce((a, b) => (b.length > a.length ? b : a), ''),
    inner, Math.round(width * 0.105), Math.round(width * 0.06), size => `500 ${size}px ${HEADLINE}`);
  ctx.font = `500 ${titleSize}px ${HEADLINE}`;
  const lines = wrapLines(ctx, folio.title, inner, 4);
  const lineHeight = titleSize * 1.02;
  const bottom = height - margin;
  ctx.fillStyle = stock.ink;
  ctx.textAlign = 'left';
  let y = bottom - (lines.length - 1) * lineHeight;
  for (const line of lines) {
    ctx.fillText(line, margin - titleSize * 0.04, y);
    y += lineHeight;
  }

  const numberY = bottom - (lines.length - 1) * lineHeight - titleSize * 1.12;
  ctx.font = `500 ${Math.round(width * 0.036)}px ${MONO}`;
  ctx.fillStyle = stock.accent;
  ctx.fillText(String(number).padStart(2, '0'), margin, numberY);
  ctx.fillRect(margin + width * 0.075, numberY - width * 0.012, width * 0.08, 3);

  return toTexture(element, 8);
}

/* -------------------------------------------------------------------------- */
/* External images                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Real art, redrawn no larger than `maxSize` on its long side.
 *
 * A jacket arrives at whatever size the catalog had. Uploading it as is costs
 * GPU memory the floating scene never shows, since even an opened book covers
 * at most two thirds of the screen height.
 */
export function artTexture(image: HTMLImageElement, maxSize = 640): CanvasTexture {
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const { element, ctx } = canvas(width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return toTexture(element, 8);
}

/**
 * Decodes a cached image for drawing onto a canvas rather than straight onto a
 * face. Resolves to null on any failure, like loadCoverTexture.
 */
export async function loadImage(url: string): Promise<HTMLImageElement | null> {
  try {
    const image = new Image();
    image.decoding = 'async';
    // Art from another origin has to come with CORS, or the canvas it is
    // drawn onto taints and WebGL refuses the upload.
    if (!url.startsWith('/')) image.crossOrigin = 'anonymous';
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
