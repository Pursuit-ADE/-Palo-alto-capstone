// Two reps or teams set against each other ("Darcel Schlecht vs Niesha Huffines") are shown one by one, or asked
// about, never added into one figure. Same rule as named regions (PR #51 review); found for people in the bug hunt,
// Oct 31: "open pipeline for Darcel Schlecht vs Niesha Huffines" answered their sum, $763,785.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { loadRegistry } from '@/registry/load';
import { ask } from '@/semantic/answer';
import { deterministicModel, followUpRule, type IntentModel } from '@/semantic/model';

const reg = loadRegistry();
let database: Database;

beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

const MELVIN = 'u_mgr_melvin_marxen';

describe('two named reps compared are shown rep by rep (PRD A2, bug hunt Oct 31)', () => {
  it.each([
    'open pipeline for Darcel Schlecht vs Niesha Huffines',
    'compare open pipeline for Darcel Schlecht and Niesha Huffines',
    'Why is the number of open deals for Darcel Schlecht higher than Niesha Huffines?',
    'is open pipeline for Darcel Schlecht bigger than for Niesha Huffines',
  ])('%s', async (phrase) => {
    const r = await ask(database, reg, MELVIN, phrase);
    expect(r.kind).toBe('answer');
    if (r.kind !== 'answer') return;
    expect(r.filters.groupBy).toEqual(['owner']);
    expect(r.filters.people).toEqual(['Darcel Schlecht', 'Niesha Huffines']);
    expect(r.rows).toHaveLength(2);
    expect(r.narrative).not.toContain('763,785');
  });

  it('coverage has no breakdown by rep, so it is asked about', async () => {
    const r = await ask(database, reg, MELVIN, 'pipeline coverage this quarter for Darcel Schlecht vs Niesha Huffines');
    expect(r).toMatchObject({ kind: 'clarify', question: expect.stringContaining("won't add them together") });
  });

  it('two teams compared are asked about, not summed', async () => {
    const r = await ask(database, reg, 'u_analyst', "open pipeline for Melvin Marxen's team vs Cara Losch's team");
    expect(r).toMatchObject({ kind: 'clarify', question: expect.stringContaining("won't add them together") });
  });

  it('a model that proposes the sum gets the same answer (the follow-up rule applies it, as for Claude)', async () => {
    const model: IntentModel = {
      name: 'summing',
      propose: async (question, registry, _asOf, previous) =>
        followUpRule({ kind: 'intent', intent: { metric: 'open_pipeline', filters: { people: ['Darcel Schlecht', 'Niesha Huffines'] }, groupBy: [] } }, question, registry, previous),
    };
    const r = await ask(database, reg, MELVIN, 'open pipeline for Darcel Schlecht vs Niesha Huffines', { model });
    expect(r.kind === 'answer' && r.filters.groupBy).toEqual(['owner']);
  });
});

describe('two reps named without a comparison keep their combined figure', () => {
  it.each([
    ['open pipeline for Darcel Schlecht and Niesha Huffines', '$763,785'],
    ['open pipeline for Darcel Schlecht', '$656,040'],
    // "more than" here is a deal size, not a comparison of the two reps (review, Oct 31).
    ['open pipeline for Darcel Schlecht and Niesha Huffines for deals more than 5000', 'Filtered to over $5,000'],
    ['how many open deals for Darcel Schlecht and Niesha Huffines with more than 5000 value', 'Filtered to over $5,000'],
  ])('%s', async (phrase, figure) => {
    const r = await ask(database, reg, MELVIN, phrase, { model: deterministicModel });
    expect(r.kind === 'answer' && r.filters.groupBy).toEqual([]);
    expect(r.kind === 'answer' && r.narrative).toContain(figure);
  });
});
