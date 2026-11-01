// Breakdown phrasings that were dropped without a word (PRD A2, bug hunt Oct 31): a second dimension joined with
// "and" ("by region and stage") and a breakdown by period ("by quarter"), which answered the all-time total.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { loadRegistry } from '@/registry/load';
import { ask } from '@/semantic/answer';

const reg = loadRegistry();
let database: Database;

beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

describe('a second breakdown joined with "and" is kept', () => {
  it.each([
    ['open pipeline by region and stage', ['region', 'stage']],
    ['how many open deals by stage and region', ['stage', 'region']],
    ['open pipeline by stage and owner', ['stage', 'owner']],
    ['open pipeline by region, stage', ['region', 'stage']],
    ['open pipeline by region and by stage', ['region', 'stage']],
  ])('%s', async (phrase, groupBy) => {
    const r = await ask(database, reg, 'u_analyst', phrase);
    expect(r.kind === 'answer' && r.filters.groupBy).toEqual(groupBy);
  });

  it('coverage by region and stage is asked about, not answered by region alone', async () => {
    const r = await ask(database, reg, 'u_analyst', 'pipeline coverage by region and stage this quarter');
    expect(r.kind).toBe('clarify');
  });

  it('"and" before a filter is not a breakdown', async () => {
    const r = await ask(database, reg, 'u_analyst', 'open pipeline by region and east');
    expect(r.kind === 'answer' && r.filters.groupBy).toEqual(['region']);
  });
});

describe('a breakdown by period is asked about', () => {
  it.each(['open pipeline by quarter', 'open pipeline per quarter', 'how many open deals by month', 'pipeline coverage each quarter'])('%s', async (phrase) => {
    const r = await ask(database, reg, 'u_analyst', phrase);
    expect(r).toMatchObject({ kind: 'clarify', question: expect.stringContaining('one quarter at a time') });
  });

  it('a named quarter is still a period, not a breakdown', async () => {
    const r = await ask(database, reg, 'u_analyst', 'pipeline coverage this quarter');
    expect(r.kind).toBe('answer');
  });
});
