import { eq } from 'drizzle-orm';
import { openDatabase, type Database, type Db } from '../db/client';
import { alertCursor, alertSubscriptions } from '../db/schema';
import { createChannels } from '../alerts/channels';
import { DEMO_NOW, DEMO_SINCE, DEMO_SUBSCRIPTIONS } from '../alerts/demo';
import { loadRules, type AlertRule } from '../alerts/rules';
import { startScheduler, tick } from '../alerts/scheduler';
import { testIdentitiesEnabled } from './identity';

// One database and rule set per server process.
// - Default: one tick as of the demo time, so the demo always shows the same alerts.
// - ALERTS_SCHEDULER=true: a tick every ALERTS_TICK_SECONDS (default 60) with the real clock, resuming from
//   the cursor stored in the database. instrumentation.ts starts it when the server starts, so it runs
//   without anyone opening a page.
type Runtime = { database: Database; rules: Map<string, AlertRule> };
const g = globalThis as unknown as { __alerts?: () => Promise<Runtime>; __stopScheduler?: () => void };

/**
 * Runs `init` once and shares the result. A failed start (say the database was briefly unreachable) is not
 * cached: the next call tries again instead of returning the same error until a restart.
 */
export function onceWithRetry<T>(init: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= init().catch((e: unknown) => {
      pending = undefined;
      throw e;
    });
    return pending;
  };
}

const SEEDED_MARKER = 'demo_subscriptions_seeded';

/**
 * Adds the demo subscriptions the first time a database is used, and never again: a marker row records that it
 * happened, so someone who unsubscribes stays unsubscribed after a restart.
 */
export async function seedDemoSubscriptionsOnce(db: Db, now: Date = new Date()): Promise<boolean> {
  const [marker] = await db.select().from(alertCursor).where(eq(alertCursor.id, SEEDED_MARKER));
  if (marker) return false;
  await db.insert(alertSubscriptions).values(DEMO_SUBSCRIPTIONS).onConflictDoNothing();
  await db.insert(alertCursor).values({ id: SEEDED_MARKER, evaluatedUntil: now }).onConflictDoNothing();
  return true;
}

export function getAlertsRuntime(): Promise<Runtime> {
  g.__alerts ??= onceWithRetry(async () => {
    const database = await openDatabase();
    const rules = loadRules();
    const channels = createChannels();
    const opts = { testIdentityInLinks: testIdentitiesEnabled() };
    if (process.env.ALERTS_SEED_DEMO_SUBSCRIPTIONS !== 'false') await seedDemoSubscriptionsOnce(database.db);
    if (process.env.ALERTS_SCHEDULER === 'true') {
      const seconds = Math.max(10, Number(process.env.ALERTS_TICK_SECONDS ?? 60) || 60);
      g.__stopScheduler = startScheduler((now) => tick(database.db, rules, channels, now, DEMO_SINCE, opts), seconds * 1000);
    } else {
      await tick(database.db, rules, channels, DEMO_NOW, DEMO_SINCE, opts);
    }
    return { database, rules };
  });
  return g.__alerts();
}

/** Stops the background scheduler, if one is running (tests and shutdown). */
export function stopScheduler(): void {
  g.__stopScheduler?.();
  g.__stopScheduler = undefined;
}
