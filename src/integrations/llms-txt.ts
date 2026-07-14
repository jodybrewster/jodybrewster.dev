import type { AstroIntegration } from 'astro';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Frontmatter {
  title?: string;
  date?: string;
  pubDate?: string;
  description?: string;
  status?: string;
  publish?: boolean;
  draft?: boolean;
  sector?: string;
  role?: string;
  duration?: string;
  pillar?: string;
  tags?: string[];
}

interface Doc {
  slug: string;
  url: string;
  body: string;
  raw: string;
  fm: Frontmatter;
}

function parseFrontmatter(raw: string): { fm: Frontmatter; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: raw };
  const fm: Frontmatter = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val: string | string[] | boolean = line.slice(idx + 1).trim();
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    else if (typeof val === 'string') {
      if (val.startsWith('[') && val.endsWith(']')) {
        val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      } else {
        val = val.replace(/^["']|["']$/g, '');
      }
    }
    (fm as Record<string, unknown>)[key] = val;
  }
  return { fm, body: m[2].trim() };
}

async function readCollection(dir: string, urlBase: string, filter?: (fm: Frontmatter) => boolean): Promise<Doc[]> {
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter(f => f.endsWith('.md') || f.endsWith('.mdx'));
  } catch {
    return [];
  }
  const docs: Doc[] = [];
  for (const file of files) {
    const raw = await readFile(join(dir, file), 'utf-8');
    const { fm, body } = parseFrontmatter(raw);
    if (filter && !filter(fm)) continue;
    const slug = basename(file).replace(/\.mdx?$/, '');
    docs.push({ slug, url: `${urlBase}/${slug}`, body, raw, fm });
  }
  return docs;
}

