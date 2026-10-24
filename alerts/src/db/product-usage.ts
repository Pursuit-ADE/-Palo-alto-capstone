// Column contract for the low-usage alert (plan items 12 and 14). The rule is written against
// PRODUCT_USAGE_FIXTURE, then pointed at product_usage rows from the seed. Both copies of this file
// (src/db and alerts/src/db) stay identical.
//
// Table product_usage:
//   account_id, product_id, purchase_date, purchased_quantity, usage_month, quantity_used, source
// purchased_quantity is what was bought on purchase_date and is repeated on every month.
// source is 'synthetic'. Fire when the latest usage_month on or before the data date is under 20%
// of purchased_quantity and that date is at least six months after purchase_date. Route to the
// account team of account_id.

export const LOW_USAGE_FRACTION = 0.2;
export const USAGE_WAIT_MONTHS = 6;

export const PRODUCT_USAGE_COLUMNS = {
  accountId: 'account_id',
  productId: 'product_id',
  purchaseDate: 'purchase_date',
  purchasedQuantity: 'purchased_quantity',
  usageMonth: 'usage_month',
  quantityUsed: 'quantity_used',
  source: 'source',
} as const;

export type ProductUsageRow = {
  id: string;
  snapshotId: string;
  accountId: string;
  productId: string;
  purchaseDate: string;
  purchasedQuantity: number;
  usageMonth: string;
  quantityUsed: number;
  source: 'synthetic';
};

/** The three cases the rule tests, before they are attached to real accounts. */
export const USAGE_CASES = [
  { id: 'low', monthsAgo: 8, purchasedQuantity: 100, quantityUsed: 15 },
  { id: 'healthy', monthsAgo: 8, purchasedQuantity: 100, quantityUsed: 45 },
  { id: 'early', monthsAgo: 3, purchasedQuantity: 100, quantityUsed: 10 },
] as const;

function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

function monthStarts(from: string, through: string): string[] {
  const out: string[] = [];
  let cursor = `${from.slice(0, 7)}-01`;
  const end = `${through.slice(0, 7)}-01`;
  while (cursor <= end) {
    out.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return out;
}

/** True when `asOf` is at least six months after the purchase. */
export function usageEligible(purchaseDate: string, asOf: string): boolean {
  return addMonths(purchaseDate, USAGE_WAIT_MONTHS) <= asOf;
}

/** One row per month from the purchase month through the month of `asOf`. */
export function productUsageRows(
  snapshotId: string,
  cases: { accountId: string; productId: string; monthsAgo: number; purchasedQuantity: number; quantityUsed: number }[],
  asOf: string,
): ProductUsageRow[] {
  return cases.flatMap((c) => {
    const purchaseDate = addMonths(asOf, -c.monthsAgo);
    return monthStarts(purchaseDate, asOf).map((usageMonth) => ({
      id: `usage_${c.accountId}_${c.productId}_${usageMonth}`,
      snapshotId,
      accountId: c.accountId,
      productId: c.productId,
      purchaseDate,
      purchasedQuantity: c.purchasedQuantity,
      usageMonth,
      quantityUsed: c.quantityUsed,
      source: 'synthetic' as const,
    }));
  });
}

/** The small fixture the low-usage rule tests against before it is pointed at the seed. */
export function productUsageFixture(asOf: string): ProductUsageRow[] {
  return productUsageRows(
    'snap_fixture',
    USAGE_CASES.map((c) => ({
      accountId: `acct_${c.id}`,
      productId: 'prod_demo',
      monthsAgo: c.monthsAgo,
      purchasedQuantity: c.purchasedQuantity,
      quantityUsed: c.quantityUsed,
    })),
    asOf,
  );
}

/** The latest month on or before `asOf` for each account and product. */
export function latestUsage<T extends { accountId: string; productId: string; usageMonth: string }>(rows: T[], asOf: string): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    if (row.usageMonth > asOf) continue;
    const key = `${row.accountId}|${row.productId}`;
    const prev = best.get(key);
    if (!prev || row.usageMonth > prev.usageMonth) best.set(key, row);
  }
  return [...best.values()];
}

/** Rows the low-usage rule fires on: latest month, under 20%, and six months after purchase. */
export function lowUsageHits<T extends ProductUsageRow>(rows: T[], asOf: string): T[] {
  return latestUsage(rows, asOf).filter(
    (row) => usageEligible(row.purchaseDate, asOf) && row.quantityUsed / row.purchasedQuantity < LOW_USAGE_FRACTION,
  );
}
