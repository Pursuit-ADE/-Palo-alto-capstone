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
