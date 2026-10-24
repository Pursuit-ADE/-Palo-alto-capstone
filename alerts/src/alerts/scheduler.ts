// The scheduler: on every tick, evaluate events since the stored cursor, then flush due digests and retries.
// The cursor lives in the database, so a restart resumes where it left off instead of re-scanning or skipping.
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { alertCursor } from '../db/schema';
import type { Channels } from './channels';
import { flushDigests, runAlerts, type EngineOptions } from './engine';
import type { AlertRule } from './rules';

const CURSOR_ID = 'events';

/**
 * How far back each tick looks again before the cursor. Events are matched on their business time (when a
 * case was opened), but an import can land after that time has passed; looking back catches it, and
 * deduplication stops a second alert for anything already seen. Override with ALERTS_LATE_WINDOW_HOURS.
 */
export function lateWindowMs(env: Record<string, string | undefined> = process.env): number {
  const hours = Number(env.ALERTS_LATE_WINDOW_HOURS ?? 72);
  return (Number.isFinite(hours) && hours >= 0 ? Math.min(hours, 24 * 31) : 72) * 3_600_000;
}

/** One scheduler tick. `start` is where evaluation begins the very first time. Returns the alerts created. */
export async function tick(db: Db, rules: Map<string, AlertRule>, channels: Channels, now: Date, start: Date, opts: EngineOptions = {}) {
  const [cursor] = await db.select().from(alertCursor).where(eq(alertCursor.id, CURSOR_ID));
  const since = cursor ? new Date(Math.max(start.getTime(), cursor.evaluatedUntil.getTime() - lateWindowMs())) : start;
  const created = since < now ? await runAlerts(db, rules, channels, since, now, opts) : [];
  await flushDigests(db, rules, channels, now);
  await db
    .insert(alertCursor)
    .values({ id: CURSOR_ID, evaluatedUntil: now })
    .onConflictDoUpdate({ target: alertCursor.id, set: { evaluatedUntil: now } });
  return created;
}

/** Runs `tick` every `everyMs` with the wall clock. One tick at a time; a slow tick delays the next. */
export function startScheduler(run: (now: Date) => Promise<unknown>, everyMs: number): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const loop = async () => {
    if (stopped) return;
    try {
      await run(new Date());
    } catch (e) {
      console.error('alerts scheduler tick failed', e instanceof Error ? e.name : 'unknown');
    }
    if (!stopped) timer = setTimeout(loop, everyMs);
  };
  void loop();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
