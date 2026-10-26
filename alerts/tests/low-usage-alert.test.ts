// Low-usage alert (plan item 12, Alex's option (a)): under 20% of what was bought, six months after purchase, to the
// account team only, on the synthetic usage data from plan item 14.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDatabase, type Database } from '@/db/client';
import { accounts, alertDeliveries, alertSubscriptions, dataSnapshots, productUsage } from '@/db/schema';
import { buildSeed } from '@/db/seed';
import { LOW_USAGE_FRACTION, USAGE_WAIT_MONTHS, productUsageRows } from '@/db/product-usage';
import type { Channels } from '@/alerts/channels';
import { staticEmployeeDirectory } from '@/alerts/employee-status';
import { matchingEvents, runAlerts } from '@/alerts/engine';
import { loadRules } from '@/alerts/rules';

const rules = loadRules();
const rule = rules.get('low_usage')!;
const data = buildSeed();
const SINCE = new Date('2026-09-01T00:00:00Z');
const DAY = new Date('2026-10-08T15:00:00Z');
// Seeded by plan item 14: Acme is the low case. Jordan and Sam are its technical sellers; Anna is a rep not on its team.
const LOW_ACCOUNT = 'acc_acme_corporation';
const ON_TEAM = 'u_ts_east';
const OFF_TEAM_REP = 'u_anna_snelling';

function recorder(): Channels & { calls: string[][] } {
  const calls: string[][] = [];
  return { calls, async deliver(_c, _u, items) { calls.push(items.map((i) => i.id)); return true; } };
}

describe('low-usage rule definition (plan item 12)', () => {
  it('is a valid rule, and its text matches the thresholds the code applies', () => {
    expect(rule.version).toBe(1);
    expect(Math.round(LOW_USAGE_FRACTION * 100)).toBe(20);
    expect(USAGE_WAIT_MONTHS).toBe(6);
    expect(rule.description).toContain('20%');
    expect(rule.description).toContain('six months');
    expect(rule.explain).toContain('20%');
    expect(rule.explain).toContain('six months');
  });

  it('goes to the account team roles only, never to managers or analysts', () => {
    expect([...rule.audience].sort()).toEqual(['sales_rep', 'technical_seller']);
  });
});

describe('low-usage alert on the seed (plan item 12)', () => {
  let database: Database;
  beforeEach(async () => {
    database = await openDatabase();
  });
  afterEach(async () => {
    await database.close();
  });

  const subscribe = (userId: string) =>
    database.db.insert(alertSubscriptions).values({ userId, ruleId: 'low_usage', frequency: 'realtime', channel: 'inbox', quietStartHour: null, quietEndHour: null, criticalBypass: false });
  const deliveries = (userId: string) => database.db.select().from(alertDeliveries).where(eq(alertDeliveries.userId, userId));

  it('finds only the account that is under 20% and past six months', async () => {
    const events = await matchingEvents(database.db, rule, SINCE, DAY);
    expect(events.map((e) => e.accountId)).toEqual([LOW_ACCOUNT]);
    expect(events[0]?.values).toMatchObject({ account: 'Acme Corporation', product: 'GTK 500', used: '15', purchased: '100', percent: '15', source: 'synthetic' });
  });

  it('stays silent for the healthy account (45%) and the early one (10% but only three months in)', async () => {
    const events = await matchingEvents(database.db, rule, SINCE, DAY);
    const others = data.productUsage.map((r) => r.accountId).filter((id) => id !== LOW_ACCOUNT);
    expect(others.length).toBeGreaterThan(0);
    for (const id of others) expect(events.map((e) => e.accountId)).not.toContain(id);
  });

  it('stays silent before six months have passed since purchase, measured on the snapshot date', async () => {
    // The purchase was Feb 8, so Aug 8 is the first day it counts. The data date is the snapshot's, not the clock's.
    await database.db.update(dataSnapshots).set({ asOfDate: '2026-07-15' });
    expect(await matchingEvents(database.db, rule, SINCE, DAY)).toEqual([]);
  });

  it('still alerts when the scheduler window starts a week after the usage month (the month is reported late)', async () => {
    await subscribe(ON_TEAM);
    const lateSince = new Date('2026-10-08T00:00:00Z'); // the usage month is Oct 1; since is a week later
    const ch = recorder();
    await runAlerts(database.db, rules, ch, lateSince, DAY);
    await runAlerts(database.db, rules, ch, lateSince, DAY);
    expect(await deliveries(ON_TEAM)).toHaveLength(1);
    expect(ch.calls).toHaveLength(1);
  });

  it('reads only the newest snapshot, even when an older one still has a low account', async () => {
    const newest = 'snap_newer';
    const productId = data.productUsage[0]!.productId;
    await database.db.insert(dataSnapshots).values({ id: newest, seed: 'newer', asOfDate: '2026-11-05', loadedAt: new Date('2026-11-05T06:00:00Z'), notes: null });
    await database.db.insert(accounts).values({ id: 'acc_newco', snapshotId: newest, name: 'Newco', sector: 'technology' });
    await database.db.insert(productUsage).values(
      productUsageRows(newest, [{ accountId: 'acc_newco', productId, monthsAgo: 8, purchasedQuantity: 100, quantityUsed: 10 }], '2026-11-05'),
    );
    const events = await matchingEvents(database.db, rule, SINCE, new Date('2026-11-06T00:00:00Z'));
    expect(events.map((e) => e.accountId)).toEqual(['acc_newco']);
  });

  it('alerts a seller on the account team, with the synthetic label in the text', async () => {
    await subscribe(ON_TEAM);
    const ch = recorder();
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    const rows = await deliveries(ON_TEAM);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ruleId: 'low_usage', accountId: LOW_ACCOUNT, status: 'delivered' });
    expect(rows[0]?.title).toBe('Low usage of GTK 500 at Acme Corporation');
    expect(rows[0]?.explanation).toContain('15 of the 100 GTK 500');
    expect(rows[0]?.explanation).toContain('Data source: synthetic');
  });

  it('does not alert a rep who is not on the account team (L4 routing still applies)', async () => {
    await subscribe(OFF_TEAM_REP);
    await runAlerts(database.db, rules, recorder(), SINCE, DAY);
    expect(await deliveries(OFF_TEAM_REP)).toHaveLength(0);
  });

  it('alerts once for one month, however often it is scanned', async () => {
    await subscribe(ON_TEAM);
    const ch = recorder();
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    expect(await deliveries(ON_TEAM)).toHaveLength(1);
    expect(ch.calls).toHaveLength(1);
  });

  it('ignores usage rows that are not marked synthetic', async () => {
    await database.db.update(productUsage).set({ source: 'crm_export' });
    expect(await matchingEvents(database.db, rule, SINCE, DAY)).toEqual([]);
  });

  it('is held back for someone who is no longer an active employee', async () => {
    await subscribe(ON_TEAM);
    await runAlerts(database.db, rules, recorder(), SINCE, DAY, { directory: staticEmployeeDirectory({ [ON_TEAM]: 'inactive' }) });
    expect(await deliveries(ON_TEAM)).toHaveLength(0);
  });
});
