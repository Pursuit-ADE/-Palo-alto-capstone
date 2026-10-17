// Regressions for the October 14 review: late-arriving events, empty digest slots, re-seeding after an
// unsubscribe, starting the scheduler without a page visit, and retrying a failed start-up.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { openDatabase, type Database } from '@/db/client';
import { alertCursor, alertDeliveries, alertSubscriptions, supportCases } from '@/db/schema';
import { buildSeed } from '@/db/seed';
import type { Channels } from '@/alerts/channels';
import { flushDigests, runAlerts } from '@/alerts/engine';
import { loadRules } from '@/alerts/rules';
import { tick } from '@/alerts/scheduler';
import { onceWithRetry, seedDemoSubscriptionsOnce } from '@/server/runtime';

const rules = loadRules();
const data = buildSeed();
const account = data.accountTeam.find((t) => t.userId === 'u_ts_east')!.accountId;
const SINCE = new Date('2026-09-01T00:00:00Z');
const at = (iso: string) => new Date(iso);
const recorder = (): Channels & { calls: string[][] } => {
  const calls: string[][] = [];
  return { calls, async deliver(_c, _u, items) { calls.push(items.map((i) => i.id)); return true; } };
};

let database: Database;
beforeEach(async () => {
  database = await openDatabase();
  await database.db.delete(supportCases);
});
afterEach(async () => {
  await database.close();
});

const addCase = (id: string, openedAt: string) =>
  database.db.insert(supportCases).values({ id, snapshotId: data.snapshot.id, accountId: account, severity: 'P2', status: 'Open', subject: 'Policy push failing', openedAt: at(openedAt) });
const subscribe = (frequency: string, lastDigestAt: Date | null = null) =>
  database.db.insert(alertSubscriptions).values({ userId: 'u_ts_east', ruleId: 'high_severity_case', frequency, channel: 'inbox', quietStartHour: null, quietEndHour: null, criticalBypass: false, lastDigestAt });

describe('late-arriving events', () => {
  it('alerts on a case imported after the cursor passed its opening time', async () => {
    await subscribe('realtime');
    await tick(database.db, rules, recorder(), at('2026-10-12T13:00:00Z'), SINCE);
    await addCase('case_late', '2026-10-12T12:59:00Z'); // opened before the cursor, imported after
    const created = await tick(database.db, rules, recorder(), at('2026-10-12T14:00:00Z'), SINCE);
    expect(created).toEqual(['alert_high_severity_case_u_ts_east_case_late']);
    // Looking back again later does not alert twice.
    expect(await tick(database.db, rules, recorder(), at('2026-10-12T15:00:00Z'), SINCE)).toEqual([]);
  });
});

describe('digest slots', () => {
  it('holds an alert created after an empty weekly slot until the next Monday', async () => {
    await subscribe('weekly', at('2026-10-05T13:05:00Z'));
    await flushDigests(database.db, rules, recorder(), at('2026-10-12T14:00:00Z')); // Monday slot, nothing queued
    await addCase('case_tue', '2026-10-13T09:00:00Z');
    await runAlerts(database.db, rules, recorder(), SINCE, at('2026-10-13T09:30:00Z'));
    const ch = recorder();
    await flushDigests(database.db, rules, ch, at('2026-10-13T10:00:00Z')); // Tuesday
    expect(ch.calls).toHaveLength(0);
    await flushDigests(database.db, rules, ch, at('2026-10-19T13:30:00Z')); // next Monday
    expect(ch.calls).toHaveLength(1);
  });

  it('still catches up on alerts queued before a missed slot', async () => {
    await subscribe('weekly', at('2026-10-05T13:05:00Z'));
    await addCase('case_fri', '2026-10-09T10:00:00Z');
    await runAlerts(database.db, rules, recorder(), SINCE, at('2026-10-09T10:30:00Z'));
    const ch = recorder();
    await flushDigests(database.db, rules, ch, at('2026-10-13T10:00:00Z')); // the Monday flush was missed
    expect(ch.calls).toHaveLength(1);
  });
});

describe('demo subscriptions', () => {
  it('are seeded once, so an unsubscribe survives a restart', async () => {
    expect(await seedDemoSubscriptionsOnce(database.db)).toBe(true);
    const mine = and(eq(alertSubscriptions.userId, 'u_ts_east'), eq(alertSubscriptions.ruleId, 'high_severity_case'));
    expect(await database.db.select().from(alertSubscriptions).where(mine)).toHaveLength(1);
    await database.db.delete(alertSubscriptions).where(mine); // Jordan unsubscribes
    expect(await seedDemoSubscriptionsOnce(database.db)).toBe(false); // the next start-up
    expect(await database.db.select().from(alertSubscriptions).where(mine)).toHaveLength(0);
  });
});

describe('start-up', () => {
  it('retries after a failed start instead of caching the error', async () => {
    let calls = 0;
    const get = onceWithRetry(async () => {
      if (++calls === 1) throw new Error('database not reachable yet');
      return 'ready';
    });
    await expect(get()).rejects.toThrow('not reachable');
    await expect(get()).resolves.toBe('ready');
    await expect(get()).resolves.toBe('ready');
    expect(calls).toBe(2);
  });

  it('starts the scheduler from the server start-up hook, with no page visit', async () => {
    const saved = { s: process.env.ALERTS_SCHEDULER, r: process.env.NEXT_RUNTIME };
    process.env.ALERTS_SCHEDULER = 'true';
    process.env.NEXT_RUNTIME = 'nodejs';
    const { register } = await import('../instrumentation');
    const runtime = await import('@/server/runtime');
    try {
      await register();
      const { database: db } = await runtime.getAlertsRuntime();
      let cursor: unknown[] = [];
      for (let i = 0; i < 60 && cursor.length === 0; i++) {
        cursor = await db.db.select().from(alertCursor).where(eq(alertCursor.id, 'events'));
        if (cursor.length === 0) await new Promise((r) => setTimeout(r, 500));
      }
      expect(cursor).toHaveLength(1); // the first tick ran on its own
      expect((await db.db.select().from(alertDeliveries)).length).toBeGreaterThan(0);
    } finally {
      runtime.stopScheduler();
      process.env.ALERTS_SCHEDULER = saved.s;
      process.env.NEXT_RUNTIME = saved.r;
      if (saved.s === undefined) delete process.env.ALERTS_SCHEDULER;
      if (saved.r === undefined) delete process.env.NEXT_RUNTIME;
    }
  }, 60_000);
});
