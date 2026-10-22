/**
 * Checks that moving text out of one Markdown file lost nothing and copied
 * nothing: every sentence, table row, code line and heading of the old file
 * must appear in exactly one of the target files. Line breaks, list markers
 * and bold markers are ignored. Text may be reflowed to one sentence per
 * line; the words themselves may not change.
 *
 *   npx tsx scripts/check-moved-sentences.ts <git-ref>:<file> <target.md>... \
 *     [--retarget "<old sentence>=><new sentence>"]
 *
 * A heading counts as found when a target heading contains its text. A bold
 * lead-in such as "**Audit log.**" counts when it is still there or a target
 * heading contains it. --retarget names a sentence that was
 * deliberately changed (a pointer that no longer points anywhere); the new
 * wording must then appear in exactly one target instead. Exits 1 on any miss
 * or duplicate.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

type Unit = { kind: 'sentence' | 'row' | 'code' | 'heading' | 'label'; text: string };

const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[A-Z`(["*/])/;
const LIST_MARKER = /^\s*(?:[-*]|\d+\.)\s+/;
const squash = (s: string) => s.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();

function units(markdown: string): Unit[] {
  const out: Unit[] = [];
  let fenced = false;
  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('```')) { fenced = !fenced; continue; }
    if (!line.trim()) continue;
    if (fenced) { out.push({ kind: 'code', text: squash(line) }); continue; }
    const heading = line.match(/^#+\s+(.*)$/);
    if (heading) { out.push({ kind: 'heading', text: squash(heading[1]) }); continue; }
    if (line.startsWith('|')) {
      if (!/^\|[\s|:-]+\|$/.test(line)) out.push({ kind: 'row', text: squash(line) });
      continue;
    }
    let prose = line.replace(LIST_MARKER, '');
    const label = prose.match(/^\*\*([^*]+?)\.\*\*\s+/);
    if (label && label[1].split(' ').length <= 3) {
      out.push({ kind: 'label', text: squash(label[1]) });
      prose = prose.slice(label[0].length);
    }
    for (const sentence of prose.split(SENTENCE_BREAK)) out.push({ kind: 'sentence', text: squash(sentence) });
  }
  return out;
}

function index(markdown: string) {
  const lines = markdown.split('\n');
  const headings = lines.flatMap(l => l.match(/^#+\s+(.*)$/)?.[1] ?? []).map(h => squash(h).toLowerCase());
  const text = squash(lines.map(l => l.replace(LIST_MARKER, '')).join(' '));
  return { headings, text };
}

const args = process.argv.slice(2);
const retargets = new Map<string, string>();
const positional: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--retarget') {
    const [from, to] = args[++i].split('=>');
    retargets.set(squash(from), squash(to));
  } else positional.push(args[i]);
}
const [source, ...targets] = positional;
if (!source?.includes(':') || targets.length === 0) {
  console.error('Usage: npx tsx scripts/check-moved-sentences.ts <git-ref>:<file> <target.md>... [--retarget "old=>new"]');
  process.exit(1);
}

const old = units(execFileSync('git', ['show', source], { encoding: 'utf8' }));
const files = targets.map(path => ({ path, ...index(readFileSync(path, 'utf8')) }));
const perFile = new Map(targets.map(t => [t, 0]));
const problems: string[] = [];

for (const unit of old) {
  const wanted = retargets.get(unit.text) ?? unit.text;
  const hits = files.filter(f =>
    unit.kind === 'heading'
      ? f.headings.some(h => h.includes(wanted.toLowerCase()))
      : unit.kind === 'label'
        ? f.headings.some(h => h.includes(wanted.toLowerCase())) || f.text.includes(`${wanted}.`)
        : f.text.includes(wanted),
  );
  if (hits.length === 1) perFile.set(hits[0].path, perFile.get(hits[0].path)! + 1);
  else problems.push(`${hits.length === 0 ? 'MISSING' : `IN ${hits.length} FILES (${hits.map(h => h.path).join(', ')})`}: [${unit.kind}] ${unit.text}`);
}

const kinds = old.reduce<Record<string, number>>((acc, u) => ({ ...acc, [u.kind]: (acc[u.kind] ?? 0) + 1 }), {});
console.log(`${source}: ${old.length} units (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')})`);
for (const [path, n] of perFile) console.log(`  ${String(n).padStart(4)}  ${path}`);
for (const [from, to] of retargets) console.log(`  retargeted: "${from}" -> "${to}"`);
if (problems.length) {
  console.log(`${problems.length} problem(s):`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}
console.log(`OK: every unit appears in exactly one file.`);
