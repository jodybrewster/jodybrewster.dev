/**
 * Canvas-drawn textures for the /library scene.
 *
 * Everything the scene shows is generated here except real album art, book
 * jackets and game box art, which load from the local cache in public/media.
 * Drawing the spines and game cases keeps the page free of binary texture
 * downloads.
 *
 * Browser only: each function touches document/canvas.
 */

import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
} from 'three';
import type { GameSystem, ShelfAlbum, ShelfBook, ShelfFilm, ShelfGame, ShelfPlace, ShelfPodcast, ShelfTool } from './media';
import { hash, seededUnit } from './media';

const DISPLAY = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const SANS = '"Plus Jakarta Sans", -apple-system, system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';
const HEADLINE = '"Barlow Semi Condensed", "Arial Narrow", sans-serif';
/** The site's script face, standing in for handwriting on labels and postcards. */
const HAND = '"Mr Dafoe", "Snell Roundhand", cursive';

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
/* Floppy disks, tapes and postcards                                           */
/* -------------------------------------------------------------------------- */

/** Shell colours, the translucent pastels of a box of disks bought in 1986. */
const SHELLS = ['#2aa7a1', '#e2458f', '#8f7fd0', '#f2c14e', '#25242e', '#ef8a4b', '#4f86d6'] as const;

/** The plastic an object's shell is moulded in, chosen off its id so it never changes. */
export function shellColour(id: string): string {
  return SHELLS[hash(id) % SHELLS.length];
}

const BALLPOINT = '#1f2c6e';
const MARKER = '#17151c';

/** A grain of moulded plastic, with light falling from the top left. */
function plastic(ctx: CanvasRenderingContext2D, width: number, height: number, colour: string, seed: string) {
  const random = noise(seed);
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, width, height);
  const light = ctx.createLinearGradient(0, 0, width, height);
  light.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
  light.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
  light.addColorStop(1, 'rgba(0, 0, 0, 0.14)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 2500; i += 1) {
    ctx.fillStyle = `rgba(${random() > 0.5 ? '255, 255, 255' : '0, 0, 0'}, ${random() * 0.04})`;
    ctx.fillRect(random() * width, random() * height, 1.5, 1.5);
  }
}

/** Faint ruled lines across a paper label. */
function ruled(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, step: number) {
  ctx.strokeStyle = 'rgba(70, 110, 190, 0.22)';
  ctx.lineWidth = 1.5;
  for (let ly = y + step; ly < y + h - step * 0.4; ly += step) {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.04, ly);
    ctx.lineTo(x + w * 0.96, ly);
    ctx.stroke();
  }
}

/** A title written by hand on a label: fitted to the width, never cut off. */
function handwrite(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, size: number, colour: string) {
  const fitted = fitText(ctx, text, maxWidth, size, Math.round(size * 0.45), value => `${value}px ${HAND}`);
  ctx.font = `${fitted}px ${HAND}`;
  ctx.fillStyle = colour;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

function metal(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const sheen = ctx.createLinearGradient(x, y, x + w, y + h);
  sheen.addColorStop(0, '#e8ebef');
  sheen.addColorStop(0.45, '#b9bfc7');
  sheen.addColorStop(0.55, '#d6dae0');
  sheen.addColorStop(1, '#9aa1aa');
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, w, h);
}

/**
 * The front of a 3.5 inch disk: the sliding metal shutter at the head, and a
 * paper label with the tool's name written on it in ballpoint, the way a disk
 * of something you used every day ended up labelled.
 */
