/**
 * Generates the ink illustrations for writing and research pieces.
 *
 * content/article-images.json is kept by hand: per article slug, one literal subject taken from what the piece
 * actually says (naming the single element that carries the cyan accent), a ground colour and the third of the
 * frame the subject sits on. This wraps each subject in the fixed house style below, generates it with OpenAI's
 * image model, and writes public/images/articles/<slug>.webp. The files are committed like the book jackets, so
 * nothing here runs in the build.
 *
 * Images already on disk are skipped. Name slugs to regenerate just those; pass --force to regenerate everything.
 * --regrade reapplies the ground correction from the cached originals in .cache/article-images without generating.
 *
 *   npm run article-images [-- slug ...] [-- --force] [-- --regrade]
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const MANIFEST = resolve('content/article-images.json');
const OUT_DIR = resolve('public/images/articles');
/** The model's originals, gitignored, so a regrade always starts from the source rather than from a graded copy. */
const RAW_DIR = resolve('.cache/article-images');
const MODEL = 'gpt-image-2';
/** Under the account's five images a minute, with room for a retry. */
const CONCURRENCY = 4;
/** Card and hero crop this to 2:1 and 21:9, so wider is only weight. */
const WIDTH = 1536;
/** Mid-tone blues: lighter than the navy page so the cards lift off it, dark enough for off-white line and the cyan
 *  accent. Each article names one in the manifest. */
const GROUNDS = {
  slate: { name: 'slate blue', rgb: [0x3d, 0x5a, 0x80] },
  denim: { name: 'denim blue', rgb: [0x2f, 0x5f, 0x8f] },
  cornflower: { name: 'cornflower blue', rgb: [0x4f, 0x7c, 0xc0] },
  steel: { name: 'steel blue', rgb: [0x3f, 0x7a, 0x96] },
};

/** The hue of --studio-cyan (#00c6e7), the accent every image shares. */
const ACCENT_HUE = 189;

const hex = (rgb: number[]) => `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('')}`;

// The style is the part that must not drift between articles. Every clause here was added because a sample broke it.
const style = (ground: (typeof GROUNDS)[keyof typeof GROUNDS]) => [
  'Editorial spot illustration in the style of a literary magazine.',
  `Confident hand-drawn ink linework in off-white (#eef2f6) with subtle crosshatching, on a completely flat ${ground.name} ground (${hex(ground.rgb)}) with faint paper grain, the same colour from edge to edge with no border, frame, vignette, gradient or lighter band.`,
  `The accent element is filled in flat light cyan (#00c6e7); everything else is off-white line on the ${ground.name} ground, with object interiors left as the ground colour. No other colours.`,
  'Witty and understated. Nothing decorative: no plants, palm leaves, sunglasses or props the subject does not name.',
].join(' ');

// Framed like a film still rather than a spot icon: close in, off centre, the empty side of the frame doing work.
const frame = (side: Side) => [
  `Landscape 3:2 image, composed by the rule of thirds: the subject is large, drawn close up, and sits on the ${side} third of the frame,`,
  `and may run off the ${side} edge. The other two thirds are open ground, with at most a small secondary detail.`,
  'Vertically the subject fills the middle 60% of the height and nothing reaches the top or bottom edge, because the image is cropped to a 21:9 band.',
  'No screens, phones, tablets or devices. No glow, light rays, gradients or 3D rendering. No sci-fi or futuristic elements.',
  'No people, no logos, no captions, titles or book spines with words, and no text unless the subject asks for it.',
].join(' ');

type Side = 'left' | 'right';
/** Ground and side are chosen per article, against the order the cards appear in, so neighbours differ. */
type Entry = { subject: string; ground: keyof typeof GROUNDS; side: Side };
type Manifest = Record<string, Record<string, Entry>>;

const args = process.argv.slice(2);
const force = args.includes('--force');
const regrade = args.includes('--regrade');
const named = args.filter(arg => !arg.startsWith('--'));

const manifest: Manifest = JSON.parse(await readFile(MANIFEST, 'utf-8'));
const entries = new Map<string, Entry>();
for (const group of Object.values(manifest)) {
  for (const [slug, entry] of Object.entries(group)) {
    if (entries.has(slug)) throw new Error(`${slug} appears twice in ${MANIFEST}; images are stored by slug alone.`);
    if (!Object.hasOwn(GROUNDS, entry.ground)) throw new Error(`${slug}: unknown ground "${entry.ground}".`);
    entries.set(slug, entry);
  }
}
for (const slug of named) if (!entries.has(slug)) throw new Error(`No subject for ${slug} in ${MANIFEST}.`);

await mkdir(OUT_DIR, { recursive: true });
await mkdir(RAW_DIR, { recursive: true });

