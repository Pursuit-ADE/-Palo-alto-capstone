// Brute-force limits for the alerts app's sign-in, kept in the database so every server process shares them
// (audit A4). Each attempt is a row; rows older than a minute are deleted as new attempts arrive, so the table
// stays small and usernames an attacker makes up don't pile up.
import { randomUUID } from 'node:crypto';
import { and, count, eq, gt, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { loginAttempts } from '../db/schema';

const WINDOW_MS = 60_000;

/** Records an attempt under `key` and says whether it is within `max` attempts in the last minute. */
export async function allowAttempt(db: Db, key: string, max: number, now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - WINDOW_MS);
  // Outside the lock below, so two keys pruning at once never wait on each other's rows.
  await db.delete(loginAttempts).where(lt(loginAttempts.at, since));
  // Counting, checking and inserting must be one decision per key. Done as separate steps, requests that arrive
  // together all read the same count before any insert is visible, so 20 at once passed a limit of 10 (review, Nov 1).
  // A transaction-scoped advisory lock on the key makes the next request for that key wait for this one to commit.
  // It needs no table or grant change, and a different key hashes to a different lock, so keys never wait on each other.
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    const [row] = await tx.select({ n: count() }).from(loginAttempts).where(and(eq(loginAttempts.key, key), gt(loginAttempts.at, since)));
    if ((row?.n ?? 0) >= max) return false;
    await tx.insert(loginAttempts).values({ id: randomUUID(), key, at: now });
    return true;
  });
}
