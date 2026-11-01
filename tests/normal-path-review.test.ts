// Ordinary questions the first round of normal-path fixes got wrong, from an independent review (Oct 31): a bare
// "who" or a named rep read as a ranking, "by quarter end" read as a breakdown, "his whole team" widened to the company,
// a non-metric question answered as a follow-up, and a model-resolved rep refused as an unknown name.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { loadRegistry } from '@/registry/load';
import type { Intent } from '@/registry/types';
import { ask } from '@/semantic/answer';
import { followUpRule, type IntentModel } from '@/semantic/model';

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

describe('not a ranking', () => {
  it.each([
    [MELVIN, "What's the coverage this quarter for my top rep Darcel Schlecht?", '0.70x'],
    [MELVIN, "What's pipeline coverage this quarter for the reps who report to me?", '0.78x'],
    [MELVIN, 'What is coverage this quarter for my team, who are all in Central?', '0.78x'],
    ['u_darcel_schlecht', "What's my coverage this quarter? Am I the top rep?", '0.70x'],
  ])('%s: %s', async (user, phrase, figure) => {
    const r = await ask(database, reg, user, phrase);
    expect(r.kind).toBe('answer');
    expect(r.kind === 'answer' && r.narrative).toContain(figure);
  });

  it.each(['Open pipeline for reps who sell GTX Pro', 'who should I call about open pipeline?'])('no breakdown: %s', async (phrase) => {
    const r = await ask(database, reg, MELVIN, phrase);
    expect(r.kind === 'answer' && r.filters.groupBy).toEqual([]);
  });
});

describe('not a breakdown by period', () => {
  it.each(['open pipeline per quarter for Q1', "What's the open pipeline closing by quarter end?", 'open pipeline by quarter end'])('%s', async (phrase) => {
    expect((await ask(database, reg, MELVIN, phrase)).kind).toBe('answer');
  });
});

describe('"whole team" only clears the rep when it is the asker\'s own team', () => {
  it('"and his whole team?" for the analyst does not become the whole company', async () => {
    const r = await chain('u_analyst', 'open pipeline for Darcel Schlecht', 'and his whole team?');
    expect(r.kind === 'answer' && r.narrative).not.toContain('$4,966,215');
  });

  it('"and my whole team?" for a manager drops the rep', async () => {
    const r = await chain(MELVIN, 'open pipeline for Darcel Schlecht', 'and my whole team?');
    expect(r.kind === 'answer' && r.narrative).toContain('$1,312,792');
  });
});

describe('a question that is not about the metric does not continue it', () => {
  it.each(["Who is Darcel Schlecht's manager?", 'Which deals for Acme Corporation are stuck?'])('%s', async (phrase) => {
    expect((await chain(MELVIN, 'open pipeline', phrase)).kind).toBe('unsupported');
  });

  it('a bare name still continues the question', async () => {
    const r = await chain(MELVIN, 'open pipeline', 'Niesha Huffines');
    expect(r.kind === 'answer' && r.filters.people).toEqual(['Niesha Huffines']);
  });
});

describe('a rep the model resolved is not an unknown name', () => {
  it("What's my rep Darcel's open pipeline? (the model resolves Darcel Schlecht)", async () => {
    const model: IntentModel = {
      name: 'stand-in',
      propose: async (question, registry, _asOf, previous) =>
        followUpRule({ kind: 'intent', intent: { metric: 'open_pipeline', filters: { people: ['Darcel Schlecht'] }, groupBy: [] } }, question, registry, previous),
    };
    const r = await ask(database, reg, MELVIN, "What's my rep Darcel's open pipeline?", { model });
    expect(r.kind === 'answer' && r.narrative).toContain('$656,040');
  });
});

describe('the comparison message names the real limit', () => {
  it('two reps plus two breakdowns asks which breakdown, not that reps cannot be shown', async () => {
    const r = await ask(database, reg, MELVIN, 'Darcel Schlecht vs Niesha Huffines open pipeline by stage and region');
    expect(r).toMatchObject({ kind: 'clarify', question: expect.stringContaining('one other breakdown') });
  });
});
