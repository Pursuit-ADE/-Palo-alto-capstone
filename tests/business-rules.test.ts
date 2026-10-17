// The business rules in registry/glossary.json are written for people. These tests check that the code that
// applies each rule does what the sentence says, so the two can't drift apart.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AS_OF_DATE, buildSeed, isCxoTitle, MEDIAN_CYCLE_DAYS, QUOTA_PERIODS, REGIONS } from '@/db/seed';
import { loadRegistry } from '@/registry/load';
import { resolvePeriod } from '@/semantic/periods';

const reg = loadRegistry();
const rules = new Map(reg.glossary.businessRules.map((r) => [r.id, r]));
const data = buildSeed();

describe('business rules', () => {
  it('each rule has a unique id and names a file that exists', () => {
    expect(rules.size).toBe(reg.glossary.businessRules.length);
    for (const r of reg.glossary.businessRules) expect(fs.existsSync(path.join(process.cwd(), r.appliesIn)), r.id).toBe(true);
    for (const id of ['fiscal_year', 'open_deal', 'region', 'estimated_amount', 'quota', 'no_quota', 'cxo']) expect(rules.has(id), id).toBe(true);
  });

  it('fiscal_year: quarters start August 1', () => {
    expect(QUOTA_PERIODS[0]).toMatchObject({ period: 'FY27-Q1', start: '2026-08-01', end: '2026-10-31' });
    expect(QUOTA_PERIODS[1]).toMatchObject({ period: 'FY27-Q2', start: '2026-11-01', end: '2027-01-31' });
    expect(resolvePeriod('current', AS_OF_DATE)).toBe('FY27-Q1');
  });

  it('open_deal: open means Prospecting or Engaging', () => {
    for (const o of data.opportunities) expect(o.isClosed).toBe(o.stage === 'Won' || o.stage === 'Lost');
    for (const id of ['open_pipeline', 'open_opportunity_count']) {
      const m = reg.metrics.get(id)!;
      expect(m.kind === 'aggregate' && m.source.conditions).toContainEqual({ column: 'is_closed', equals: false });
    }
  });

  it('region: a deal is in its owner’s region, and only three regions exist', () => {
    expect(REGIONS.map((r) => r.id)).toEqual(['central', 'east', 'west']);
    const regionOf = new Map(data.users.map((u) => [u.id, u.regionId]));
    for (const o of data.opportunities) expect(o.regionId).toBe(regionOf.get(o.ownerUserId));
  });

  it('estimated_amount: open deals use the list price and are marked as estimates', () => {
    const price = new Map(data.products.map((p) => [p.id, p.listPrice]));
    const open = data.opportunities.filter((o) => !o.isClosed);
    expect(open.length).toBeGreaterThan(0);
    for (const o of open.filter((x) => x.amountIsEstimate)) expect(o.amount).toBe(price.get(o.productId));
  });

  it('quota: rounded to $1,000', () => {
    for (const q of data.quotas) expect(Number(q.amount) % 1000).toBe(0);
  });

  it('cxo: a title starting with "Chief"', () => {
    expect(isCxoTitle('Chief Information Security Officer')).toBe(true);
    expect(isCxoTitle('Director of Security Operations')).toBe(false);
    expect(isCxoTitle('Mischief Manager')).toBe(false);
    for (const c of data.contacts) expect(c.isCxo).toBe(c.title.startsWith('Chief '));
    expect(reg.glossary.terms.some((t) => t.term === 'CXO')).toBe(true);
  });
});

// Rules checked in full after Adedoyin's review of #11: the close-date estimate, the quota factor and the snapshot.
describe('business rules, checked in full', () => {
  const day = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  it('estimated_close_date: engage date plus the median cycle, or rolled forward 0 to 59 days from the snapshot', () => {
    const estimated = data.opportunities.filter((o) => !o.isClosed && o.closeDateIsEstimate);
    expect(estimated.length).toBeGreaterThan(0);
    for (const o of estimated) {
      const expected = o.engageDate ? day(o.engageDate, MEDIAN_CYCLE_DAYS) : null;
      if (expected && expected > AS_OF_DATE) expect(o.closeDate).toBe(expected);
      else {
        expect(o.closeDate >= AS_OF_DATE).toBe(true);
        expect(o.closeDate <= day(AS_OF_DATE, 59)).toBe(true);
      }
    }
  });

  it('quota: 1.2 times the average quarterly won revenue over the last four quarters, rounded to $1,000', () => {
    const windowStart = day(AS_OF_DATE, -365);
    const won = new Map<string, number>();
    for (const o of data.opportunities) if (o.isWon && o.closeDate > windowStart) won.set(o.ownerUserId, (won.get(o.ownerUserId) ?? 0) + Number(o.amount));
    expect(data.quotas.length).toBeGreaterThan(0);
    for (const q of data.quotas) expect(Number(q.amount)).toBe(Math.round(((won.get(q.userId)! / 4) * 1.2) / 1000) * 1000);
  });

  it('snapshot: answers use the newest snapshot and state its as-of date', async () => {
    const { openDatabase } = await import('@/db/client');
    const { dataSnapshots } = await import('@/db/schema');
    const { answerIntent } = await import('@/semantic/answer');
    const db = await openDatabase();
    try {
      await db.db.insert(dataSnapshots).values({ id: 'snap_older', seed: 'older', asOfDate: '2026-07-01', loadedAt: new Date('2026-07-01T06:00:00Z'), notes: 'older snapshot' });
      const a = await answerIntent(db, reg, 'u_analyst', { metric: 'open_pipeline', filters: {}, groupBy: [] });
      expect(a.provenance.snapshotId).toBe(data.snapshot.id);
      expect(a.provenance.asOfDate).toBe(AS_OF_DATE);
    } finally {
      await db.close();
    }
  });
});