export function floppyTexture(tool: ShelfTool, aspect: number): CanvasTexture {
  const width = 640;
  const height = Math.round(width / aspect);
  const { element, ctx } = canvas(width, height);
  plastic(ctx, width, height, shellColour(tool.id), tool.id);

  // Shutter, with its read slot.
  const sx = width * 0.26;
  const sw = width * 0.5;
  const sh = height * 0.36;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.fillRect(sx - 6, 0, sw + 12, sh + 6);
  metal(ctx, sx, 0, sw, sh);
  ctx.fillStyle = '#2b2d33';
  ctx.fillRect(sx + sw * 0.62, sh * 0.12, sw * 0.18, sh * 0.72);

  // Embossed capacity mark in the top corner.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.font = `700 ${Math.round(width * 0.04)}px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.fillText('HD', width * 0.05, height * 0.1);

  // Write-protect and density holes at the foot.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(width * 0.04, height * 0.9, width * 0.045, width * 0.045);
  ctx.fillRect(width * 0.915, height * 0.9, width * 0.045, width * 0.045);

  // The label.
  const lx = width * 0.12;
  const ly = height * 0.43;
  const lw = width * 0.76;
  const lh = height * 0.55;
  ctx.fillStyle = '#f6f2e8';
  ctx.fillRect(lx, ly, lw, lh);
  ctx.fillStyle = shellColour(`${tool.id}-band`);
  ctx.fillRect(lx, ly, lw, lh * 0.12);
  if (tool.maker) {
    ctx.fillStyle = '#ffffff';
    ctx.font = `500 ${Math.round(lh * 0.065)}px ${MONO}`;
    ctx.letterSpacing = '3px';
    ctx.fillText(truncate(ctx, tool.maker.toUpperCase(), lw * 0.9), lx + lw * 0.05, ly + lh * 0.085);
    ctx.letterSpacing = '0px';
  }
  ruled(ctx, lx, ly + lh * 0.12, lw, lh * 0.88, lh * 0.17);
  handwrite(ctx, tool.title, lx + lw * 0.07, ly + lh * 0.62, lw * 0.86, Math.round(lh * 0.36), BALLPOINT);

  return toTexture(element, 8);
}

/** The back of a disk: the shutter again and the steel hub. */
export function floppyBackTexture(tool: ShelfTool, aspect: number): CanvasTexture {
  const width = 512;
  const height = Math.round(width / aspect);
  const { element, ctx } = canvas(width, height);
  plastic(ctx, width, height, shellColour(tool.id), `${tool.id}-back`);
  metal(ctx, width * 0.24, 0, width * 0.5, height * 0.36);
  const cx = width / 2;
  const cy = height * 0.62;
  ctx.beginPath();
  ctx.arc(cx, cy, width * 0.14, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, width * 0.11, 0, Math.PI * 2);
  ctx.clip();
  metal(ctx, cx - width * 0.11, cy - width * 0.11, width * 0.22, width * 0.22);
  ctx.restore();
  ctx.fillStyle = '#2b2d33';
  ctx.fillRect(cx - width * 0.02, cy - width * 0.02, width * 0.04, width * 0.04);
  ctx.fillRect(cx + width * 0.05, cy - width * 0.015, width * 0.04, width * 0.06);
  return toTexture(element, 4);
}

/** Two reel windows, the tape wound round dark hubs. */
function reels(ctx: CanvasRenderingContext2D, cx: number, cy: number, gap: number, radius: number, window: string) {
  for (const x of [cx - gap / 2, cx + gap / 2]) {
    ctx.beginPath();
    ctx.arc(x, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = window;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, cy, radius * 0.78, 0, Math.PI * 2);
    ctx.fillStyle = '#2a1e1a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, cy, radius * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = '#efece6';
    ctx.fill();
    ctx.fillStyle = '#2a1e1a';
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      ctx.fillRect(x + Math.cos(a) * radius * 0.24 - 3, cy + Math.sin(a) * radius * 0.24 - 3, 6, 6);
    }
  }
}

/**
 * A VHS tape seen from above: black shell, the reel window, and a white label
 * written on in marker, a recording somebody kept.
 */