async function generate(site: string): Promise<{ index: string; full: string; stats: { essays: number; notes: number; briefs: number; research: number; portfolio: number } }> {
  const contentRoot = resolve('content');

  const essays = (await readCollection(
    join(contentRoot, 'writing'),
    `${site}/writing`,
    fm => fm.status !== 'draft',
  )).sort((a, b) => (b.fm.date ?? '').localeCompare(a.fm.date ?? ''));

  const notes = (await readCollection(
    join(contentRoot, 'notes'),
    `${site}/notes`,
    fm => fm.publish === true,
  )).sort((a, b) => (b.fm.date ?? '').localeCompare(a.fm.date ?? ''));

  const briefs = (await readCollection(
    join(contentRoot, 'work'),
    `${site}/work`,
    fm => fm.draft !== true,
  )).sort((a, b) => (a.fm.title ?? '').localeCompare(b.fm.title ?? ''));

  const portfolio = (await readCollection(
    join(contentRoot, 'portfolio'),
    `${site}/portfolio`,
  )).sort((a, b) => (b.fm.date ?? '').localeCompare(a.fm.date ?? ''));

  const research = (await readCollection(
    join(contentRoot, 'research'),
    `${site}/research`,
    fm => fm.publish === true,
  )).sort((a, b) => (b.fm.pubDate ?? '').localeCompare(a.fm.pubDate ?? ''));

  let nowContent = '';
  try {
    const nowRaw = await readFile(join(contentRoot, 'now.md'), 'utf-8');
    nowContent = parseFrontmatter(nowRaw).body;
  } catch { /* no now.md */ }

  // ── llms.txt (curated index) ────────────────────────────
  const lines: string[] = [];
  lines.push('# Jody Brewster — jodybrewster.dev');
  lines.push('');
  lines.push('> A working notebook on AI experience architecture, runtime design, and the unfinished discipline of designing for agentic systems. Essays, notes, and case briefs from twenty years of design practice.');
  lines.push('');
  lines.push('Every page is available as raw markdown by appending `.md` to the URL, or by sending `Accept: text/markdown`.');
  lines.push('');
  lines.push('## Writing');
  lines.push('');
  for (const e of essays) {
    const desc = e.fm.description ? `: ${e.fm.description}` : '';
    lines.push(`- [${e.fm.title ?? e.slug}](${e.url}.md)${desc}`);
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  for (const n of notes) {
    const status = n.fm.status ? ` (${n.fm.status})` : '';
    lines.push(`- [${n.fm.title ?? n.slug}](${n.url}.md)${status}`);
  }
  lines.push('');
  lines.push('## Work');
  lines.push('');
  for (const b of briefs) {
    const sector = b.fm.sector ? ` — ${b.fm.sector}` : '';
    lines.push(`- [${b.fm.title ?? b.slug}](${b.url}.md)${sector}`);
  }
  lines.push('');
  lines.push('## Portfolio');
  lines.push('');
  for (const p of portfolio) {
    const desc = p.fm.description ? `: ${p.fm.description}` : '';
    lines.push(`- [${p.fm.title ?? p.slug}](${p.url}.md)${desc}`);
  }
  lines.push('');
  lines.push('## Research');
  lines.push('');
  for (const r of research) {
    const desc = r.fm.description ? `: ${r.fm.description}` : '';
    lines.push(`- [${r.fm.title ?? r.slug}](${r.url}.md)${desc}`);
  }
  lines.push('');
  if (nowContent) {
    lines.push('## Now');
    lines.push('');
    lines.push(`What Jody is currently focused on: ${site}/now`);
    lines.push('');
  }
  lines.push('## Optional');
  lines.push('');
  lines.push(`- [About](${site}/about): Jody's background and how to get in touch.`);
  lines.push(`- [For agents](${site}/agent): Tiered access — markdown endpoints, MCP server, A2A agent card.`);
  lines.push('');

  const index = lines.join('\n');

  // ── llms-full.txt (full corpus) ─────────────────────────
  const sep = '\n\n---\n\n';
  const fullParts: string[] = [];
  fullParts.push('# Jody Brewster — Full Corpus\n\nEvery published essay, note, and case brief.');
  if (essays.length) {
    fullParts.push(`# Writing\n\n${essays.map(e => `## ${e.fm.title ?? e.slug}\n\nSource: ${e.url}\n\n${e.body}`).join(sep)}`);
  }
  if (notes.length) {
    fullParts.push(`# Notes\n\n${notes.map(n => `## ${n.fm.title ?? n.slug}\n\nSource: ${n.url}\n\n${n.body}`).join(sep)}`);
  }
  if (briefs.length) {
    fullParts.push(`# Work\n\n${briefs.map(b => `## ${b.fm.title ?? b.slug}\n\nSource: ${b.url}\n\n${b.body}`).join(sep)}`);
  }
  if (portfolio.length) {
    fullParts.push(`# Portfolio\n\n${portfolio.map(p => `## ${p.fm.title ?? p.slug}\n\nSource: ${p.url}\n\n${p.body}`).join(sep)}`);
  }
  if (research.length) {
    fullParts.push(`# Research\n\n${research.map(r => `## ${r.fm.title ?? r.slug}\n\nSource: ${r.url}\n\n${r.body}`).join(sep)}`);
  }
  if (nowContent) {
    fullParts.push(`# Now\n\nSource: ${site}/now\n\n${nowContent}`);
  }
  const full = fullParts.join(sep);

  return { index, full, stats: { essays: essays.length, notes: notes.length, briefs: briefs.length, research: research.length, portfolio: portfolio.length } };
}

export function llmsTxt(options: { site: string }): AstroIntegration {
  const { site } = options;
  return {
    name: 'llms-txt',
    hooks: {
      // Dev: serve dynamically via Vite middleware so /llms.txt works in `astro dev`.
      'astro:server:setup': ({ server }) => {
        const serve = async (path: string, body: string) => body;
        server.middlewares.use(async (req, res, next) => {
          if (!req.url) return next();
          const url = req.url.split('?')[0];
          if (url !== '/llms.txt' && url !== '/llms-full.txt') return next();
          try {
            const { index, full } = await generate(site);
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(url === '/llms.txt' ? index : full);
          } catch (err) {
            console.error('[llms-txt] dev middleware error', err);
            res.statusCode = 500;
            res.end('llms.txt generation failed');
          }
        });
      },
      // Build: write static files into the build output.
      'astro:build:done': async ({ dir, logger }) => {
        const outDir = fileURLToPath(dir);
        const { index, full, stats } = await generate(site);
        await writeFile(join(outDir, 'llms.txt'), index, 'utf-8');
        await writeFile(join(outDir, 'llms-full.txt'), full, 'utf-8');
        logger.info(`Wrote llms.txt (${(index.length / 1024).toFixed(1)}KB, ${stats.essays} essays, ${stats.notes} notes, ${stats.briefs} briefs, ${stats.research} research)`);
      },
    },
  };
}
