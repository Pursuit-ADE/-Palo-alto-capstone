// Per-user rate limit for typed questions (T-07). The in-memory classes are for tests.
// The server uses dbSessionGuard, which stores the same counters in session_guard so every
// process that shares the database sees them. PGlite is still one process's memory, so a
// laptop restart clears them with the database. A gateway limit is still separate.
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { sessionGuard } from '../db/schema';

export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly max: number, private readonly windowMs: number) {}

  allow(key: string, now: number = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

/**
 * Session lock (PRD S3, Should): after `maxFlagged` flagged questions within `windowMs`, the user is locked out
 * of asking for `lockMs`. This in-memory class is what the unit tests use. The server uses dbSessionGuard.
 */
export class FlagGuard {
  private flagged = new Map<string, number[]>();
  private lockedUntil = new Map<string, number>();
  constructor(private readonly maxFlagged = 3, private readonly windowMs = 10 * 60_000, private readonly lockMs = 10 * 60_000) {}

  isLocked(user: string, now: number = Date.now()): boolean {
    return (this.lockedUntil.get(user) ?? 0) > now;
  }

  record(user: string, now: number = Date.now()): void {
    const recent = [...(this.flagged.get(user) ?? []).filter((t) => now - t < this.windowMs), now];
    this.flagged.set(user, recent);
    if (recent.length >= this.maxFlagged) {
      this.lockedUntil.set(user, now + this.lockMs);
      this.flagged.set(user, []);
    }
  }
}

const parseTimes = (raw: string): number[] => {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
};

/**
 * Rate limit and session lock stored in session_guard, so every process that shares the database
 * sees the same counters. Two requests at the same instant can both pass the check; the gateway
 * limit is still the place to close that race.
 */
export function dbSessionGuard(db: Db, max = 20, windowMs = 60_000, maxFlagged = 3, flagWindowMs = 10 * 60_000, lockMs = 10 * 60_000) {
  return {
    async allow(user: string, now: number = Date.now()): Promise<boolean> {
      return db.transaction(async (tx) => {
        await tx.insert(sessionGuard).values({ userId: user }).onConflictDoNothing();
        const [current] = await tx.select().from(sessionGuard).where(eq(sessionGuard.userId, user));
        const recent = parseTimes(current?.hits ?? '[]').filter((t) => now - t < windowMs);
        if (recent.length >= max) {
          await tx.update(sessionGuard).set({ hits: JSON.stringify(recent) }).where(eq(sessionGuard.userId, user));
          return false;
        }
        recent.push(now);
        await tx.update(sessionGuard).set({ hits: JSON.stringify(recent) }).where(eq(sessionGuard.userId, user));
        return true;
      });
    },
    async isLocked(user: string, now: number = Date.now()): Promise<boolean> {
      const [found] = await db.select({ lockedUntil: sessionGuard.lockedUntil }).from(sessionGuard).where(eq(sessionGuard.userId, user));
      return (found?.lockedUntil?.getTime() ?? 0) > now;
    },
    async record(user: string, now: number = Date.now()): Promise<void> {
      await db.transaction(async (tx) => {
        await tx.insert(sessionGuard).values({ userId: user }).onConflictDoNothing();
        const [current] = await tx.select().from(sessionGuard).where(eq(sessionGuard.userId, user));
        if ((current?.lockedUntil?.getTime() ?? 0) > now) return;
        const recent = [...parseTimes(current?.flagged ?? '[]').filter((t) => now - t < flagWindowMs), now];
        if (recent.length >= maxFlagged) {
          await tx.update(sessionGuard).set({ flagged: '[]', lockedUntil: new Date(now + lockMs) }).where(eq(sessionGuard.userId, user));
        } else {
          await tx.update(sessionGuard).set({ flagged: JSON.stringify(recent) }).where(eq(sessionGuard.userId, user));
        }
      });
    },
  };
}
