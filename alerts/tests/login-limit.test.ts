// Audit A4: the alerts app's sign-in limits live in the database, so every process shares them.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { loginAttempts } from '@/db/schema';
import { allowAttempt } from '@/server/login-limit';

let database: Database;
beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

describe('alerts sign-in limit', () => {
  it('allows max attempts a minute per key, then refuses, then allows again after a minute', async () => {
    const t0 = new Date('2026-10-17T12:00:00Z');
    const at = (s: number) => new Date(t0.getTime() + s * 1000);
    for (let i = 0; i < 10; i++) expect(await allowAttempt(database.db, 'login:jordan', 10, at(i))).toBe(true);
    expect(await allowAttempt(database.db, 'login:jordan', 10, at(11))).toBe(false);
    expect(await allowAttempt(database.db, 'login:someone-else', 10, at(12))).toBe(true);
    expect(await allowAttempt(database.db, 'login:jordan', 10, at(75))).toBe(true);
  });

  // Review, Nov 1: the count, the check and the insert were separate steps, so 20 attempts that arrived together
  // all read the same count and all passed a limit of 10.
  it('lets in exactly the limit when attempts arrive at the same moment', async () => {
    const now = new Date('2026-10-17T14:00:00Z');
    const together = (key: string, n: number) => Array.from({ length: n }, () => allowAttempt(database.db, key, 10, now));
    const results = await Promise.all([...together('login:parallel', 20), ...together('login:parallel-other', 15)]);
    expect(results.slice(0, 20).filter(Boolean)).toHaveLength(10);
    // Another key is counted on its own, not held up or let through by the first.
    expect(results.slice(20).filter(Boolean)).toHaveLength(10);
  });

  it('deletes attempts older than a minute as new ones arrive', async () => {
    await allowAttempt(database.db, 'login:prune', 10, new Date('2026-10-17T13:00:00Z'));
    await allowAttempt(database.db, 'login:prune', 10, new Date('2026-10-17T13:05:00Z'));
    const rows = await database.db.select().from(loginAttempts);
    expect(rows.every((r) => r.at >= new Date('2026-10-17T13:04:00Z'))).toBe(true);
  });
});
