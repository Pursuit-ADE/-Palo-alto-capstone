// Client components never reach the database code, so its schema stays out of the browser bundle (review of #102).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
// Modules that only make sense on the server. Reaching one from a client component ships it to every browser.
const SERVER_ONLY = [/^drizzle-orm/, /^pg$/, /^@electric-sql\/pglite/, /^src\/db\//];

/** Value imports only: `import type` and `export type` are erased and never reach the bundle. */
function importsOf(source: string): string[] {
  const specs: string[] = [];
  for (const m of source.matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) specs.push(m[1]!);
  return specs;
}

/** A repo file for an import, or the bare package name for a dependency. */
function resolveImport(spec: string, from: string): string {
  const base = spec.startsWith('@/') ? join(ROOT, 'src', spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null;
  if (!base) return spec;
  return ['', '.ts', '.tsx', '/index.ts', '/index.tsx'].map((ext) => base + ext).find((f) => existsSync(f) && statSync(f).isFile()) ?? base;
}

/** Every module a client component reaches. A 'use server' file stops the walk: Next.js sends the browser a stub. */
function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const todo = [entry];
  while (todo.length) {
    const file = todo.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!file.startsWith(ROOT) || !/\.tsx?$/.test(file)) continue;
    const source = readFileSync(file, 'utf8');
    if (file !== entry && /^\s*['"]use server['"]/.test(source)) continue;
    for (const spec of importsOf(source)) todo.push(resolveImport(spec, file));
  }
  return seen;
}

const clientComponents = readdirSync(join(ROOT, 'app'), { recursive: true })
  .map((f) => join(ROOT, 'app', String(f)))
  .filter((f) => /\.tsx?$/.test(f) && /^\s*['"]use client['"]/.test(readFileSync(f, 'utf8')));

describe('client components stay off the database code', () => {
  it('finds the client components', () => {
    expect(clientComponents.map((f) => relative(ROOT, f))).toContain('app/ask-panel.tsx');
  });

  it.each(clientComponents.map((f) => [relative(ROOT, f), f]))('%s', (_name, file) => {
    const server = [...reachable(file)].map((m) => (m.startsWith(ROOT) ? relative(ROOT, m) : m)).filter((m) => SERVER_ONLY.some((p) => p.test(m)));
    expect(server).toEqual([]);
  });
});
