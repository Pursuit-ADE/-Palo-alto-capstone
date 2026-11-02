// How an answer read the question, in words (app/reading.ts): the phrases the provenance panel and Read as share.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { loadRegistry } from '@/registry/load';
import { answerIntent, ask, type Answer } from '@/semantic/answer';
import { readingParts } from '../app/reading';

const reg = loadRegistry();
let database: Database;
beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

async function answer(user: string, q: string): Promise<Answer> {
  const r = await ask(database, reg, user, q);
  if (r.kind !== 'answer') throw new Error(`expected an answer, got ${r.kind}`);
  return r;
}

describe('the reading of a question, in words (review, Nov 1)', () => {
  it('says "all regions" for the whole company, not the three names', async () => {
    expect(readingParts(await answer('u_analyst', 'open pipeline'))).toEqual(['any expected close date', 'all regions']);
  });

  it('names the regions when the reading is narrower than the company', async () => {
    expect(readingParts(await answer('u_ts_east', 'open pipeline'))).toEqual(['any expected close date', 'East region']);
    expect(readingParts(await answer('u_analyst', 'open pipeline in east and west'))).toContain('East and West regions');
  });

  it('calls the owner breakdown "by owner", as the answer above it does', async () => {
    expect(readingParts(await answer('u_mgr_melvin_marxen', 'open pipeline by owner'))).toContain('by owner');
    const twoWay = await answerIntent(database, reg, 'u_analyst', { metric: 'open_pipeline', filters: {}, groupBy: ['owner', 'stage'] });
    expect(readingParts(twoWay)).toContain('by owner and stage');
  });

  it('keeps the quarter, deal size, product and sector in a fixed order', async () => {
    const parts = readingParts(await answer('u_analyst', 'open opportunities over $5,000 for GTX Plus Basic in the retail sector next quarter'));
    expect(parts).toEqual(['FY27-Q2 (Nov 1, 2026 to Jan 31, 2027)', 'all regions', 'over $5,000', 'product GTX Plus Basic', 'sector retail']);
  });
});
