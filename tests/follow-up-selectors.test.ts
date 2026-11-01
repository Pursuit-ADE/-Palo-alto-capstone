// Follow-ups that change only a filter (PRD A5, bug hunt Oct 31): "for Darcel Schlecht" after a question keeps its
// metric instead of being refused as off-topic, and "and my whole team?" drops the rep the previous turn named.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { loadRegistry } from '@/registry/load';
import type { Intent } from '@/registry/types';
import { ask } from '@/semantic/answer';

const reg = loadRegistry();
let database: Database;

beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

const MELVIN = 'u_mgr_melvin_marxen';

async function chain(user: string, first: string, second: string) {
  const a = await ask(database, reg, user, first);
  const previous = a.kind === 'answer' ? (a.intent as Intent) : undefined;
  return ask(database, reg, user, second, { previous });
}

describe('a follow-up that only names a filter keeps the metric', () => {
  it('"for Darcel Schlecht" after a deal count', async () => {
    const r = await chain(MELVIN, 'how many open deals', 'for Darcel Schlecht');
    expect(r.kind === 'answer' && r.metric.id).toBe('open_opportunity_count');
    expect(r.kind === 'answer' && r.filters.people).toEqual(['Darcel Schlecht']);
  });

  it('"in the retail sector" after open pipeline', async () => {
    const r = await chain('u_analyst', 'open pipeline', 'in the retail sector');
    expect(r.kind === 'answer' && r.filters.sectors).toEqual(['retail']);
  });

  it('"for GTK 500" after open pipeline', async () => {
    const r = await chain('u_analyst', 'open pipeline', 'for GTK 500');
    expect(r.kind === 'answer' && r.filters.products).toEqual(['GTK 500']);
  });

  it('an unrelated question after an answer is still unsupported', async () => {
    expect((await chain(MELVIN, 'open pipeline', 'what is the weather')).kind).toBe('unsupported');
  });
});

describe('a follow-up about the asker\'s own team drops the rep', () => {
  it.each(['and my whole team?', 'what about my team?', 'and all my reps?'])('%s', async (phrase) => {
    const r = await chain(MELVIN, 'open pipeline for Darcel Schlecht', phrase);
    expect(r.kind === 'answer' && r.filters.people).toBeNull();
    expect(r.kind === 'answer' && r.narrative).toContain('$1,312,792');
  });

  it('a follow-up that changes something else keeps the rep', async () => {
    const r = await chain(MELVIN, 'open pipeline for Darcel Schlecht', 'by stage');
    expect(r.kind === 'answer' && r.filters.people).toEqual(['Darcel Schlecht']);
  });
});
