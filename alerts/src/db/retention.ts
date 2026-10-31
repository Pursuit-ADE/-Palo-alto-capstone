// Data retention (Oct 17 audit, P1). Run daily with the owner login: `npm run purge` (add --dry-run to only count).
// Sent, suppressed and failed alerts past DELIVERY_RETENTION_DAYS are deleted; alerts still waiting to be sent are
// kept. Confirm the period with the client.
import { and, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from './client';
import { alertDeliveries, appSessions } from './schema';

/** A whole number of days, at least 1; anything else (empty, negative, 0, "9O") uses the default. */
export function retentionDays(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

// A negative or zero value would put the cutoff in the future and delete all alert history, so it's refused.
export const DELIVERY_RETENTION_DAYS = retentionDays(process.env.DELIVERY_RETENTION_DAYS, 180);
const FINISHED = ['delivered', 'suppressed_no_access', 'suppressed_inactive', 'failed'];

export async function purge(db: Db, opts: { now?: Date; deliveryDays?: number; dryRun?: boolean } = {}) {
  const now = opts.now ?? new Date();
  const days = opts.deliveryDays ?? DELIVERY_RETENTION_DAYS;
  if (!Number.isInteger(days) || days < 1) throw new Error(`Alert retention must be at least 1 day (got ${days}).`);
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const oldDeliveries = and(lt(alertDeliveries.createdAt, cutoff), inArray(alertDeliveries.status, FINISHED));
  const expiredSessions = lt(appSessions.expiresAt, now);
  if (opts.dryRun) {
    const n = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
    return {
      oldDeliveries: await n(db.select({ n: sql<number>`count(*)` }).from(alertDeliveries).where(oldDeliveries)),
      expiredSessions: await n(db.select({ n: sql<number>`count(*)` }).from(appSessions).where(expiredSessions)),
    };
  }
  return {
    oldDeliveries: (await db.delete(alertDeliveries).where(oldDeliveries).returning({ k: alertDeliveries.id })).length,
    expiredSessions: (await db.delete(appSessions).where(expiredSessions).returning({ k: appSessions.tokenHash })).length,
  };
}
