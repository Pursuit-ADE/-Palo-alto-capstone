import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { queryAudit } from '@/db/schema';
import { buildSeed } from '@/db/seed';
import { loadRegistry } from '@/registry/load';
import { answerIntent, ask, type Answer } from '@/semantic/answer';

const reg = loadRegistry();
const data = buildSeed();
let database: Database;

beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

async function answer(userId: string, phrase: string, previous?: unknown): Promise<Answer> {
  const r = await ask(database, reg, userId, phrase, { previous });
  if (r.kind !== 'answer') throw new Error(`expected an answer, got ${r.kind}`);
  return r;
}

describe('provenance panel data (answer object)', () => {
  it('carries the registry definition, the applied filters and the snapshot', async () => {
    const r = await answer('u_ts_east', 'What is our open pipeline?');
    const metric = reg.metrics.get('open_pipeline')!;
    expect(r.metric).toMatchObject({ id: 'open_pipeline', version: metric.version, definition: metric.description, notes: metric.notes });
    // Filters are what the query applied after scoping, not what the question said.
    expect(r.filters).toEqual({ period: null, regions: ['east'], stages: null, groupBy: [], amount: null, products: null, accounts: null, sectors: null, people: null, teams: null });
    expect(r.parts).toBeNull();
    expect(r.provenance.snapshotId).toBe(data.snapshot.id);
    expect(new Date(r.provenance.loadedAt).toISOString()).toBe(r.provenance.loadedAt);
    expect(r.provenance.dataNote).toMatch(/synthetic/);
  });

  it('points at the audit row written for this answer', async () => {
    const r = await answer('u_ts_east', 'how many open deals?');
    expect(r.provenance.auditId).not.toBe('');
    const [row] = await database.db.select().from(queryAudit).where(eq(queryAudit.id, r.provenance.auditId));
    expect(row).toMatchObject({ userId: 'u_ts_east', outcome: 'answered', resultHash: r.provenance.resultHash, snapshotId: r.provenance.snapshotId });
  });

  it('dashboard tiles get an audit ID too', async () => {
    const r = await answerIntent(database, reg, 'u_analyst', { metric: 'open_pipeline', filters: {}, groupBy: [] }, 'dashboard');
    const [row] = await database.db.select().from(queryAudit).where(eq(queryAudit.id, r.provenance.auditId));
    expect(row?.source).toBe('dashboard');
  });

  it('coverage shows the numerator and denominator, each with the same scope and quarter', async () => {
    const r = await answer('u_ts_east', 'pipeline coverage for this quarter');
    expect(r.filters.period).toEqual({ label: 'FY27-Q1', start: '2026-08-01', end: '2026-10-31' });
    const slice = r.scope.replace(/^Scope: /, '').replace(/\.$/, '');
    expect(r.parts?.numerator).toMatchObject({ label: 'Open pipeline v1', scope: `${slice} for FY27-Q1.` });
    expect(r.parts?.denominator).toMatchObject({ label: 'Quota', scope: `${slice} for FY27-Q1.` });
    expect(r.parts?.numerator.definition).toContain('FY27-Q1');
    expect(r.rows[0]).toHaveProperty('numerator');
    expect(r.rows[0]).toHaveProperty('denominator');
  });

  it('each follow-up turn has its own scope, filters and audit row', async () => {
    const first = await answer('u_analyst', 'What is our open pipeline?');
    const second = await answer('u_analyst', 'what about West?', first.intent);
    expect(first.filters.regions).toEqual(['central', 'east', 'west']);
    expect(second.filters.regions).toEqual(['west']);
    expect(second.scope).toMatch(/West region/);
    expect(second.provenance.auditId).not.toBe(first.provenance.auditId);
  });
});
