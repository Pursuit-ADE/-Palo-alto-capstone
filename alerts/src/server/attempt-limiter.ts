// Per-process sliding-window counter for sign-in attempts (the alerts app has no shared guard table). Keys whose
// attempts have all expired are dropped, and the map is capped, so made-up usernames or addresses can't grow it
// without bound.
export class AttemptLimiter {
  private readonly attempts = new Map<string, number[]>();
  constructor(private readonly windowMs = 60_000, private readonly maxKeys = 10_000) {}

  allow(key: string, max: number, now = Date.now()): boolean {
    if (this.attempts.size >= this.maxKeys && !this.attempts.has(key)) this.evict(now);
    const recent = (this.attempts.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= max) return false;
    // Re-insert so the map's order stays oldest-activity first for eviction.
    this.attempts.delete(key);
    this.attempts.set(key, [...recent, now]);
    return true;
  }

  get size(): number {
    return this.attempts.size;
  }

  private evict(now: number) {
    for (const [k, times] of this.attempts) if (now - times[times.length - 1]! >= this.windowMs) this.attempts.delete(k);
    // Still full of live keys: drop the least recently used rather than grow.
    for (const k of this.attempts.keys()) {
      if (this.attempts.size < this.maxKeys) break;
      this.attempts.delete(k);
    }
  }
}