export function vhsTexture(film: ShelfFilm, aspect: number): CanvasTexture {
  const width = 768;
  const height = Math.round(width / aspect);
  const { element, ctx } = canvas(width, height);
  plastic(ctx, width, height, '#1b1a20', film.id);

  // Moulded ribs along the foot.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  for (let x = width * 0.06; x < width * 0.94; x += width * 0.03) ctx.fillRect(x, height * 0.86, width * 0.012, height * 0.1);

  // The label.
  const lx = width * 0.07;
  const ly = height * 0.08;
  const lw = width * 0.86;
  const lh = height * 0.4;
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(lx, ly, lw, lh);
  ctx.fillStyle = shellColour(`${film.id}-stripe`);
  ctx.fillRect(lx, ly + lh * 0.82, lw, lh * 0.1);
  ctx.fillStyle = '#6a6670';
  ctx.font = `700 ${Math.round(lh * 0.1)}px ${SANS}`;
  ctx.textAlign = 'right';
  ctx.fillText('T-120  SP', lx + lw * 0.97, ly + lh * 0.16);
  // Written short of the corner where the year goes, so the two never collide.
  handwrite(ctx, film.title, lx + lw * 0.04, ly + lh * 0.62, lw * (film.year ? 0.72 : 0.9), Math.round(lh * 0.5), MARKER);
  if (film.year) {
    ctx.font = `${Math.round(lh * 0.22)}px ${HAND}`;
    ctx.fillStyle = MARKER;
    ctx.textAlign = 'right';
    ctx.fillText(film.year, lx + lw * 0.96, ly + lh * 0.78);
  }

  // The window, and the tape behind it.
  const wy = height * 0.67;
  ctx.fillStyle = 'rgba(120, 125, 140, 0.35)';
  ctx.fillRect(width * 0.22, wy - height * 0.13, width * 0.56, height * 0.26);
  reels(ctx, width / 2, wy, width * 0.36, height * 0.12, 'rgba(160, 165, 180, 0.4)');

  return toTexture(element, 8);
}

/**
 * A compact cassette: a coloured shell, a paper label with the show's name
 * written on it, the two reels and the screws at the corners.
 */
