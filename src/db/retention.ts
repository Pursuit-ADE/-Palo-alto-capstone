// Data retention (Oct 17 audit, P1). Run daily with the owner login: `npm run purge` (add --dry-run to only count).
// Defaults follow docs/SYSTEM-CARD.md and can be changed with AUDIT_RETENTION_DAYS; confirm them with the client.
import { and, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from './client';
import { appSessions, queryAudit, sessionGuard } from './schema';

/** A whole number of days, at least 1; anything else (empty, negative, 0, "9O") uses the default. */
export function retentionDays(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

// A negative or zero value would put the cutoff in the future and delete every audit row, so it's refused.
export const AUDIT_RETENTION_DAYS = retentionDays(process.env.AUDIT_RETENTION_DAYS, 90);

export interface PurgeResult {
  expiredSessions: number;
  idleGuards: number;
  oldAuditRows: number;
}

/** Deletes expired sessions, idle rate-limit rows and audit rows past retention. With dryRun, only counts. */
export async function purge(db: Db, opts: { now?: Date; auditDays?: number; dryRun?: boolean } = {}): Promise<PurgeResult> {
  const now = opts.now ?? new Date();
  const auditDays = opts.auditDays ?? AUDIT_RETENTION_DAYS;
  if (!Number.isInteger(auditDays) || auditDays < 1) throw new Error(`Audit retention must be at least 1 day (got ${auditDays}).`);
  const auditCutoff = new Date(now.getTime() - auditDays * 86_400_000);
  const where = {
    expiredSessions: lt(appSessions.expiresAt, now),
    // Rate-limit windows last minutes; a row that isn't locked can go (run this at a quiet time).
    idleGuards: or(isNull(sessionGuard.lockedUntil), lt(sessionGuard.lockedUntil, now)),
    oldAuditRows: lt(queryAudit.at, auditCutoff),
  };
  const count = async (table: typeof appSessions | typeof sessionGuard | typeof queryAudit, w: ReturnType<typeof and>) =>
    Number((await db.select({ n: sql<number>`count(*)` }).from(table).where(w))[0]?.n ?? 0);
  if (opts.dryRun) {
    return {
      expiredSessions: await count(appSessions, where.expiredSessions),
      idleGuards: await count(sessionGuard, where.idleGuards),
      oldAuditRows: await count(queryAudit, where.oldAuditRows),
    };
  }
  return {
    expiredSessions: (await db.delete(appSessions).where(where.expiredSessions).returning({ k: appSessions.tokenHash })).length,
    idleGuards: (await db.delete(sessionGuard).where(where.idleGuards).returning({ k: sessionGuard.userId })).length,
    oldAuditRows: (await db.delete(queryAudit).where(where.oldAuditRows).returning({ k: queryAudit.id })).length,
  };
}
