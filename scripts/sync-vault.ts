/**
 * Sync Obsidian vault → committed ./content/ directory.
 *
 * Source path is `<VAULT>/personal/projects/jodybrewster.dev/<CONTENT_SOURCE>`
 * where CONTENT_SOURCE is either "scaffold" (placeholder demo content) or
 * "real" (Jody's actual published writing). Set via env var; defaults to
 * scaffold so the site has something to render out of the box.
 *
 * Sync is non-destructive: it overwrites files that exist in the source and
 * leaves untracked files in ./content/ alone. To wipe content/ first, pass
 * `--clean`.
 *
 *   npm run sync                      → scaffold mode
 *   CONTENT_SOURCE=real npm run sync  → real mode
 *   npm run sync -- --clean           → wipe destination dirs first
 */
import 'dotenv/config';
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const VAULT_ROOT = '/Users/jodybrewster/Library/Mobile Documents/iCloud~md~obsidian/Documents/Sheikah Slate/personal/projects/jodybrewster.dev';
const CONTENT_BASE = new URL('../content', import.meta.url).pathname;
const SOURCE = (process.env.CONTENT_SOURCE ?? 'scaffold').trim();
const CLEAN = process.argv.includes('--clean');

if (SOURCE !== 'scaffold' && SOURCE !== 'real') {
  console.error(`CONTENT_SOURCE must be 'scaffold' or 'real' (got '${SOURCE}')`);
  process.exit(1);
}

const VAULT_BASE = join(VAULT_ROOT, SOURCE);

async function parseFrontmatter(content: string): Promise<Record<string, unknown>> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Record<string, unknown> = {};
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) {
      const val = rest.join(':').trim();
      if (val === 'true') fm[key.trim()] = true;
      else if (val === 'false') fm[key.trim()] = false;
      else fm[key.trim()] = val.replace(/^["']|["']$/g, '');
    }
  }
  return fm;
}

async function syncDir(subdir: string, filter?: (fm: Record<string, unknown>) => boolean) {
  const src = join(VAULT_BASE, subdir);
  const dst = join(CONTENT_BASE, subdir);

  if (!existsSync(src)) {
    console.log(`  ${subdir}: source not found, skipping`);
    return;
  }
  if (CLEAN) {
    await rm(dst, { recursive: true, force: true });
  }
  await mkdir(dst, { recursive: true });

  const files = (await readdir(src)).filter(f => f.endsWith('.md') || f.endsWith('.mdx'));
  let copied = 0;
  let skipped = 0;

  for (const file of files) {
    const content = await readFile(join(src, file), 'utf-8');
    if (filter) {
      const fm = await parseFrontmatter(content);
      if (!filter(fm)) { skipped++; continue; }
    }
    await writeFile(join(dst, file), content, 'utf-8');
    copied++;
  }
  console.log(`  ${subdir}: ${copied} copied${skipped ? ` (${skipped} filtered)` : ''}`);
}

async function syncNow() {
  const src = join(VAULT_BASE, 'now.md');
  const dst = join(CONTENT_BASE, 'now.md');
  if (!existsSync(src)) {
    console.log('  now.md: source not found, skipping');
    return;
  }
  const content = await readFile(src, 'utf-8');
  await writeFile(dst, content, 'utf-8');
  console.log('  now.md: copied');
}

async function main() {
  console.log(`Syncing vault → content/  (source: ${SOURCE}${CLEAN ? ', clean' : ''})`);
  console.log(`  from: ${VAULT_BASE}`);
  if (!existsSync(VAULT_BASE)) {
    console.error(`Source directory does not exist: ${VAULT_BASE}`);
    process.exit(1);
  }
  await syncDir('writing');
  await syncDir('notes', fm => fm.publish === true);
  await syncDir('work');
  await syncNow();
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
