import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { AS_OF_DATE, buildSeed, demoUsers } from '@/db/seed';
import { PRODUCT_USAGE_COLUMNS, lowUsageHits, productUsageFixture } from '@/db/product-usage';

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const data = buildSeed();

describe('dataset: Maven CRM sample plus synthetic additions', () => {
  it('produces identical data for the same seed', () => {
    expect(hash(buildSeed('x'))).toBe(hash(buildSeed('x')));
  });

  it('loads the public sample unchanged in size: 85 accounts, 8,800 deals, 35 reps, 6 managers, 7 products', () => {
    expect(data.accounts).toHaveLength(85);
    expect(data.opportunities).toHaveLength(8800);
    expect(data.users.filter((u) => u.role === 'sales_rep')).toHaveLength(35);
    expect(data.users.filter((u) => u.role === 'sales_manager')).toHaveLength(6);
    expect(data.products).toHaveLength(7);
    expect(data.regions.map((r) => r.id)).toEqual(['central', 'east', 'west']);
  });

  it('shifts dates so the newest record lands on the as-of date', () => {
    const latest = data.opportunities.filter((o) => !o.closeDateIsEstimate).map((o) => o.closeDate).sort().at(-1);
    expect(latest).toBe(AS_OF_DATE);
  });

  it('marks every open-deal amount and close date as an estimate, and no closed one', () => {
    for (const o of data.opportunities) {
      expect(o.amountIsEstimate).toBe(!o.isClosed);
      expect(o.closeDateIsEstimate).toBe(!o.isClosed);
      if (!o.isClosed) expect(o.closeDate >= AS_OF_DATE).toBe(true);
    }
  });

  it('has 5 demo identities, quotas in every region, and account teams for accounts with deals', () => {
    expect(demoUsers(data)).toHaveLength(5);
    for (const r of ['central', 'east', 'west']) expect(data.quotas.some((q) => q.regionId === r)).toBe(true);
    const withDeals = new Set(data.opportunities.map((o) => o.accountId).filter(Boolean));
    for (const a of withDeals) expect(data.accountTeam.some((t) => t.accountId === a)).toBe(true);
  });

  it('includes event data for both alert types', () => {
    expect(data.supportCases.length).toBeGreaterThan(0);
    expect(data.engagements.length).toBeGreaterThan(0);
  });

  it('lets the low-usage rule test the fixture, then the same check against the seed', () => {
    const fixtureHits = lowUsageHits(productUsageFixture(AS_OF_DATE), AS_OF_DATE);
    expect(fixtureHits.map((r) => r.accountId)).toEqual(['acct_low']);
    expect(Object.values(PRODUCT_USAGE_COLUMNS)).toEqual([
      'account_id', 'product_id', 'purchase_date', 'purchased_quantity', 'usage_month', 'quantity_used', 'source',
    ]);
    const seedHits = lowUsageHits(data.productUsage, AS_OF_DATE);
    expect(seedHits).toHaveLength(1);
    expect(data.accountTeam.some((t) => t.accountId === seedHits[0]!.accountId)).toBe(true);
    expect(data.productUsage.every((r) => r.source === 'synthetic')).toBe(true);
  });
});

// Business rule "cxo" (registry/glossary.json in the copilot): only titles starting with "Chief" are CXOs, and only
// they can fire the CXO alert.
describe('cxo rule', () => {
  it('flags exactly the contacts whose title starts with "Chief"', async () => {
    const { buildSeed: build, isCxoTitle } = await import('@/db/seed');
    expect(isCxoTitle('Chief Technology Officer')).toBe(true);
    expect(isCxoTitle('Mischief Manager')).toBe(false);
    for (const c of build().contacts) expect(c.isCxo).toBe(c.title.startsWith('Chief '));
  });
});
