// "in <name>" and month names were dropped without a word, so the all-time total was answered (QA cycle 5, Oct 31:
// "What is open pipeline in Zephyra?"; bug hunt: "in October"). A name after "in" is checked like one after "for",
// and a month is a period the data doesn't have.
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

describe('an unknown name or a month after "in" is asked about (PRD A2)', () => {
  it('"in Zephyra" asks back without repeating the name', async () => {
    const r = await ask(database, reg, 'u_analyst', 'What is open pipeline in Zephyra?');
    expect(r).toMatchObject({ kind: 'clarify', question: expect.stringContaining("I don't know that name") });
    expect(JSON.stringify(r)).not.toContain('Zephyra');
  });

  it.each(['What is open pipeline in October?', 'open pipeline for September', 'how many open deals in Jan'])('%s asks which quarter', async (phrase) => {
    const r = await ask(database, reg, 'u_analyst', phrase);
    expect(r).toMatchObject({ kind: 'clarify', question: expect.stringContaining('FY27-Q1 and FY27-Q2') });
  });

  // A weekday is a period the data doesn't have either, so it gets the same question, not the all-time total (review,
  // Nov 1: "open pipeline on Monday" answered $4,966,215 once weekdays stopped being checked as names).
  it.each(['open pipeline on Monday', 'open pipeline for Monday', 'What was open pipeline on Monday?', "Friday's open pipeline"])('%s asks which quarter', async (phrase) => {
    const r = await ask(database, reg, 'u_analyst', phrase);
    expect(r).toMatchObject({ kind: 'clarify', question: expect.stringContaining('FY27-Q1 and FY27-Q2') });
    expect(JSON.stringify(r)).not.toMatch(/monday|friday/i);
  });

  it('"for friday\'s call" names a meeting, not a period, so it answers as before', async () => {
    const r = await ask(database, reg, 'u_analyst', "pipeline for friday's call");
    expect(r.kind === 'answer' && r.narrative).toContain('$4,966,215');
  });

  it('"in EMEA" keeps its own region message', async () => {
    const r = await ask(database, reg, 'u_analyst', 'open pipeline in EMEA');
    expect(r).toMatchObject({ kind: 'clarify', question: expect.stringContaining("isn't a region here") });
  });
});

describe('names after "in" that are in the data keep working', () => {
  it.each([
    ['open pipeline in GTK 500', '$401,520'],
    ['open pipeline in Acme Corporation', '$23,334'],
    ['open pipeline in East', '$1,069,586'],
    ['open pipeline in Q2', '$3,002,306'],
    ['open pipeline in FY27-Q1', '$1,963,909'],
    ['open pipeline in Prospecting', '$1,073,986'],
    ['open pipeline in the Retail sector', '$274,227'],
    ['May I see the open pipeline?', '$4,966,215'],
    // A currency is not a name (review, Oct 31).
    ['open pipeline in USD', '$4,966,215'],
    ['open pipeline in US dollars', '$4,966,215'],
  ])('%s', async (phrase, figure) => {
    const r = await ask(database, reg, 'u_analyst', phrase);
    expect(r.kind === 'answer' && r.narrative).toContain(figure);
  });
});
