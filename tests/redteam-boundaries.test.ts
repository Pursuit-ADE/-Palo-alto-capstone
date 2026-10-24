import { afterAll, beforeAll, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { openDatabase, type Database } from '@/db/client';
import { dataSnapshots, quotas } from '@/db/schema';
import { loadRegistry } from '@/registry/load';
import { answerIntent, ask, currentSnapshot } from '@/semantic/answer';

const registry = loadRegistry();
let database: Database;
beforeAll(async () => { database = await openDatabase(); });
afterAll(async () => { await database.close(); });

it('keeps a pipeline region visible when its quota rows are absent', async () => {
  await database.db.delete(quotas).where(and(eq(quotas.regionId, 'central'), eq(quotas.period, 'FY27-Q1')));
  const result = await answerIntent(database, registry, 'u_analyst', {
    metric: 'pipeline_coverage', filters: { period: 'FY27-Q1' }, groupBy: ['region'],
  });
  const central = result.rows.find(row => row.region === 'central');
  expect(central).toBeDefined();
  expect(central!.numerator).toBeGreaterThan(0);
  expect(central!.value).toBeNull();
  expect(result.narrative).toContain('no quota');
});

it('uses the same snapshot for relative-period interpretation and execution', async () => {
  const original = (await currentSnapshot(database))!;
  const result = await ask(database, registry, 'u_analyst', 'open pipeline this quarter', {
    model: {
      name: 'synthetic-snapshot-barrier',
      async propose(_question, _registry, asOfDate) {
        expect(asOfDate).toBe(original.asOfDate);
        await database.db.insert(dataSnapshots).values({
          id: 'snap_redteam_new', seed: 'synthetic', asOfDate: '2026-11-02', loadedAt: new Date('2026-11-02T00:00:00Z'),
        });
        return { kind: 'intent', intent: { metric: 'open_pipeline', filters: { period: 'FY27-Q1' }, groupBy: [] } };
      },
    },
  });
  expect(result.kind).toBe('answer');
  if (result.kind === 'answer') {
    expect(result.provenance.snapshotId).toBe(original.id);
    expect(result.rows[0]!.value).toBeGreaterThan(0);
  }
});
