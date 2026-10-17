import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDatabase, type Database } from '@/db/client';
import { alertDeliveries, alertSubscriptions, supportCases } from '@/db/schema';
import { buildSeed } from '@/db/seed';
import type { Channels } from '@/alerts/channels';
import { flushDigests, runAlerts } from '@/alerts/engine';
import { loadRules } from '@/alerts/rules';
import { digestDue, lastSlot } from '@/alerts/schedule';
import { tick } from '@/alerts/scheduler';

const rules = loadRules();
const data = buildSeed();
const account = data.accountTeam.find((t) => t.userId === 'u_ts_east')!.accountId;
const SINCE = new Date('2026-09-01T00:00:00Z');

type Call = { ids: string[] };
const recorder = (): Channels & { calls: Call[] } => {
  const calls: Call[] = [];
  return { calls, async deliver(_c, _u, items) { calls.push({ ids: items.map((i) => i.id) }); return true; } };
};
const at = (iso: string) => new Date(iso);

let database: Database;
beforeEach(async () => {
  database = await openDatabase();
  await database.db.delete(supportCases);
});
afterEach(async () => {
  await database.close();
});

async function addCase(id: string, openedAt: string) {
  await database.db.insert(supportCases).values({ id, snapshotId: data.snapshot.id, accountId: account, severity: 'P2', status: 'Open', subject: 'Policy push failing', openedAt: at(openedAt) });
}
async function subscribe(frequency: string) {
  await database.db.insert(alertSubscriptions).values({ userId: 'u_ts_east', ruleId: 'high_severity_case', frequency, channel: 'inbox', quietStartHour: null, quietEndHour: null, criticalBypass: false });
}
const statuses = async () =>
  Object.fromEntries((await database.db.select().from(alertDeliveries).where(eq(alertDeliveries.userId, 'u_ts_east'))).map((r) => [r.eventId, r.status]));

describe('digest slots', () => {
  it('finds the most recent daily, weekly (Monday) and monthly (1st) slot at 13:00 UTC', () => {
    const wedMorning = at('2026-10-14T09:00:00Z'); // Wednesday
    expect(lastSlot('daily', wedMorning).toISOString()).toBe('2026-10-13T13:00:00.000Z');
    expect(lastSlot('weekly', wedMorning).toISOString()).toBe('2026-10-12T13:00:00.000Z');
    expect(lastSlot('monthly', wedMorning).toISOString()).toBe('2026-10-01T13:00:00.000Z');
    expect(lastSlot('monthly', at('2026-11-01T09:00:00Z')).toISOString()).toBe('2026-10-01T13:00:00.000Z');
  });

  it('is due once per slot', () => {
    expect(digestDue({ frequency: 'weekly', lastDigestAt: null }, at('2026-10-14T09:00:00Z'))).toBe(true);
    expect(digestDue({ frequency: 'weekly', lastDigestAt: at('2026-10-12T14:00:00Z') }, at('2026-10-14T09:00:00Z'))).toBe(false);
    expect(digestDue({ frequency: 'weekly', lastDigestAt: at('2026-10-12T14:00:00Z') }, at('2026-10-19T13:30:00Z'))).toBe(true);
    expect(digestDue({ frequency: 'realtime', lastDigestAt: at('2026-10-12T14:00:00Z') }, at('2026-10-12T14:01:00Z'))).toBe(true);
  });
});

describe('weekly and monthly digests', () => {
  it('sends a weekly digest once a week, holding later alerts for the next Monday', async () => {
    await subscribe('weekly');
    await addCase('case_a', '2026-10-09T10:00:00Z');
    await runAlerts(database.db, rules, recorder(), SINCE, at('2026-10-12T12:00:00Z'));
    const ch = recorder();
    await flushDigests(database.db, rules, ch, at('2026-10-12T14:00:00Z')); // Monday after 13:00
    expect(ch.calls).toHaveLength(1);
    await addCase('case_b', '2026-10-13T10:00:00Z');
    await runAlerts(database.db, rules, recorder(), SINCE, at('2026-10-13T12:00:00Z'));
    await flushDigests(database.db, rules, ch, at('2026-10-13T14:00:00Z')); // Tuesday: not due
    expect(ch.calls).toHaveLength(1);
    expect((await statuses()).case_b).toBe('queued_digest');
    await flushDigests(database.db, rules, ch, at('2026-10-19T13:30:00Z')); // next Monday
    expect(ch.calls).toHaveLength(2);
    expect((await statuses()).case_b).toBe('delivered');
  });

  it('sends a monthly digest on the 1st', async () => {
    await subscribe('monthly');
    await database.db.update(alertSubscriptions).set({ lastDigestAt: at('2026-10-01T13:05:00Z') });
    await addCase('case_a', '2026-10-09T10:00:00Z');
    await runAlerts(database.db, rules, recorder(), SINCE, at('2026-10-10T00:00:00Z'));
    const ch = recorder();
    await flushDigests(database.db, rules, ch, at('2026-10-20T14:00:00Z'));
    expect(ch.calls).toHaveLength(0);
    await flushDigests(database.db, rules, ch, at('2026-11-01T13:10:00Z'));
    expect(ch.calls).toHaveLength(1);
  });
});

describe('scheduler', () => {
  it('only evaluates new events on each tick and resumes from the stored cursor', async () => {
    await subscribe('realtime');
    await addCase('case_a', '2026-10-09T10:00:00Z');
    const first = await tick(database.db, rules, recorder(), at('2026-10-10T00:00:00Z'), SINCE);
    expect(first).toHaveLength(1);
    const again = await tick(database.db, rules, recorder(), at('2026-10-10T00:01:00Z'), SINCE);
    expect(again).toHaveLength(0);
    await addCase('case_b', '2026-10-10T00:01:30Z');
    const ch = recorder();
    const next = await tick(database.db, rules, ch, at('2026-10-10T00:02:00Z'), SINCE);
    expect(next).toEqual(['alert_high_severity_case_u_ts_east_case_b']);
    expect(ch.calls).toHaveLength(1);
  });
});
