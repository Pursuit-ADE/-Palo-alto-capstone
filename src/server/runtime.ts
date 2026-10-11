import { openDatabase, type Database } from '../db/client';
import { alertSubscriptions } from '../db/schema';
import { createChannels } from '../alerts/channels';
import { DEMO_NOW, DEMO_SINCE, DEMO_SUBSCRIPTIONS } from '../alerts/demo';
import { runAlerts } from '../alerts/engine';
import { loadRules, type AlertRule } from '../alerts/rules';

// One embedded database per server process, loaded and evaluated once at start (as of the demo time).
const g = globalThis as unknown as { __alerts?: Promise<{ database: Database; rules: Map<string, AlertRule> }> };

export function getAlertsRuntime() {
  g.__alerts ??= (async () => {
    const database = await openDatabase();
    const rules = loadRules();
    await database.db.insert(alertSubscriptions).values(DEMO_SUBSCRIPTIONS).onConflictDoNothing();
    await runAlerts(database.db, rules, createChannels(), DEMO_SINCE, DEMO_NOW);
    return { database, rules };
  })();
  return g.__alerts;
}
