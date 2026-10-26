// Low-usage alert events (plan item 12, Alex's option (a)): a product used under 20% of what was bought, at least six
// months after purchase. The thresholds live in db/product-usage.ts (plan item 14), so the rule and the seed can't drift.
// Server-only. The demo's usage rows are synthetic; a row from any other source is ignored rather than alerted on.
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { lowUsageHits, type ProductUsageRow } from '../db/product-usage';
import { accounts, dataSnapshots, productUsage } from '../db/schema';
import type { AlertEvent } from './engine';

/**
 * Events up to `until` for the usage months that are low as of the newest snapshot's data date. A month is one event,
 * so a product that stays low alerts once a month, and the unique (rule, user, event) key keeps a repeated scan from
 * alerting twice. There is no `since`: a usage month is stamped on its first day but reported weeks later, so a window
 * that starts at the scheduler's cursor would drop it for good (review of PR #68). Dedupe is what stops a repeat.
 */
export async function lowUsageEvents(db: Db, until: Date): Promise<AlertEvent[]> {
  // The newest snapshot, picked the way the copilot picks it, so both apps read the same data and the same date.
  const [snapshot] = await db
    .select()
    .from(dataSnapshots)
    .orderBy(desc(dataSnapshots.asOfDate), desc(dataSnapshots.loadedAt), desc(dataSnapshots.id))
    .limit(1);
  if (!snapshot) return [];
  // Only that snapshot's usage, joined on the account's own copy so one snapshot's rows never mix with another's.
  const rows = await db
    .select({ u: productUsage, accountName: accounts.name })
    .from(productUsage)
    .innerJoin(accounts, and(eq(accounts.id, productUsage.accountId), eq(accounts.snapshotId, productUsage.snapshotId)))
    .where(eq(productUsage.snapshotId, snapshot.id));
  const usage: ProductUsageRow[] = [];
  const names = new Map<string, string>();
  for (const { u, accountName } of rows) {
    if (u.source !== 'synthetic') continue;
    usage.push({ ...u, source: 'synthetic' });
    names.set(u.accountId, accountName);
  }
  const events: AlertEvent[] = [];
  // The data date is the snapshot's, not the wall clock, so the six-month check uses the same day as the copilot.
  for (const hit of lowUsageHits(usage, snapshot.asOfDate)) {
    const at = new Date(`${hit.usageMonth}T00:00:00Z`);
    if (at > until) continue;
    const accountName = names.get(hit.accountId) ?? hit.accountId;
    events.push({
      id: hit.id,
      accountId: hit.accountId,
      accountName,
      at,
      severity: 'info',
      values: {
        account: accountName,
        product: hit.productId,
        used: String(hit.quantityUsed),
        purchased: String(hit.purchasedQuantity),
        percent: String(Math.round((hit.quantityUsed / hit.purchasedQuantity) * 100)),
        purchasedOn: hit.purchaseDate,
        month: hit.usageMonth.slice(0, 7),
        source: hit.source,
      },
    });
  }
  return events;
}
