// Per-user rate limit for typed questions (T-07). In memory, per server process; a shared store
// (Postgres or Redis) replaces it when the app runs on more than one instance.
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

export const questionLimiter = new RateLimiter(20, 60_000);

/**
 * Session lock (PRD S3, Should): after `maxFlagged` flagged questions within `windowMs`, the user is locked out
 * of asking for `lockMs`. In memory, per process, like the rate limiter.
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

export const flagGuard = new FlagGuard();
