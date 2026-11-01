// The limits the docs promise, checked at the defaults the server actually uses (README, SYSTEM-CARD, RED-TEAM).
// Other tests build their guards with their own numbers, so changing a server default failed no test (bug hunt, Oct 31).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { loadRegistry } from '@/registry/load';
import { MAX_QUESTION_LENGTH } from '@/semantic/answer';
import { compile, MAX_RESULT_ROWS } from '@/semantic/compile';
import { CLAUDE_TIMEOUT_MS } from '@/semantic/model';
import { resolvePrincipal } from '@/semantic/scope';
import { ModelBreaker } from '@/server/ask';
import { dbSessionGuard } from '@/server/limits';

let database: Database;
beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

const T0 = Date.UTC(2026, 9, 31, 12);
const MINUTE = 60_000;

describe('documented limits at the server defaults (bug hunt, Oct 31)', () => {
  it('20 questions a minute per user', async () => {
    const guard = dbSessionGuard(database.auditDb);
    for (let i = 0; i < 20; i++) expect(await guard.allow('u_limits_rate', T0 + i)).toBe(true);
    expect(await guard.allow('u_limits_rate', T0 + 30)).toBe(false);
    expect(await guard.allow('u_limits_rate', T0 + MINUTE + 30)).toBe(true);
  });

  it('a lock after 3 flagged questions, for 10 minutes', async () => {
    const guard = dbSessionGuard(database.auditDb);
    await guard.record('u_limits_lock', T0);
    await guard.record('u_limits_lock', T0 + 1);
    expect(await guard.isLocked('u_limits_lock', T0 + 2)).toBe(false);
    await guard.record('u_limits_lock', T0 + 2);
    expect(await guard.isLocked('u_limits_lock', T0 + 3)).toBe(true);
    expect(await guard.isLocked('u_limits_lock', T0 + 2 + 10 * MINUTE - 1)).toBe(true);
    expect(await guard.isLocked('u_limits_lock', T0 + 2 + 10 * MINUTE + 1)).toBe(false);
  });

  it('the model breaker opens after 3 failures and stays open 5 minutes', () => {
    const breaker = new ModelBreaker();
    breaker.failed(T0);
    breaker.failed(T0 + 1);
    expect(breaker.isOpen(T0 + 2)).toBe(false);
    breaker.failed(T0 + 2);
    expect(breaker.isOpen(T0 + 3)).toBe(true);
    expect(breaker.isOpen(T0 + 2 + 5 * MINUTE + 1)).toBe(false);
  });

  it('an 8-second model timeout, 300-character questions and at most 500 grouped rows', async () => {
    expect(process.env.CLAUDE_TIMEOUT_MS ?? '').toBe('');
    expect(CLAUDE_TIMEOUT_MS).toBe(8000);
    expect(MAX_QUESTION_LENGTH).toBe(300);
    expect(MAX_RESULT_ROWS).toBe(500);
    const principal = await resolvePrincipal(database.db, 'u_analyst');
    const q = compile({ metric: 'open_pipeline', filters: {}, groupBy: ['owner'] }, loadRegistry(), principal, 'snap');
    expect(q.text).toContain(`LIMIT ${MAX_RESULT_ROWS}`);
  });
});
