// The per-minute refusal says how long to wait, counted to when the oldest question in the window drops out
// (REC; UX round 1, finding 11: "a moment" left a rehearsal script retrying into the limit).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { dbSessionGuard, rateLimitMessage } from '@/server/limits';

let database: Database;
beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

describe('rate-limit wait', () => {
  it('counts the wait from the oldest question in the window', async () => {
    const guard = dbSessionGuard(database.auditDb, 2, 60_000);
    const start = 5_000_000;
    expect(await guard.allow('u_rate_wait', start)).toBe(true);
    expect(await guard.allow('u_rate_wait', start + 20_000)).toBe(true);
    expect(await guard.allow('u_rate_wait', start + 30_000)).toBe(false);
    // The first question leaves the window at start + 60 s, 30 s from now.
    expect(await guard.waitSeconds('u_rate_wait', start + 30_000)).toBe(30);
    expect(await guard.waitSeconds('u_rate_wait', start + 59_500)).toBe(1);
  });

  it('names the wait in the message', () => {
    expect(rateLimitMessage(30)).toBe('Too many questions in the last minute. Please wait about 30 seconds and ask again.');
    expect(rateLimitMessage(1)).toBe('Too many questions in the last minute. Please wait a second and ask again.');
  });
});
