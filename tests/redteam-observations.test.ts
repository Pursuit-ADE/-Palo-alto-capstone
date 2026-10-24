// Evidence probes: these assert observed residual behavior, not a desired security policy.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { loadRegistry } from '@/registry/load';
import { ask } from '@/semantic/answer';
import { askWithFallback } from '@/server/ask';
let database: Database;
const registry = loadRegistry();
beforeAll(async () => { database = await openDatabase(); });
afterAll(async () => { await database.close(); });
it('asks when a model metric contradicts a deterministic reading', async () => {
  const result = await ask(database, registry, 'u_ts_east', 'how many open deals?', {
    model: { name: 'synthetic-wrong-metric', async propose() {
      return { kind: 'intent', intent: { metric: 'open_pipeline', filters: {}, groupBy: [] } };
    } },
  });
  expect(result.kind).toBe('clarify');
});
it('known outside-team and unknown person names have different public responses', async () => {
  const known = await askWithFallback(database, registry, 'u_ts_east', 'open pipeline for Darcel Schlecht', {}, {
    name: 'synthetic-known', async propose() { return { kind: 'intent', intent: { metric: 'open_pipeline', filters: { people: ['Darcel Schlecht'] }, groupBy: [] } }; },
  });
  const unknown = await askWithFallback(database, registry, 'u_ts_east', 'open pipeline for Synthetic Missing Person', {}, {
    name: 'synthetic-unknown', async propose() { return { kind: 'intent', intent: { metric: 'open_pipeline', filters: { people: ['Synthetic Missing Person'] }, groupBy: [] } }; },
  });
  expect(known.kind).toBe('refused');
  expect(unknown.kind).toBe('refused');
  if (known.kind === 'refused' && unknown.kind === 'refused') {
    expect(known.message).toContain('do not have access');
    expect(unknown.message).toContain('Unknown person');
  }
});
