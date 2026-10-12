import { openDatabase, type Database } from '../db/client';
import { alertSubscriptions } from '../db/schema';
import { createChannels } from '../alerts/channels';
import { DEMO_NOW, DEMO_SINCE, DEMO_SUBSCRIPTIONS } from '../alerts/demo';
import { loadRules, type AlertRule } from '../alerts/rules';
import { startScheduler, tick } from '../alerts/scheduler';
import { testIdentitiesEnabled } from './identity';

// One database and rule set per server process.
// - Default: one tick as of the demo time, so the demo always shows the same alerts.
// - ALERTS_SCHEDULER=true: a tick every ALERTS_TICK_SECONDS (default 60) with the real clock, resuming from
//   the cursor stored in the database.
const g = globalThis as unknown as { __alerts?: Promise<{ database: Database; rules: Map<string, AlertRule> }> };

export function getAlertsRuntime() {
  g.__alerts ??= (async () => {
    const database = await openDatabase();
    const rules = loadRules();
    const channels = createChannels();
    const opts = { testIdentityInLinks: testIdentitiesEnabled() };
    if (process.env.ALERTS_SEED_DEMO_SUBSCRIPTIONS !== 'false') {
      await database.db.insert(alertSubscriptions).values(DEMO_SUBSCRIPTIONS).onConflictDoNothing();
    }
    if (process.env.ALERTS_SCHEDULER === 'true') {
      const seconds = Math.max(10, Number(process.env.ALERTS_TICK_SECONDS ?? 60) || 60);
      startScheduler((now) => tick(database.db, rules, channels, now, DEMO_SINCE, opts), seconds * 1000);
    } else {
      await tick(database.db, rules, channels, DEMO_NOW, DEMO_SINCE, opts);
    }
    return { database, rules };
  })();
  return g.__alerts;
}
