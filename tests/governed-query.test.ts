import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { buildSeed, QUOTA_PERIODS } from '@/db/seed';
import { loadRegistry } from '@/registry/load';
import { answerIntent, ask, type Answer } from '@/semantic/answer';
import { IntentError } from '@/semantic/compile';
import { ScopeViolation } from '@/semantic/scope';

const reg = loadRegistry();
const data = buildSeed();
let database: Database;

beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

const open = data.opportunities.filter((o) => !o.isClosed);
const sum = (xs: { amount: string }[]) => xs.reduce((t, o) => t + Number(o.amount), 0);
const q1 = QUOTA_PERIODS[0];
const inQ1 = (o: { closeDate: string }) => o.closeDate >= q1.start && o.closeDate <= q1.end;
const teamOf = (managerId: string) => new Set(data.users.filter((u) => u.managerId === managerId && u.role === 'sales_rep').map((u) => u.id));
const ratio = (num: number, den: number) => Math.round((num / den) * 10000) / 10000;

async function answer(userId: string, phrase: string): Promise<Answer> {
  const r = await ask(database, reg, userId, phrase);
  if (r.kind !== 'answer') throw new Error(`expected an answer, got ${r.kind}`);
  return r;
}

describe('governed metrics against the loaded CRM data', () => {
  it('open pipeline for the analyst equals the hand-computed total', async () => {
    const r = await answer('u_analyst', 'What is our open pipeline?');
    expect(r.rows[0]!.value).toBeCloseTo(sum(open), 2);
    expect(r.provenance.snapshotId).toBe(data.snapshot.id);
  });

  it('open opportunity count matches the source (Prospecting + Engaging)', async () => {
    const r = await answer('u_analyst', 'how many open deals?');
    expect(r.rows[0]!.value).toBe(open.length);
  });

  it('coverage by region = open pipeline closing in the quarter / quota for the quarter', async () => {
    const r = await answer('u_analyst', 'coverage by region for this quarter');
    for (const region of ['central', 'east', 'west']) {
      const quota = sum(data.quotas.filter((q) => q.regionId === region && q.period === 'FY27-Q1'));
      const pipe = sum(open.filter((o) => o.regionId === region && inQ1(o)));
      expect(r.rows.find((x) => x.region === region)!.value).toBeCloseTo(ratio(pipe, quota), 4);
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
  it('technical sellers see only the team they support, so East and West get different numbers', async () => {
    const east = await answer('u_ts_east', 'What is our open pipeline?');
    const west = await answer('u_ts_west', 'What is our open pipeline?');
    const eastTeam = teamOf('u_mgr_cara_losch');
    const westTeam = teamOf('u_mgr_celia_rouche');
    expect(east.rows[0]!.value).toBeCloseTo(sum(open.filter((o) => eastTeam.has(o.ownerUserId))), 2);
    expect(west.rows[0]!.value).toBeCloseTo(sum(open.filter((o) => westTeam.has(o.ownerUserId))), 2);
    expect(east.scope).toContain('East');
    expect(east.scope).toContain('Cara Losch');
  });

  it('a sales rep sees only their own deals', async () => {
    const r = await answer('u_darcel_schlecht', 'how many open deals?');
    expect(r.rows[0]!.value).toBe(open.filter((o) => o.ownerUserId === 'u_darcel_schlecht').length);
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
      filters: { stages: ["Engaging' OR '1'='1"] },
      groupBy: [],
    });
    expect(r.rows[0]!.value).toBe(0);
    const accounts = await database.client.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM accounts');
    expect(accounts.rows[0]!.n).toBe(data.accounts.length);
  });
});
