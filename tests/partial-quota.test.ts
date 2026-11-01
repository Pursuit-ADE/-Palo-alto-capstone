// Coverage must not look better because part of the cohort's quota is missing (project review, Nov 1, finding 2).
// Dropping one rep's quota for one quarter left the pipeline in the numerator and shrank the denominator, so a team at
// 0.52x showed 0.82x with no warning. A rep who carries a quota in another quarter but has none for the one asked about
// is an incomplete cohort: the value is withheld, as it already is when no quota exists at all, and the answer says why.
// A rep with no quota in any quarter is how this data says who carries a quota (5 of the 35 sample reps), not a gap.
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { quotas } from '@/db/schema';
import { loadRegistry } from '@/registry/load';
import { answerIntent, ask, type Answer } from '@/semantic/answer';

const reg = loadRegistry();
let database: Database;
beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

type QuotaRow = typeof quotas.$inferSelect;
let removed: QuotaRow[] = [];
/** Deletes one rep's quota for one quarter (or every quarter), keeping the rows so the next test starts whole. */
async function dropQuota(userId: string, period?: string) {
  const where = period ? and(eq(quotas.userId, userId), eq(quotas.period, period)) : eq(quotas.userId, userId);
  removed.push(...(await database.db.delete(quotas).where(where).returning()));
}
beforeEach(async () => {
  if (removed.length) await database.db.insert(quotas).values(removed);
  removed = [];
});

const answer = async (user: string, phrase: string): Promise<Answer> => {
  const r = await ask(database, reg, user, phrase);
  if (r.kind !== 'answer') throw new Error(`${phrase}: ${r.kind}`);
  return r;
};

describe('coverage with a complete cohort is unchanged', () => {
  it('shows the East team at 0.52x and the whole company at 0.65x, as before', async () => {
    expect((await answer('u_ts_east', 'pipeline coverage this quarter')).rows[0]).toMatchObject({ numerator: 174325, denominator: 338000, value: 0.5158 });
    expect((await answer('u_analyst', 'pipeline coverage this quarter')).rows[0]).toMatchObject({ numerator: 1963909, denominator: 3001000, value: 0.6544 });
  });
});

describe('coverage with part of the cohort missing a quota for the quarter', () => {
  it('withholds the value, keeps what was found, and says how many reps are missing', async () => {
    await dropQuota('u_corliss_cosme', 'FY27-Q1');
    const a = await answer('u_ts_east', 'pipeline coverage this quarter');
    expect(a.rows[0]).toMatchObject({ numerator: 174325, denominator: 212000, value: null });
    expect(a.narrative).toMatch(/not available/);
    // The team has 6 reps; one has no quota in any quarter, so 5 carry one and 1 of those 5 is missing this quarter.
    expect(a.narrative).toMatch(/missing for 1 of 5 reps with a quota in scope/);
    expect(a.narrative).not.toMatch(/0\.8\dx|off target|on target/);
  });

  it('does the same on the dashboard path, which runs the same query', async () => {
    await dropQuota('u_corliss_cosme', 'FY27-Q1');
    const tile = await answerIntent(database, reg, 'u_ts_east', { metric: 'pipeline_coverage', filters: { period: 'FY27-Q1' }, groupBy: [] }, 'dashboard');
    expect(tile.rows[0]).toMatchObject({ value: null });
  });

  it('leaves the quarter that is complete, and other people, alone', async () => {
    await dropQuota('u_corliss_cosme', 'FY27-Q1');
    expect((await answer('u_ts_east', 'pipeline coverage next quarter')).rows[0]!.value).toEqual(expect.any(Number));
    expect((await answer('u_mgr_melvin_marxen', 'pipeline coverage this quarter')).rows[0]!.value).toEqual(expect.any(Number));
  });

  it('withholds the company figure too, counting the reps who carry a quota', async () => {
    await dropQuota('u_corliss_cosme', 'FY27-Q1');
    const a = await answer('u_analyst', 'pipeline coverage this quarter');
    expect(a.rows[0]!.value).toBeNull();
    expect(a.narrative).toMatch(/missing for 1 of 30 reps with a quota in scope/);
  });

  it('withholds only the region that is incomplete when coverage is split by region', async () => {
    await dropQuota('u_corliss_cosme', 'FY27-Q1');
    const a = await answer('u_analyst', 'coverage by region this quarter');
    const byRegion = Object.fromEntries(a.rows.map((r) => [r.region, r.value]));
    expect(byRegion.east).toBeNull();
    expect(byRegion.central).toEqual(expect.any(Number));
    expect(byRegion.west).toEqual(expect.any(Number));
    expect(a.narrative).toMatch(/missing for 1 of \d+ reps with a quota in East, so coverage is not shown there/);
    expect(a.narrative).not.toMatch(/reps with a quota in (Central|West)/);
  });

  it('still asks "why is my number different?" without comparing a withheld figure', async () => {
    await dropQuota('u_corliss_cosme', 'FY27-Q1');
    const r = await ask(database, reg, 'u_ts_east', "why is my coverage lower than the company's?");
    expect(r.kind).toBe('explanation');
    expect(JSON.stringify(r)).not.toMatch(/0\.82/);
  });

  it('does not treat a rep with no quota in any quarter as a gap (that is how the data says who carries one)', async () => {
    await dropQuota('u_corliss_cosme');
    const a = await answer('u_ts_east', 'pipeline coverage this quarter');
    expect(a.rows[0]!.value).toEqual(expect.any(Number));
  });
});