export function cassetteTexture(podcast: ShelfPodcast, aspect: number): CanvasTexture {
  const width = 768;
  const height = Math.round(width / aspect);
  const { element, ctx } = canvas(width, height);
  plastic(ctx, width, height, shellColour(podcast.id), podcast.id);

  // Screws.
  ctx.fillStyle = 'rgba(30, 30, 36, 0.6)';
  for (const [x, y] of [[0.05, 0.08], [0.95, 0.08], [0.05, 0.92], [0.95, 0.92], [0.5, 0.9]]) {
    ctx.beginPath();
    ctx.arc(width * x, height * y, width * 0.014, 0, Math.PI * 2);
    ctx.fill();
  }

  // The label, with its window cut out.
  const lx = width * 0.08;
  const ly = height * 0.07;
  const lw = width * 0.84;
  const lh = height * 0.62;
  ctx.fillStyle = '#f6f2e8';
  ctx.fillRect(lx, ly, lw, lh);
  ctx.fillStyle = shellColour(`${podcast.id}-band`);
  ctx.fillRect(lx, ly + lh * 0.38, lw, lh * 0.5);
  ctx.fillStyle = '#6a6670';
  ctx.font = `700 ${Math.round(lh * 0.1)}px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.fillText('A', lx + lw * 0.03, ly + lh * 0.13);
  handwrite(ctx, podcast.title, lx + lw * 0.1, ly + lh * 0.3, lw * 0.85, Math.round(lh * 0.24), BALLPOINT);

  const wy = ly + lh * 0.63;
  ctx.fillStyle = '#2b2a31';
  ctx.beginPath();
  ctx.roundRect(width * 0.28, wy - lh * 0.15, width * 0.44, lh * 0.3, lh * 0.15);
  ctx.fill();
  reels(ctx, width / 2, wy, width * 0.33, lh * 0.12, '#3a3842');

  // The trapezoid at the foot, where the heads meet the tape.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
  ctx.beginPath();
  ctx.moveTo(width * 0.2, height);
  ctx.lineTo(width * 0.26, height * 0.76);
  ctx.lineTo(width * 0.74, height * 0.76);
  ctx.lineTo(width * 0.8, height);
  ctx.closePath();
  ctx.fill();

  return toTexture(element, 8);
}

/** Sunset bands for a lettered postcard with no photograph yet. */
const POSTCARD_SKIES = [
  ['#3f6fc2', '#b98ad6', '#ff9a8b', '#ffd29d'],
  ['#2aa7a1', '#7fd3c6', '#ffc1a6', '#ff8fb1'],
  ['#5b4bb7', '#e2458f', '#ff9651', '#ffd36e'],
] as const;

/**
 * The picture side of a postcard. With the visitor's own photograph it is that
 * photograph inside a white border; without one it is a large-letter
 * "Greetings from" card in the sunset's colours, the classic Florida tourist
 * card, until the photograph is added.
 */
export function postcardFrontTexture(place: ShelfPlace, aspect: number, image?: HTMLImageElement | null): CanvasTexture {
  const width = 900;
  const height = Math.round(width / aspect);
  const { element, ctx } = canvas(width, height);
  ctx.fillStyle = '#f7f3ea';
  ctx.fillRect(0, 0, width, height);
  const border = width * 0.035;
  const iw = width - border * 2;
  const ih = height - border * 2;

  if (image) {
    drawArt(ctx, image, border, border, iw, ih);
  } else {
    const sky = POSTCARD_SKIES[hash(place.id) % POSTCARD_SKIES.length];
    const gradient = ctx.createLinearGradient(0, border, 0, border + ih);
    sky.forEach((colour, i) => gradient.addColorStop(i / (sky.length - 1), colour));
    ctx.fillStyle = gradient;
    ctx.fillRect(border, border, iw, ih);
    // The sun, set low, with the bands cut through it.
    ctx.save();
    ctx.beginPath();
    ctx.rect(border, border, iw, ih);
    ctx.clip();
    ctx.beginPath();
    ctx.arc(width * 0.72, border + ih * 0.78, ih * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 236, 190, 0.85)';
    ctx.fill();
    ctx.fillStyle = sky[3];
    for (let i = 0; i < 5; i += 1) ctx.fillRect(border, border + ih * (0.66 + i * 0.06), iw, ih * (0.012 + i * 0.006));
    ctx.restore();
  }

  // "Greetings from" in script, the place in big outlined letters.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(20, 10, 40, 0.45)';
  ctx.shadowBlur = width * 0.01;
  ctx.font = `${Math.round(ih * 0.13)}px ${HAND}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Greetings from', border + iw * 0.06, border + ih * 0.22);
  const name = place.title.toUpperCase();
  const size = fitText(ctx, name, iw * 0.88, Math.round(ih * 0.3), Math.round(ih * 0.1), value => `500 ${value}px ${HEADLINE}`);
  ctx.font = `500 ${size}px ${HEADLINE}`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.1;
  ctx.strokeStyle = '#1d1838';
  const lines = wrapLines(ctx, name, iw * 0.88, 2);
  let y = border + ih * 0.22 + size * 1.02;
  for (const line of lines) {
    ctx.strokeText(line, border + iw * 0.06, y);
    ctx.fillStyle = '#fff4dc';
    ctx.fillText(line, border + iw * 0.06, y);
    y += size * 0.96;
  }
  ctx.shadowColor = 'transparent';

  return toTexture(element, 8);
}

/**
 * The written side: a short note in the site's hand on the left, a stamp, a
 * postmark with the place and year, and the address lines on the right.
 */
