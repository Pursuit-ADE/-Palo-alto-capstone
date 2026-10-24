// Offboarding: a disabled account stops getting alerts, new ones and queued digests alike (found Oct 23).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDatabase, type Database } from '@/db/client';
import { alertDeliveries, alertSubscriptions, appAccounts, supportCases } from '@/db/schema';
import { buildSeed } from '@/db/seed';
import type { Channels } from '@/alerts/channels';
import { flushDigests, runAlerts } from '@/alerts/engine';
import { loadRules } from '@/alerts/rules';

const rules = loadRules();
const data = buildSeed();
const SINCE = new Date('2026-09-01T00:00:00Z');
const DAY = new Date('2026-10-08T15:00:00Z');
const USER = 'u_ts_east';
const account = data.accountTeam.find((t) => t.userId === USER)!.accountId;

function recorder(): Channels & { calls: string[][] } {
  const calls: string[][] = [];
  return { calls, async deliver(_c, _u, items) { calls.push(items.map((i) => i.id)); return true; } };
}

let database: Database;
beforeEach(async () => {
  database = await openDatabase();
  await database.db.delete(supportCases);
  await database.db.insert(supportCases).values({
    id: 'case_off', snapshotId: data.snapshot.id, accountId: account, severity: 'P1', status: 'Open', subject: 'Outage', openedAt: new Date('2026-10-08T10:00:00Z'),
  });
  await database.db.insert(appAccounts).values({ username: 'jordan', userId: USER, passwordHash: 'x', createdAt: SINCE });
});
afterEach(async () => {
  await database.close();
});

const disable = () => database.db.update(appAccounts).set({ disabledAt: DAY }).where(eq(appAccounts.userId, USER));
const subscribe = (frequency: string) =>
  database.db.insert(alertSubscriptions).values({ userId: USER, ruleId: 'high_severity_case', frequency, channel: 'slack', quietStartHour: null, quietEndHour: null, criticalBypass: false });

describe('offboarding', () => {
  it('still alerts an active account (control)', async () => {
    await subscribe('realtime');
    const ch = recorder();
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    expect(ch.calls).toHaveLength(1);
  });

  it('creates no alerts for a disabled account', async () => {
    await subscribe('realtime');
    await disable();
    const ch = recorder();
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    expect(ch.calls).toHaveLength(0);
    expect(await database.db.select().from(alertDeliveries).where(eq(alertDeliveries.userId, USER))).toHaveLength(0);
  });

  it('does not send a digest that was queued before the account was disabled', async () => {
    await subscribe('digest');
    const ch = recorder();
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    await disable();
    await flushDigests(database.db, rules, ch, DAY);
    expect(ch.calls).toHaveLength(0);
  });
});
