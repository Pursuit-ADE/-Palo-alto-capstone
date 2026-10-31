import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { buildSeed, QUOTA_PERIODS } from '@/db/seed';
import { loadRegistry } from '@/registry/load';
import golden from '../registry/golden/phrases.json';
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

// Golden phrasings grouped by expected intent; keys are sorted so {regions, period} and {period, regions} group together.
const canonical = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canonical)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)]))
  : v;
const equivalentPhrasings = (() => {
  const groups = new Map<string, string[]>();
  for (const c of golden.cases) {
    if (!('metric' in c.expect)) continue;
    const key = JSON.stringify(canonical(c.expect));
    groups.set(key, [...(groups.get(key) ?? []), c.phrase]);
  }
  return [...groups.values()].filter((phrases) => phrases.length > 1);
})();

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

  it('equivalent golden phrasings return the same numbers', async () => {
    expect(equivalentPhrasings.length).toBeGreaterThanOrEqual(8);
    for (const phrases of equivalentPhrasings) {
      const answers = [];
      for (const phrase of phrases) answers.push(await answer('u_analyst', phrase));
      for (const [i, a] of answers.entries()) {
        expect(a.rows, phrases[i]).toEqual(answers[0]!.rows);
      }
    }
  });

  it('equivalent golden phrasings agree for scoped users too (same rows, or the same refusal)', async () => {
    const outcome = async (userId: string, phrase: string) => {
      try {
        const r = await ask(database, reg, userId, phrase);
        return r.kind === 'answer' ? { rows: r.rows } : { kind: r.kind };
      } catch (e) {
        return { error: (e as Error).constructor.name };
      }
    };
    for (const userId of ['u_ts_east', 'u_darcel_schlecht']) {
      for (const phrases of equivalentPhrasings) {
        const first = await outcome(userId, phrases[0]!);
        for (const phrase of phrases.slice(1)) {
          expect(await outcome(userId, phrase), `${userId}: ${phrase}`).toEqual(first);
        }
      }
    }
  });

  it('filters open pipeline by product, series, account, sector, rep and deal size', async () => {
    const gtx = open.filter((o) => o.productId === 'GTX Pro');
    expect((await answer('u_analyst', 'open pipeline for GTX Pro')).rows[0]!.value).toBeCloseTo(sum(gtx), 2);

    const seriesIds = new Set(data.products.filter((p) => p.series === 'GTX').map((p) => p.id));
    expect((await answer('u_analyst', 'open pipeline for GTX')).rows[0]!.value).toBeCloseTo(sum(open.filter((o) => seriesIds.has(o.productId))), 2);
    expect((await answer('u_analyst', 'open pipeline for GTX')).narrative).toContain('GTX series');

    const retail = new Set(data.accounts.filter((a) => a.sector === 'retail').map((a) => a.id));
    expect((await answer('u_analyst', 'open pipeline in the retail sector')).rows[0]!.value).toBeCloseTo(sum(open.filter((o) => o.accountId != null && retail.has(o.accountId))), 2);

    const vehement = data.accounts.find((a) => a.name === 'Vehement Capital Partners')!;
    expect((await answer('u_analyst', 'open pipeline for Vehement Capital Partners')).rows[0]!.value).toBeCloseTo(sum(open.filter((o) => o.accountId === vehement.id)), 2);

    expect((await answer('u_analyst', 'open pipeline for Darcel Schlecht')).rows[0]!.value).toBeCloseTo(sum(open.filter((o) => o.ownerUserId === 'u_darcel_schlecht')), 2);
    expect((await answer('u_ts_east', 'open pipeline for Violet Mclelland')).rows[0]!.value).toBeCloseTo(sum(open.filter((o) => o.ownerUserId === 'u_violet_mclelland')), 2);

    const between = open.filter((o) => { const n = Number(o.amount); return n >= 4000 && n <= 5000; });
    expect((await answer('u_analyst', 'open pipeline for deals between 4000 and 5000')).rows[0]!.value).toBeCloseTo(sum(between), 2);
    const over = open.filter((o) => Number(o.amount) > 1_000_000);
    expect((await answer('u_analyst', 'open pipeline over $1M')).rows[0]!.value).toBeCloseTo(sum(over), 2);

    const pipe = sum(open.filter((o) => o.ownerUserId === 'u_darcel_schlecht' && inQ1(o)));
    const quota = sum(data.quotas.filter((q) => q.userId === 'u_darcel_schlecht' && q.period === 'FY27-Q1'));
    expect((await answer('u_analyst', 'pipeline coverage for Darcel Schlecht this quarter')).rows[0]!.value).toBeCloseTo(ratio(pipe, quota), 4);

    const first = await answer('u_analyst', 'open pipeline for GTX Pro');
    const follow = await ask(database, reg, 'u_analyst', 'what about by stage?', { previous: first.intent });
    if (follow.kind !== 'answer') throw new Error(`expected an answer, got ${follow.kind}`);
    expect(follow.filters.products).toEqual(['GTX Pro']);
    expect(follow.filters.groupBy).toEqual(['stage']);

    expect((await ask(database, reg, 'u_analyst', 'open pipeline for Nimbus')).kind).toBe('clarify');
    expect((await ask(database, reg, 'u_analyst', 'pipeline coverage for GTX Pro this quarter')).kind).toBe('clarify');
    expect((await ask(database, reg, 'u_analyst', 'open pipeline for Melvin Marxen')).kind).toBe('clarify');
    await expect(ask(database, reg, 'u_ts_east', 'open pipeline for Darcel Schlecht')).rejects.toBeInstanceOf(ScopeViolation);
  });

  it('keeps commas and decimals in a deal size, and does not guess a sector or another manager team', async () => {
    const under = open.filter((o) => Number(o.amount) < 5000);
    expect((await answer('u_analyst', 'open pipeline under $5,000')).rows[0]!.value).toBeCloseTo(sum(under), 2);
    const million = open.filter((o) => Number(o.amount) > 1_000_000);
    expect((await answer('u_analyst', 'open pipeline over 1,000,000')).rows[0]!.value).toBeCloseTo(sum(million), 2);
    expect((await answer('u_analyst', 'open pipeline over $1.5M')).rows[0]!.value).toBeCloseTo(sum(open.filter((o) => Number(o.amount) > 1_500_000)), 2);

    expect((await ask(database, reg, 'u_analyst', 'what is marketing seeing for open pipeline')).kind).toBe('clarify');
    expect((await ask(database, reg, 'u_analyst', 'open pipeline for the finance team')).kind).toBe('clarify');

    const cara = teamOf('u_mgr_cara_losch');
    const caraPipe = sum(open.filter((o) => cara.has(o.ownerUserId)));
    expect((await answer('u_analyst', "open pipeline for Cara Losch's team")).rows[0]!.value).toBeCloseTo(caraPipe, 2);
    expect((await answer('u_ts_east', "open pipeline for Cara Losch's team")).rows[0]!.value).toBeCloseTo(caraPipe, 2);
    await expect(ask(database, reg, 'u_ts_west', "open pipeline for Cara Losch's team")).rejects.toBeInstanceOf(ScopeViolation);
  });

  it('reads the comparison that was being missed, and asks when the range cannot be a deal size', async () => {
    const noMore = await answer('u_analyst', 'open pipeline no more than 10k');
    expect(noMore.filters.amount).toEqual({ max: 10_000, maxInclusive: true });
    expect(noMore.rows[0]!.value).toBeCloseTo(sum(open.filter((o) => Number(o.amount) <= 10_000)), 2);

    const range = await answer('u_analyst', 'open pipeline between 1 and 2 million');
    expect(range.filters.amount).toEqual({ min: 1_000_000, max: 2_000_000, minInclusive: true, maxInclusive: true });
    expect(range.rows[0]!.value).toBeCloseTo(sum(open.filter((o) => { const n = Number(o.amount); return n >= 1_000_000 && n <= 2_000_000; })), 2);

    const gtk = await answer('u_analyst', 'open pipeline for GTK 500');
    expect(gtk.filters.products).toEqual(['GTK 500']);
    expect(gtk.filters.amount).toBeNull();
    const gtkOver = await answer('u_analyst', 'open pipeline for GTK 500 over $10k');
    expect(gtkOver.filters.products).toEqual(['GTK 500']);
    expect(gtkOver.filters.amount).toEqual({ min: 10_000, minInclusive: false });

    const named = await answer('u_analyst', 'open deal value over $1M');
    expect(named.filters.amount).toEqual({ min: 1_000_000, minInclusive: false });

    for (const phrase of ['open pipeline over 5,000 and under 1,000', 'open pipeline between 2025 and 2026']) {
      const r = await ask(database, reg, 'u_analyst', phrase);
      expect(r.kind, phrase).toBe('clarify');
      if (r.kind === 'clarify') expect(r.question).toMatch(/deal size/);
    }
    const lastQuarter = await ask(database, reg, 'u_analyst', 'open pipeline over the last quarter');
    expect(lastQuarter.kind).toBe('clarify');
    if (lastQuarter.kind === 'clarify') expect(lastQuarter.question).not.toMatch(/deal size/);
  });

  it('this-quarter coverage phrasings match the hand-computed ratio', async () => {
    const phrases = [
      'What is our pipeline coverage this quarter?',
      'coverage ratio for FY27-Q1',
      'what is coverage this fiscal quarter',
    ];
    const pipe = sum(open.filter(inQ1));
    const quota = sum(data.quotas.filter((q) => q.period === q1.period));
    const expected = ratio(pipe, quota);
    for (const phrase of phrases) {
      const r = await answer('u_analyst', phrase);
      expect(r.rows, phrase).toHaveLength(1);
      expect(r.rows[0]!.value, phrase).toBeCloseTo(expected, 4);
    }
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

  it('refuses a stage filter on coverage instead of ignoring it', async () => {
    await expect(
      answerIntent(database, reg, 'u_analyst', { metric: 'pipeline_coverage', filters: { period: 'FY27-Q1', stages: ['Prospecting'] }, groupBy: [] }),
    ).rejects.toBeInstanceOf(IntentError);
  });

  // System rule 9 (docs/SYSTEM-CARD.md): the schema and validateIntent enforce regions and quarters, whatever the model proposes.
  // Stages are enforced by the schema too (#86): see "refuses a stage that is not an open-deal stage" below.
  it('refuses a region or quarter that is not in the data, whatever the model proposes', async () => {
    const propose = (filters: Record<string, unknown>) => answerIntent(database, reg, 'u_analyst', { metric: 'open_pipeline', filters, groupBy: [] });
    await expect(propose({ regions: ['north'] })).rejects.toBeInstanceOf(IntentError);
    await expect(propose({ period: 'FY27-Q3' })).rejects.toBeInstanceOf(IntentError);
    await expect(propose({ period: 'Q3 2025' })).rejects.toBeInstanceOf(IntentError);
  });

  // System rule 6, coverage case: a filter quota isn't split by is refused, never dropped to answer for everything.
  it('refuses coverage filtered by deal size, product, account or sector instead of dropping the filter', async () => {
    const coverage = (filters: Record<string, unknown>) =>
      answerIntent(database, reg, 'u_analyst', { metric: 'pipeline_coverage', filters: { period: 'FY27-Q1', ...filters }, groupBy: [] });
    const sector = data.accounts[0]!.sector;
    for (const filters of [{ amount: { min: 100000 } }, { products: [data.products[0]!.id] }, { accounts: [data.accounts[0]!.name] }, { sectors: [sector] }]) {
      await expect(coverage(filters)).rejects.toThrow("because quota isn't split that way");
    }
  });

  it('applies a stage filter on open pipeline', async () => {
    const r = await answerIntent(database, reg, 'u_analyst', { metric: 'open_pipeline', filters: { stages: ['Engaging'] }, groupBy: [] });
    expect(r.rows[0]!.value).toBeCloseTo(sum(open.filter((o) => o.stage === 'Engaging')), 2);
  });

  it('rejects oversized or duplicated intent arrays before any query runs', async () => {
    const tooManyStages = { metric: 'open_pipeline', filters: { stages: Array.from({ length: 11 }, (_, i) => `stage-${i}`) }, groupBy: [] };
    const tooManyRegions = { metric: 'open_pipeline', filters: { regions: ['east', 'east', 'west', 'central'] }, groupBy: [] };
    const duplicateGroupBy = { metric: 'open_pipeline', filters: {}, groupBy: ['stage', 'stage'] };
    for (const bad of [tooManyStages, tooManyRegions, duplicateGroupBy]) {
      await expect(answerIntent(database, reg, 'u_analyst', bad)).rejects.toBeInstanceOf(IntentError);
    }
  });

  it('rejects an unknown product name before running a query', async () => {
    const before = await database.client.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM accounts');
    await expect(answerIntent(database, reg, 'u_analyst', { metric: 'open_pipeline', filters: { products: ["GTX Pro'; DROP TABLE accounts;--"] }, groupBy: [] })).rejects.toBeInstanceOf(IntentError);
    const after = await database.client.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM accounts');
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it('refuses a stage that is not an open-deal stage', async () => {
    const before = await database.client.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM accounts');
    await expect(
      answerIntent(database, reg, 'u_analyst', {
        metric: 'open_opportunity_count',
        filters: { stages: ["Engaging' OR '1'='1"] },
        groupBy: [],
      }),
    ).rejects.toBeInstanceOf(IntentError);
    await expect(
      answerIntent(database, reg, 'u_analyst', { metric: 'open_pipeline', filters: { stages: ['Won'] }, groupBy: [] }),
    ).rejects.toBeInstanceOf(IntentError);
    const after = await database.client.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM accounts');
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });
});
