import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { buildSeed, QUOTA_PERIODS } from '@/db/seed';
import { loadRegistry } from '@/registry/load';
import { answerIntent, ask, type Answer } from '@/semantic/answer';
import { IntentError } from '@/semantic/compile';
import { ScopeViolation } from '@/semantic/scope';

const reg = loadRegistry();
const seed = buildSeed();
let database: Database;

beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.client.close();
});

const open = seed.opportunities.filter((o) => !o.isClosed);
const sum = (xs: { amount: string }[]) => xs.reduce((t, o) => t + Number(o.amount), 0);
const q1 = QUOTA_PERIODS[0];
const inQ1 = (o: { closeDate: string }) => o.closeDate >= q1.start && o.closeDate <= q1.end;

async function answer(userId: string, phrase: string): Promise<Answer> {
  const r = await ask(database, reg, userId, phrase);
  if (r.kind !== 'answer') throw new Error(`expected an answer, got ${r.kind}`);
  return r;
}

describe('governed metrics against the seeded database', () => {
  it('open pipeline for the analyst equals the hand-computed total', async () => {
    const r = await answer('u_analyst', 'What is our open pipeline?');
    expect(r.rows[0]!.value).toBeCloseTo(sum(open), 2);
    expect(r.provenance.snapshotId).toBe(seed.snapshot.id);
  });

  it('open opportunity count matches the seed', async () => {
    const r = await answer('u_analyst', 'how many open deals?');
    expect(r.rows[0]!.value).toBe(open.length);
  });

  it('coverage by region = open pipeline closing in the quarter / quota for the quarter', async () => {
    const r = await answer('u_analyst', 'coverage by region for this quarter');
    for (const region of ['east', 'west']) {
      const quota = Number(seed.quotas.find((q) => q.regionId === region && q.period === 'FY27-Q1')!.amount);
      const pipe = sum(open.filter((o) => o.regionId === region && inQ1(o)));
      const row = r.rows.find((x) => x.region === region)!;
      expect(row.value).toBeCloseTo(Math.round((pipe / quota) * 10000) / 10000, 4);
    }
  });

  it('every phrasing in the golden set for a metric returns the same number', async () => {
    const values = await Promise.all(
      ['What is our open pipeline?', 'show me total pipeline', 'how much open pipe do we have'].map(async (p) => (await answer('u_analyst', p)).rows[0]!.value),
    );
    expect(new Set(values).size).toBe(1);
  });
});

describe('role-based scope', () => {
  it('East and West sellers get different, correctly scoped numbers from the same formula', async () => {
    const east = await answer('u_ts_east', 'What is our open pipeline?');
    const west = await answer('u_ts_west', 'What is our open pipeline?');
    expect(east.rows[0]!.value).toBeCloseTo(sum(open.filter((o) => o.regionId === 'east')), 2);
    expect(west.rows[0]!.value).toBeCloseTo(sum(open.filter((o) => o.regionId === 'west')), 2);
    expect(east.scope).toContain('East');
    expect(west.scope).toContain('West');
  });

  it('refuses a seller who asks for another region instead of widening scope', async () => {
    await expect(ask(database, reg, 'u_ts_east', 'number of open deals in the west')).rejects.toBeInstanceOf(ScopeViolation);
  });

  it('refuses an unknown user', async () => {
    await expect(ask(database, reg, 'u_new_ceo', 'What is our open pipeline?')).rejects.toBeInstanceOf(ScopeViolation);
  });
});

describe('intent validation and injection', () => {
  it('rejects intents with unknown metrics, extra fields or raw SQL', async () => {
    await expect(answerIntent(database, reg, 'u_analyst', { metric: 'drop_tables', filters: {}, groupBy: [] })).rejects.toBeInstanceOf(IntentError);
    await expect(answerIntent(database, reg, 'u_analyst', { metric: 'open_pipeline', filters: {}, groupBy: [], sql: 'SELECT 1' })).rejects.toBeInstanceOf(IntentError);
    await expect(answerIntent(database, reg, 'u_analyst', { metric: 'pipeline_coverage', filters: { period: 'FY27-Q1' }, groupBy: ['stage'] })).rejects.toBeInstanceOf(IntentError);
  });

  it('treats a SQL-injection string in a filter as a plain value, not SQL', async () => {
    const r = await answerIntent(database, reg, 'u_analyst', {
      metric: 'open_opportunity_count',
      filters: { stages: ["Proposal' OR '1'='1"] },
      groupBy: [],
    });
    expect(r.rows[0]!.value).toBe(0);
    const accounts = await database.client.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM accounts');
    expect(accounts.rows[0]!.n).toBe(seed.accounts.length);
  });
});
