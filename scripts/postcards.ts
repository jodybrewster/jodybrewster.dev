/**
 * Picture sides for the /library postcards.
 *
 * Each place in content/places.json without a `photo` of Jody's own gets a
 * vintage postcard illustration generated from its `scene`, in one fixed
 * style, written to public/media/places/ and recorded back as `photo`. The
 * scene's "Greetings from" lettering is drawn over it in the browser, so the
 * picture itself carries no words. A real photograph always wins: put it in
 * public/media/places/, set `photo`, and this leaves the place alone.
 *
 *   npm run postcards              places with no photo yet
 *   npm run postcards -- Tokyo     just the named places, replacing what is there
 *
 * Needs OPENAI_API_KEY. Local only; the files are committed.
 */

import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const PLACES = resolve('content/places.json');
const OUT_DIR = resolve('public/media/places');
const MODEL = 'gpt-image-2';
/** Under the account's five images a minute, with room for a retry. */
const CONCURRENCY = 4;
/** A postcard face is drawn at 900px wide; more is only weight. */
const WIDTH = 1080;

// The part that must not drift between cards. The lettering is added by the
// site, so the picture must leave the top left open and carry no text.
const STYLE = [
  'A vintage 1950s linen-texture travel postcard illustration, hand painted, with the soft halftone and paper grain of an old printed card.',
  'Palette of Miami pastels at golden hour: peach, coral, lilac, flamingo pink, teal and warm cream, saturated but soft.',
  // Without this the palette drags Miami Beach into every city: Nashville came
  // back as Ocean Drive, palms and all.
  'Only the palette is borrowed from Miami: draw the place itself, its own buildings, landscape and plants, with palm trees only where that place really has them.',
  'Landscape composition. The upper left third is open sky or plain background, because large lettering is added there later.',
  'Absolutely no text, letters, numbers, words, signs with legible writing, logos or borders. No people in close up.',
].join(' ');

interface Place {
  title: string;
  scene?: string;
  photo?: string;
  [key: string]: unknown;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['‘’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function request(title: string, init: RequestInit): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://api.openai.com/v1/images/generations', init);
    if (res.status !== 429 || attempt === 6) return res;
    const wait = Number((await res.clone().text()).match(/try again in ([\d.]+)s/)?.[1] ?? 20);
    console.log(`${title}: rate limited, retrying in ${Math.ceil(wait)}s`);
    await new Promise(done => setTimeout(done, (wait + 1) * 1000));
  }
}

async function generate(place: Place): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set.');
  const res = await request(place.title, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: `${STYLE} Subject: ${place.scene}.`,
      size: '1536x1024',
      quality: 'medium',
    }),
  });
  const body = await res.json() as { data?: { b64_json?: string }[]; error?: { message: string } };
  const data = body.data?.[0]?.b64_json;
  if (!res.ok || !data) throw new Error(`${place.title}: no image returned (${body.error?.message ?? res.status})`);
  const file = `place-${slugify(place.title)}.webp`;
  await sharp(Buffer.from(data, 'base64')).resize({ width: WIDTH }).removeAlpha().webp({ quality: 80 }).toFile(resolve(OUT_DIR, file));
  return `/media/places/${file}`;
}

const named = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const raw = JSON.parse(await readFile(PLACES, 'utf-8')) as { places: Place[] };
const todo = raw.places.filter(place => (named.length ? named.includes(place.title) : !place.photo));
for (const place of todo) if (!place.scene) throw new Error(`${place.title} has no scene in ${PLACES}.`);
await mkdir(OUT_DIR, { recursive: true });
console.log(`Postcards: ${todo.length} to draw`);

const failed: string[] = [];
let next = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < todo.length) {
    const place = todo[next++];
    try {
      place.photo = await generate(place);
      console.log(`  ${place.title}`);
    } catch (error) {
      failed.push((error as Error).message);
    }
  }
}));

await writeFile(PLACES, `${JSON.stringify(raw, null, 2)}\n`, 'utf-8');
if (failed.length) {
  console.log(`Failed (${failed.length}):`);
  for (const line of failed) console.log(`  - ${line}`);
  process.exitCode = 1;
}
