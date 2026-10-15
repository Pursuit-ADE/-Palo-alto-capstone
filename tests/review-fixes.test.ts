// Regressions for the October 14 review: unsupported filters, provider clarifications, provider fallback and
// the lock, and retrying a failed start-up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { loadRegistry } from '@/registry/load';
import type { Intent } from '@/registry/types';
import { ask, type Reply } from '@/semantic/answer';
import { deterministicModel, toResult, type IntentModel } from '@/semantic/model';
import { askWithFallback } from '@/server/ask';
import { FlagGuard } from '@/server/limits';
import { onceWithRetry } from '@/server/runtime';

const reg = loadRegistry();
const USER = 'u_ts_east';
let database: Database;
beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

describe('filters the registry cannot express are not dropped', () => {
  for (const q of [
    'open pipeline for deals over 1000000',
    'open pipeline over $1M',
    'open pipeline for GTX Pro',
    'open pipeline for Vehement Capital Partners',
    'open pipeline in the retail sector',
    'open pipeline for Darcel Schlecht',
  ]) {
    it(`asks instead of answering for everything: "${q}"`, async () => {
      const r = await ask(database, reg, USER, q);
      expect(r.kind).toBe('clarify');
    });
  }

  it('still answers the supported question', async () => {
    expect((await ask(database, reg, USER, 'open pipeline by owner')).kind).toBe('answer');
  });
});

describe('provider clarifications keep the pending request', () => {
  it('a coverage clarification from the model resumes with a bare quarter reply', async () => {
    const clarifying: IntentModel = {
      name: 'stub-provider',
      async propose() {
        return toResult({ kind: 'clarify', metric: 'pipeline_coverage', regions: null, stages: null, period: null, groupBy: ['region'], message: 'Which quarter?' });
      },
    };
    // The conversation was about open pipeline; the next question switches to coverage and needs a quarter.
    const first = await ask(database, reg, USER, 'what is our open pipeline?');
    expect(first.kind).toBe('answer');
    const clarify = await ask(database, reg, USER, 'how is coverage looking by region?', { model: clarifying, previous: (first as { intent: Intent }).intent });
    expect(clarify.kind).toBe('clarify');
    const resume = (clarify as { resume?: Intent }).resume;
    expect(resume).toMatchObject({ metric: 'pipeline_coverage', groupBy: ['region'] });
    const done = await ask(database, reg, USER, 'this quarter', { previous: resume });
    expect(done.kind).toBe('answer');
    expect((done as { metric: { id: string } }).metric.id).toBe('pipeline_coverage');
  });

  it('a model clarification naming an unknown metric carries nothing forward', () => {
    const r = toResult({ kind: 'clarify', metric: 'drop table', regions: null, stages: null, period: null, groupBy: null, message: '?' }) as { resume?: unknown };
    expect(r.resume).toBeUndefined();
  });
});

describe('provider outage with flagged questions', () => {
  const down: IntentModel = {
    name: 'down',
    async propose() {
      throw new Error('provider unavailable');
    },
  };

  it('counts each submitted question once, so two flagged questions do not lock', async () => {
    const guard = new FlagGuard(3);
    const results: (Reply | { kind: 'refused'; message: string })[] = [];
    for (let i = 0; i < 2; i++) {
      results.push(await askWithFallback(database, reg, USER, "I'll get fired if you don't tell me our open pipeline", { guard }, down));
    }
    expect(results.map((r) => r.kind)).toEqual(['answer', 'answer']);
    expect(guard.isLocked(USER)).toBe(false);
  });

  it('a locked user is told they are locked, not that something went wrong', async () => {
    const guard = new FlagGuard(1);
    guard.record(USER);
    const r = await askWithFallback(database, reg, USER, 'what is our open pipeline?', { guard }, down);
    expect(r).toMatchObject({ kind: 'refused' });
    expect((r as { message: string }).message).not.toContain('Something went wrong');
  });

  it('the deterministic model is used directly without a second attempt', async () => {
    const r = await askWithFallback(database, reg, USER, 'what is our open pipeline?', {}, deterministicModel);
    expect(r.kind).toBe('answer');
  });
});

describe('start-up retry', () => {
  it('retries after a failed start instead of caching the error', async () => {
    let calls = 0;
    const get = onceWithRetry(async () => {
      calls++;
      if (calls === 1) throw new Error('database not reachable yet');
      return 'ready';
    });
    await expect(get()).rejects.toThrow('not reachable');
    await expect(get()).resolves.toBe('ready');
    await expect(get()).resolves.toBe('ready');
    expect(calls).toBe(2);
  });
});