export function postcardBackTexture(place: ShelfPlace, aspect: number): CanvasTexture {
  const width = 900;
  const height = Math.round(width / aspect);
  const { element, ctx } = canvas(width, height);
  const random = noise(`${place.id}-back`);
  ctx.fillStyle = '#f5f0e4';
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 5000; i += 1) {
    ctx.fillStyle = `rgba(120, 104, 80, ${random() * 0.05})`;
    ctx.fillRect(random() * width, random() * height, 1.4, 1.4);
  }

  ctx.strokeStyle = 'rgba(60, 50, 40, 0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width * 0.55, height * 0.1);
  ctx.lineTo(width * 0.55, height * 0.9);
  ctx.stroke();
  ctx.fillStyle = 'rgba(60, 50, 40, 0.55)';
  ctx.font = `500 ${Math.round(height * 0.035)}px ${MONO}`;
  ctx.letterSpacing = '4px';
  ctx.textAlign = 'left';
  ctx.fillText('POST CARD', width * 0.06, height * 0.12);
  ctx.letterSpacing = '0px';

  if (place.note) {
    ctx.font = `${Math.round(height * 0.085)}px ${HAND}`;
    ctx.fillStyle = BALLPOINT;
    const lines = wrapLines(ctx, place.note, width * 0.44, 5);
    let y = height * 0.3;
    for (const line of lines) {
      ctx.fillText(line, width * 0.06, y);
      y += height * 0.11;
    }
  }

  // Address lines.
  ctx.strokeStyle = 'rgba(60, 50, 40, 0.3)';
  for (let i = 0; i < 3; i += 1) {
    const y = height * (0.6 + i * 0.1);
    ctx.beginPath();
    ctx.moveTo(width * 0.6, y);
    ctx.lineTo(width * 0.94, y);
    ctx.stroke();
  }

  // Stamp, with its perforated edge.
  const sx = width * 0.78;
  const sy = height * 0.1;
  const sw = width * 0.15;
  const sh = sw * 1.2;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(sx, sy, sw, sh);
  ctx.fillStyle = shellColour(`${place.id}-stamp`);
  ctx.fillRect(sx + sw * 0.1, sy + sh * 0.08, sw * 0.8, sh * 0.84);
  ctx.beginPath();
  ctx.arc(sx + sw * 0.5, sy + sh * 0.62, sw * 0.22, Math.PI, 0);
  ctx.fillStyle = '#ffd36e';
  ctx.fill();
  ctx.fillStyle = '#f5f0e4';
  for (let i = 0; i <= 8; i += 1) {
    for (const [x, y] of [[sx + (sw * i) / 8, sy], [sx + (sw * i) / 8, sy + sh]]) {
      ctx.beginPath();
      ctx.arc(x, y, sw * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Postmark over the stamp's corner.
  const px = sx - sw * 0.15;
  const py = sy + sh * 0.75;
  const pr = sw * 0.42;
  ctx.strokeStyle = 'rgba(40, 40, 70, 0.6)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(px, py, pr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(40, 40, 70, 0.7)';
  ctx.textAlign = 'center';
  ctx.font = `600 ${Math.round(pr * 0.24)}px ${SANS}`;
  ctx.fillText(truncate(ctx, (place.location ?? place.title).toUpperCase(), pr * 1.7), px, py - pr * 0.1);
  if (place.year) {
    ctx.font = `600 ${Math.round(pr * 0.3)}px ${SANS}`;
    ctx.fillText(place.year, px, py + pr * 0.35);
  }
  for (let i = 0; i < 4; i += 1) {
    ctx.beginPath();
    ctx.moveTo(px + pr * 1.1, py - pr * 0.45 + i * pr * 0.3);
    ctx.bezierCurveTo(px + pr * 1.6, py - pr * 0.7 + i * pr * 0.3, px + pr * 2.1, py - pr * 0.2 + i * pr * 0.3, px + pr * 2.6, py - pr * 0.45 + i * pr * 0.3);
    ctx.stroke();
  }

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
    // `fonts.ready` only covers faces the page has already used, and most of
    // these are used only on canvas, so each is asked for by name.
    await Promise.all([
      document.fonts.load(`600 40px ${DISPLAY}`),
      document.fonts.load(`500 40px ${SANS}`),
      document.fonts.load(`700 40px ${SANS}`),
      document.fonts.load(`500 20px ${MONO}`),
      document.fonts.load(`500 40px ${HEADLINE}`),
      document.fonts.load(`40px ${HAND}`),
    ]);
  } catch {
    /* keep going with fallback faces */
  }
}
