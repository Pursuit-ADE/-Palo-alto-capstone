// The session lock's message names how long asking is paused, and that time is the lock the guards apply (UX review,
// Nov 2: "a few minutes" was really 10, and people signed out and in to clear it, which doesn't).
import { describe, expect, it } from 'vitest';
import { LOCK_MINUTES, SessionLocked } from '@/semantic/answer';
import { FlagGuard } from '@/server/limits';

describe('session lock message', () => {
  it('names the lock time and says signing out does not reset it', () => {
    const message = new SessionLocked().message;
    // "up to": the same text shows at any point in the lock, minute 9 included (review, Nov 2).
    expect(message).toContain(`up to ${LOCK_MINUTES} minutes`);
    expect(message).toMatch(/signing out doesn't reset it/);
  });

  it('matches the time the guard actually locks for', () => {
    const guard = new FlagGuard();
    const start = 1_000_000;
    for (let i = 0; i < 3; i++) guard.record('u_ts_east', start + i);
    expect(guard.isLocked('u_ts_east', start + 2 + LOCK_MINUTES * 60_000 - 1)).toBe(true);
    expect(guard.isLocked('u_ts_east', start + 2 + LOCK_MINUTES * 60_000)).toBe(false);
  });
});
