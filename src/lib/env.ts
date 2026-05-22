/**
 * Astro/Vite exposes .env to import.meta.env at dev time; Vercel populates
 * process.env at runtime. This helper checks both so the same code works in
 * `astro dev`, `vercel dev`, and prod.
 */
export function env(key: string): string | undefined {
  // import.meta.env is statically replaced by Vite at build time when keys are
  // accessed as literals, so we read both sources defensively.
  const fromMeta = (import.meta.env as Record<string, string | undefined>)[key];
  const fromProc = (typeof process !== 'undefined' ? process.env[key] : undefined);
  return fromProc || fromMeta;
}