/** The account allows a handful of images a minute; a refused call waits as long as the API says and tries again. */
async function request(slug: string, init: RequestInit): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://api.openai.com/v1/images/generations', init);
    if (res.status !== 429 || attempt === 6) return res;
    const wait = Number((await res.clone().text()).match(/try again in ([\d.]+)s/)?.[1] ?? 20);
    console.log(`${slug}: rate limited, retrying in ${Math.ceil(wait)}s`);
    await new Promise(done => setTimeout(done, (wait + 1) * 1000));
  }
}

async function generate(slug: string, entry: Entry): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set.');
  const res = await request(slug, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: `${style(GROUNDS[entry.ground])} Subject: ${entry.subject}. ${frame(entry.side)}`,
      size: '1536x1024',
      quality: 'high',
    }),
  });
  const body = await res.json() as { data?: { b64_json?: string }[]; error?: { message: string } };
  const data = body.data?.[0]?.b64_json;
  if (!res.ok || !data) throw new Error(`${slug}: no image returned (${body.error?.message ?? res.status})`);
  const original = Buffer.from(data, 'base64');
  await writeFile(resolve(RAW_DIR, `${slug}.png`), original);
  await writeImage(original, resolve(OUT_DIR, `${slug}.webp`), entry);
  console.log(`wrote ${slug}`);
}

/** The model drifts between colours however firmly it is asked, so the ground is measured from the open two thirds of
 *  the frame (the side the subject is not on) and remapped to the article's ground per channel, keeping white where it
 *  is. The median, not the mean: the paper grain is speckle that pulls a mean off the real colour. A roll that would
 *  need an extreme correction is refused rather than written. */
async function writeImage(original: Buffer, out: string, entry: Entry): Promise<void> {
  const resized = await sharp(original).resize({ width: WIDTH }).removeAlpha().toBuffer();
  const ground = await groundColour(resized, entry.side);
  const target = GROUNDS[entry.ground].rgb;
  const scale = target.map((value, i) => (255 - value) / Math.max(1, 255 - ground[i]));
  if (scale.some(value => value < 0.6 || value > 1.6)) throw new Error(`${out}: ground came back as ${hex(ground)}, too far from ${hex(target)} to correct. Generate it again.`);
  const offset = target.map((value, i) => value - ground[i] * scale[i]);
  const { data, info } = await sharp(resized).linear(scale, offset).raw().toBuffer({ resolveWithObject: true });
  snapAccent(data, info.channels, target);
  await sharp(data, { raw: info }).webp({ quality: 82 }).toFile(out);
}

async function groundColour(image: Buffer, side: Side): Promise<number[]> {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const third = Math.round(info.width / 3);
  const [from, to] = side === 'right' ? [0, third] : [info.width - third, info.width];
  return [0, 1, 2].map(channel => {
    const values: number[] = [];
    for (let y = 0; y < info.height; y += 4) for (let x = from; x < to; x += 4) values.push(data[(y * info.width + x) * info.channels + channel]);
    values.sort((a, b) => a - b);
    return values[values.length >> 1];
  });
}

/** The accent comes back anywhere from teal-green to blue depending on the ground, and the ground remap moves it further.
 *  Every saturated pixel in that hue band is turned to --studio-cyan's hue and pushed toward its saturation, keeping its
 *  lightness so the anti-aliased edges stay smooth. Pixels near the blue ground are left alone, and the off-white ink
 *  is not saturated enough to match. */
function snapAccent(data: Buffer, channels: number, ground: number[]): void {
  for (let i = 0; i < data.length; i += channels) {
    if (Math.hypot(data[i] - ground[0], data[i + 1] - ground[1], data[i + 2] - ground[2]) < 70) continue;
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (h < 140 || h > 240 || s < 0.3 || l < 0.2) continue;
    const [r, g, b] = hslToRgb(ACCENT_HUE, s + (1 - s) * 0.8, l);
    data[i] = r; data[i + 1] = g; data[i + 2] = b;
  }
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map(value => Math.round((value + m) * 255)) as [number, number, number];
}

if (regrade) {
  for (const slug of named.length ? named : [...entries.keys()]) {
    const raw = resolve(RAW_DIR, `${slug}.png`);
    if (!existsSync(raw)) { console.log(`skipped ${slug}: no original in ${RAW_DIR}`); continue; }
    await writeImage(await readFile(raw), resolve(OUT_DIR, `${slug}.webp`), entries.get(slug)!);
    console.log(`regraded ${slug}`);
  }
  process.exit();
}

const queue = [...entries].filter(([slug]) => named.length ? named.includes(slug) : force || !existsSync(resolve(OUT_DIR, `${slug}.webp`)));
const results: PromiseSettledResult<void>[] = [];
for (let i = 0; i < queue.length; i += CONCURRENCY) {
  results.push(...await Promise.allSettled(queue.slice(i, i + CONCURRENCY).map(([slug, entry]) => generate(slug, entry))));
}
const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
for (const failure of failed) console.error(String(failure.reason));
if (failed.length) process.exitCode = 1;
