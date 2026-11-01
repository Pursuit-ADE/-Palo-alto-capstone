// Unknown names on the normal answer path (PRD A2): a name that is not in the data is asked about, never dropped,
// and the question never repeats it (evaluator B-03). Found in the bug hunt on Oct 31: "What is Jordan's open
// pipeline?" as a manager answered for his whole team.
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

describe('an unknown possessive name is asked about (PRD A2, bug hunt Oct 31)', () => {
  it.each([
    "What is Jordan's open pipeline?",
    "What is JORDAN'S open pipeline?",
    'What is Priya’s open pipeline?',
    "What is Jordan Smith's open pipeline?",
  ])('%s', async (phrase) => {
    const r = await ask(database, reg, MELVIN, phrase);
    expect(r).toMatchObject({ kind: 'clarify', question: expect.stringContaining("I don't know that name") });
    expect(JSON.stringify(r).toLowerCase()).not.toMatch(/jordan|priya|smith/);
  });

  it('on a follow-up too', async () => {
    const first = await ask(database, reg, MELVIN, 'open pipeline');
    const previous = first.kind === 'answer' ? (first.intent as Intent) : undefined;
    const r = await ask(database, reg, MELVIN, "and Jordan's?", { previous });
    expect(r).toMatchObject({ kind: 'clarify' });
  });

  it('a name after "for" is asked about without repeating it (evaluator B-03)', async () => {
    const r = await ask(database, reg, MELVIN, 'open pipeline for Jordan');
    expect(r).toMatchObject({ kind: 'clarify', question: expect.stringContaining("I don't know that name") });
    expect(JSON.stringify(r)).not.toContain('Jordan');
  });
});

describe('a known first name asks for the full name, not "I don\'t know that name" (review, Oct 31)', () => {
  it.each([
    ['u_darcel_schlecht', "Darcel's open pipeline"],
    [MELVIN, "Melvin's team's open pipeline"],
    [MELVIN, "What is Niesha's open pipeline?"],
  ])('%s: %s', async (user, phrase) => {
    const r = await ask(database, reg, user, phrase);
    expect(r).toMatchObject({ kind: 'clarify', question: expect.stringContaining('full name') });
    expect(r.kind === 'clarify' && r.question).not.toContain("I don't know");
    expect(JSON.stringify(r)).not.toMatch(/darcel|melvin|niesha/i);
  });

  it("a month's possessive gets the period question, like \"in October\"", async () => {
    const r = await ask(database, reg, 'u_analyst', "October's open pipeline");
    expect(r).toMatchObject({ kind: 'clarify', question: expect.stringContaining('FY27-Q1 and FY27-Q2') });
  });
});

describe('everyday possessives are not names (review, Oct 31)', () => {
  it.each([
    "What is Palo Alto's open pipeline?",
    "What is the owner's pipeline?",
    "each owner's open pipeline",
    "What is the product's pipeline?",
    "What is the stage's pipeline?",
    "What is yesterday's pipeline?",
    "What's the CRM's open pipeline?",
    "what's the seller's coverage this quarter",
    "What is the client's open pipeline?",
    "What is the VP's open pipeline?",
    "Owner's open pipeline?",
  ])('%s', async (phrase) => {
    expect((await ask(database, reg, 'u_analyst', phrase)).kind).toBe('answer');
  });
});

describe('possessives that must keep working', () => {
  it.each([
    [MELVIN, "What is Niesha Huffines's open pipeline?", '$107,745'],
    [MELVIN, "what is niesha huffines's open pipeline?", '$107,745'],
    [MELVIN, "What is my team's open pipeline?", '$1,312,792'],
    [MELVIN, "What's our open pipeline?", '$1,312,792'],
    [MELVIN, "What is this quarter's pipeline coverage?", '0.78x'],
    ['u_ts_east', "How's my coverage this quarter?", '0.52x'],
    ['u_analyst', "What is the company's coverage this quarter?", '0.65x'],
    ['u_analyst', "What is West's coverage this quarter?", '0.75x'],
    ['u_analyst', "What is Cara Losch's team's coverage this quarter?", '0.52x'],
  ])('%s: %s', async (user, phrase, figure) => {
    const r = await ask(database, reg, user, phrase);
    expect(r.kind).toBe('answer');
    expect(r.kind === 'answer' && r.narrative).toContain(figure);
  });

  it('"West\'s" is a region, not an unknown name (bug hunt Oct 31)', async () => {
    const r = await ask(database, reg, 'u_analyst', "Why is East's coverage different from West's this quarter?");
    expect(r.kind).toBe('explanation');
    expect(JSON.stringify(r)).toContain('0.43x');
    expect(JSON.stringify(r)).toContain('0.75x');
  });
});
