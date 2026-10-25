// Low-usage alert events (plan item 12, Alex's option (a)): a product used under 20% of what was bought, at least six
// months after purchase. The thresholds live in db/product-usage.ts (plan item 14), so the rule and the seed can't drift.
// Server-only. The demo's usage rows are synthetic; a row from any other source is ignored rather than alerted on.
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { lowUsageHits, type ProductUsageRow } from '../db/product-usage';
import { accounts, productUsage } from '../db/schema';
import type { AlertEvent } from './engine';

/**
 * Events in [since, until] for the usage months that are low as of `until`. A month is one event, so a product that
 * stays low alerts once a month, and the unique (rule, user, event) key keeps a repeated scan from alerting twice.
 */
export async function lowUsageEvents(db: Db, since: Date, until: Date): Promise<AlertEvent[]> {
  // Joined on the account's own snapshot, so only the current snapshot's usage is read (the plan's snapshot note).
  const rows = await db
    .select({ u: productUsage, accountName: accounts.name })
    .from(productUsage)
    .innerJoin(accounts, and(eq(accounts.id, productUsage.accountId), eq(accounts.snapshotId, productUsage.snapshotId)));
  const usage: ProductUsageRow[] = [];
  const names = new Map<string, string>();
  for (const { u, accountName } of rows) {
    if (u.source !== 'synthetic') continue;
    usage.push({ ...u, source: 'synthetic' });
    names.set(u.accountId, accountName);
  }
  const events: AlertEvent[] = [];
  for (const hit of lowUsageHits(usage, until.toISOString().slice(0, 10))) {
    const at = new Date(`${hit.usageMonth}T00:00:00Z`);
    if (at < since || at > until) continue;
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
