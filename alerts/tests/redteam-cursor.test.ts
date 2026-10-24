import { expect, it } from 'vitest';
import { openDatabase } from '@/db/client';
import { alertCursor } from '@/db/schema';
import { tick } from '@/alerts/scheduler';

it('an older scheduler tick cannot move a newer cursor backward', async () => {
  const database = await openDatabase();
  try {
    const later = new Date('2026-10-24T14:00:00Z');
    const earlier = new Date('2026-10-24T13:00:00Z');
    await database.db.insert(alertCursor).values({ id: 'events', evaluatedUntil: later });
    await tick(database.db, new Map(), { async deliver() { return true; } }, earlier, new Date('2026-09-01T00:00:00Z'));
    const [cursor] = await database.db.select().from(alertCursor);
    expect(cursor!.evaluatedUntil).toEqual(later);
  } finally { await database.close(); }
});
