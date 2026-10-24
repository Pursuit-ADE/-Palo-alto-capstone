// Role-by-question access matrix (PRD governance gate). Each demo person is asked the three metrics.
// A passing cell is a number that matches the seed filtered to that person's region and owners, with no
// out-of-scope region or owner in the rows or the chart. Asking for another region is refused.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { buildSeed, DEMO_USER_IDS, QUOTA_PERIODS } from '@/db/seed';
import { loadRegistry } from '@/registry/load';
import { answerIntent, type Answer } from '@/semantic/answer';
import { ScopeViolation } from '@/semantic/scope';

const reg = loadRegistry();
const data = buildSeed();
const q1 = QUOTA_PERIODS[0];
let database: Database;

beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

const sum = (xs: { amount: string }[]) => xs.reduce((t, o) => t + Number(o.amount), 0);
const ratio = (num: number, den: number) => Math.round((num / den) * 10000) / 10000;

type Scope = { role: string; regions: string[]; ownerIds: string[] | null };

function scopeOf(userId: string): Scope {
  const user = data.users.find((u) => u.id === userId)!;
  if (user.role === 'analyst') return { role: user.role, regions: ['central', 'east', 'west'], ownerIds: null };
  const regions = [user.regionId!];
  if (user.role === 'sales_rep') return { role: user.role, regions, ownerIds: [userId] };
  const managerId = user.role === 'sales_manager' ? userId : user.managerId!;
  const ownerIds = data.users.filter((u) => u.role === 'sales_rep' && u.managerId === managerId).map((u) => u.id).sort();
  return { role: user.role, regions, ownerIds };
}

const open = data.opportunities.filter((o) => !o.isClosed);
const inQ1 = (o: { closeDate: string }) => o.closeDate >= q1.start && o.closeDate <= q1.end;

function visible(scope: Scope) {
  return open.filter((o) => scope.regions.includes(o.regionId) && (scope.ownerIds === null || scope.ownerIds.includes(o.ownerUserId)));
}

function quotas(scope: Scope) {
  return data.quotas.filter(
    (q) => q.period === 'FY27-Q1' && scope.regions.includes(q.regionId) && (scope.ownerIds === null || scope.ownerIds.includes(q.userId)),
  );
}

function assertInside(scope: Scope, answer: Answer) {
  for (const row of answer.rows) {
    if (row.region != null) expect(scope.regions, String(row.region)).toContain(row.region);
    if (row.owner != null && scope.ownerIds) expect(scope.ownerIds, String(row.owner)).toContain(row.owner);
  }
  if (answer.chart) {
    const dim = answer.chart.encoding.y.field;
    for (const cell of answer.chart.data.values) {
      if (dim === 'region') expect(scope.regions).toContain(String(cell.region).toLowerCase());
      // The chart shows display names; map the allowed owner ids to the names this answer used.
      if (dim === 'owner' && scope.ownerIds) expect(scope.ownerIds.map((id) => answer.ownerNames?.[id] ?? id)).toContain(cell.owner);
    }
  }
}

describe('access matrix', () => {
  for (const userId of DEMO_USER_IDS) {
    const scope = scopeOf(userId);
    const deals = visible(scope);
    const label = `${userId} (${scope.role})`;

    it(`${label}: open pipeline is only that slice`, async () => {
      const r = await answerIntent(database, reg, userId, { metric: 'open_pipeline', filters: {}, groupBy: [] });
      assertInside(scope, r);
      expect(r.rows[0]!.value).toBeCloseTo(sum(deals), 2);
    });

    it(`${label}: open pipeline by region and by owner stays inside the slice`, async () => {
      const byRegion = await answerIntent(database, reg, userId, { metric: 'open_pipeline', filters: {}, groupBy: ['region'] });
      assertInside(scope, byRegion);
      for (const region of scope.regions) {
        const row = byRegion.rows.find((x) => x.region === region);
        const amount = sum(deals.filter((o) => o.regionId === region));
        if (amount === 0) expect(row).toBeUndefined();
        else expect(row!.value).toBeCloseTo(amount, 2);
      }

      const byOwner = await answerIntent(database, reg, userId, { metric: 'open_pipeline', filters: {}, groupBy: ['owner'] });
      assertInside(scope, byOwner);
      const owners = scope.ownerIds ?? [...new Set(deals.map((o) => o.ownerUserId))];
      for (const owner of owners) {
        const row = byOwner.rows.find((x) => x.owner === owner);
        const amount = sum(deals.filter((o) => o.ownerUserId === owner));
        if (amount === 0) expect(row).toBeUndefined();
        else expect(row!.value).toBeCloseTo(amount, 2);
      }
    });

    it(`${label}: open opportunity count is only that slice`, async () => {
      const r = await answerIntent(database, reg, userId, { metric: 'open_opportunity_count', filters: {}, groupBy: [] });
      assertInside(scope, r);
      expect(r.rows[0]!.value).toBe(deals.length);
    });

    it(`${label}: FY27-Q1 coverage is only that slice`, async () => {
      const pipe = sum(deals.filter(inQ1));
      const quota = sum(quotas(scope));
      const r = await answerIntent(database, reg, userId, { metric: 'pipeline_coverage', filters: { period: 'FY27-Q1' }, groupBy: [] });
      assertInside(scope, r);
      if (quota === 0) expect(r.rows[0]!.value).toBeNull();
      else expect(r.rows[0]!.value).toBeCloseTo(ratio(pipe, quota), 4);

      const byRegion = await answerIntent(database, reg, userId, { metric: 'pipeline_coverage', filters: { period: 'FY27-Q1' }, groupBy: ['region'] });
      assertInside(scope, byRegion);
      for (const row of byRegion.rows) expect(scope.regions).toContain(row.region);
    });

    const outside = ['central', 'east', 'west'].find((region) => !scope.regions.includes(region));
    if (outside) {
      it(`${label}: asking for ${outside} is refused`, async () => {
        await expect(
          answerIntent(database, reg, userId, { metric: 'open_pipeline', filters: { regions: [outside] }, groupBy: [] }),
        ).rejects.toBeInstanceOf(ScopeViolation);
      });
    }
  }
});
