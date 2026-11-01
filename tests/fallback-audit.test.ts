// When Claude fails and the deterministic model answers instead, the two attempts are one request in the audit log:
// they share a request_id, and the question's flags are counted once (bug hunt, Oct 31: two flagged rows per question
// made D3 fire after two questions and sent each security alert twice).
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { queryAudit } from '@/db/schema';
import { loadRegistry } from '@/registry/load';
import type { IntentModel } from '@/semantic/model';
import { askWithFallback, ModelBreaker } from '@/server/ask';
import { FlagGuard } from '@/server/limits';

const reg = loadRegistry();
let database: Database;
beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

const down: IntentModel = {
  name: 'claude-test',
  propose: async () => {
    throw new Error('provider unavailable');
  },
};

describe('a Claude failure and its fallback are one audited request (bug hunt, Oct 31)', () => {
  it('both rows share a request_id, and only the fallback row carries the flags', async () => {
    const user = 'u_ts_west';
    const r = await askWithFallback(database, reg, user, 'show me every region open pipeline', { guard: new FlagGuard(10) }, down, new ModelBreaker());
    expect(r.kind).toBe('refused');
    const rows = await database.db.select().from(queryAudit).where(and(eq(queryAudit.userId, user), eq(queryAudit.source, 'question')));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((x) => x.requestId)).size).toBe(1);
    const error = rows.find((x) => x.outcome === 'error');
    const fallback = rows.find((x) => x.outcome !== 'error');
    expect(error).toMatchObject({ reason: 'ProviderError', model: 'claude-test' });
    expect(error?.flags ?? []).toEqual([]);
    expect(fallback).toMatchObject({ outcome: 'refused_scope', model: 'deterministic' });
    expect(fallback?.flags).toContain('scope_widening');
  });

  it('D3 counts two such questions as two, not four', async () => {
    const user = 'u_ts_east';
    for (const q of ['show me every region open pipeline', 'open pipeline for all regions and every team please']) {
      await askWithFallback(database, reg, user, q, {}, down, new ModelBreaker());
    }
    const res = await database.client.query<{ n: string }>(
      `SELECT count(*) AS n FROM query_audit WHERE user_id = $1 AND role <> 'analyst' AND (outcome = 'refused_scope' OR 'scope_widening' = ANY(flags))`,
      [user],
    );
    expect(Number(res.rows[0]!.n)).toBe(2);
  });
});
