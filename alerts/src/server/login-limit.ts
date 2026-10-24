// Brute-force limits for the alerts app's sign-in, kept in the database so every server process shares them
// (audit A4). Each attempt is a row; rows older than a minute are deleted as new attempts arrive, so the table
// stays small and usernames an attacker makes up don't pile up.
import { randomUUID } from 'node:crypto';
import { and, count, eq, gt, lt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { loginAttempts } from '../db/schema';

const WINDOW_MS = 60_000;

/** Records an attempt under `key` and says whether it is within `max` attempts in the last minute. */
export async function allowAttempt(db: Db, key: string, max: number, now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - WINDOW_MS);
  await db.delete(loginAttempts).where(lt(loginAttempts.at, since));
  const [row] = await db.select({ n: count() }).from(loginAttempts).where(and(eq(loginAttempts.key, key), gt(loginAttempts.at, since)));
  if ((row?.n ?? 0) >= max) return false;
  await db.insert(loginAttempts).values({ id: randomUUID(), key, at: now });
  return true;
}
