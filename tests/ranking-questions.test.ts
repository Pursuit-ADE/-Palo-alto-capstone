// Ranking questions ("which rep has the lowest coverage?", "who has the most open pipeline?") are answered with the
// breakdown they rank by, or asked about when the metric has no such breakdown. Never the scope's total (PRD A2,
// bug hunt Oct 31: "Which rep has the lowest coverage this quarter?" answered the team's 0.78x).
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

const MELVIN = 'u_mgr_melvin_marxen';

describe('a ranking question gets the breakdown it ranks by (PRD A2, bug hunt Oct 31)', () => {
  it.each(['Which rep has the lowest coverage this quarter?', "what's the lowest coverage rep this quarter", 'Who has the best pipeline coverage this quarter?'])(
    'coverage by rep is asked about, not totalled: %s',
    async (phrase) => {
      const r = await ask(database, reg, MELVIN, phrase);
      expect(r).toMatchObject({ kind: 'clarify', question: expect.stringContaining("can't rank reps by it") });
      expect(r.kind === 'clarify' && r.question).toContain('by region');
      expect(JSON.stringify(r)).not.toMatch(/\d\.\d\dx/);
    },
  );

  it.each([
    ['Who has the most open pipeline?', 'Darcel Schlecht is highest'],
    ['top 3 reps by open pipeline', 'Darcel Schlecht is highest'],
    ['Which seller has the least open pipeline?', 'Niesha Huffines is lowest'],
  ])('open pipeline is broken down by owner: %s', async (phrase, words) => {
    const r = await ask(database, reg, MELVIN, phrase);
    expect(r.kind).toBe('answer');
    expect(r.kind === 'answer' && r.filters.groupBy).toEqual(['owner']);
    expect(r.kind === 'answer' && r.narrative).toContain(words);
  });

  it('a rep in scope with no open deals is said, so "lowest" is not read as the bottom of the team', async () => {
    const r = await ask(database, reg, MELVIN, 'Who has the least open pipeline?');
    expect(r.kind === 'answer' && r.rows).toHaveLength(5);
    expect(r.kind === 'answer' && r.narrative).toContain('1 rep in scope has no matching open deals and isn\'t listed.');
    const own = await ask(database, reg, 'u_darcel_schlecht', 'open pipeline by owner');
    expect(own.kind === 'answer' && own.narrative).not.toContain('no matching open deals');
  });

  it('no note about unlisted reps when nothing matched at all (review, Oct 31)', async () => {
    const r = await ask(database, reg, MELVIN, 'open pipeline by owner for deals over 10000000');
    expect(r.kind === 'answer' && r.narrative).toMatch(/^No data matched/);
    expect(r.kind === 'answer' && r.narrative).not.toContain("isn't listed");
    expect(r.kind === 'answer' && r.narrative).not.toContain("aren't listed");
  });

  it('coverage by region ranks regions', async () => {
    const r = await ask(database, reg, 'u_analyst', 'Which region has the lowest coverage this quarter?');
    expect(r.kind === 'answer' && r.filters.groupBy).toEqual(['region']);
    expect(r.kind === 'answer' && r.narrative).toContain('East is lowest at 0.43x');
  });

  it('a ranking follow-up keeps the metric and ranks it', async () => {
    const first = await ask(database, reg, MELVIN, 'open pipeline');
    const previous = first.kind === 'answer' ? first.intent : undefined;
    const r = await ask(database, reg, MELVIN, 'who has the most?', { previous });
    expect(r.kind === 'answer' && r.metric.id).toBe('open_pipeline');
    expect(r.kind === 'answer' && r.filters.groupBy).toEqual(['owner']);
  });

  it('which stage has the most open pipeline ranks stages', async () => {
    const r = await ask(database, reg, MELVIN, 'Which stage has the most open pipeline?');
    expect(r.kind === 'answer' && r.filters.groupBy).toEqual(['stage']);
  });
});

describe('questions that must not become rankings', () => {
  it.each([
    ['What is our open pipeline?', '$1,312,792'],
    ['how many open deals are in the pipeline', '511'],
    ['pipeline coverage this quarter', '0.78x'],
    ['open pipeline for deals larger than 50000', 'Open pipeline'],
  ])('%s', async (phrase, figure) => {
    const r = await ask(database, reg, MELVIN, phrase);
    expect(r.kind).toBe('answer');
    expect(r.kind === 'answer' && r.filters.groupBy).toEqual([]);
    expect(r.kind === 'answer' && r.narrative).toContain(figure);
  });

  it('a "who" follow-up without a superlative is not a ranking', async () => {
    const first = await ask(database, reg, MELVIN, 'open pipeline');
    const previous = first.kind === 'answer' ? first.intent : undefined;
    expect((await ask(database, reg, MELVIN, 'who are you?', { previous })).kind).toBe('unsupported');
  });

  it('a ranking with its own breakdown keeps that breakdown', async () => {
    const r = await ask(database, reg, MELVIN, 'Which rep has the most open pipeline by stage?');
    expect(r.kind === 'answer' && r.filters.groupBy).toEqual(['stage']);
  });
});
