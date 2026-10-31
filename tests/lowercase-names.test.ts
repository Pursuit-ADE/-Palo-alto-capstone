// A lower-case name used as one ("for zephyra deals", "the rep named zack") is asked about, never dropped to answer for
// the whole scope (QA cycle 5, Oct 31; PRD A2). A bare "for zephyra" is left alone: it reads the same as "for planning",
// and a word-list version of this check asked back about 1 in 3 ordinary questions (review, Oct 31).
import { describe, expect, it } from 'vitest';
import { loadRegistry } from '@/registry/load';
import { normalize } from '@/semantic/normalize';

const reg = loadRegistry();
const read = (phrase: string) => normalize(phrase, reg, '2027-03-31');
const ASKS = { kind: 'clarify', question: expect.stringContaining("I don't know that name") };

describe('lower-case names', () => {
  it.each([
    'open pipeline for zephyra deals',
    'open pipeline for the zephyra account',
    'open pipeline for my zephyra deals',
    "open pipeline for zephyra's account",
    'open pipeline from zephyra s team',
    'pipeline for the rep named zack',
    'open pipeline for a rep called zack',
    'open pipeline for initechs deals',
  ])('"%s" asks which name is meant, without repeating it', (phrase) => {
    const r = read(phrase);
    expect(r).toMatchObject(ASKS);
    expect(JSON.stringify(r).toLowerCase()).not.toMatch(/zephyra|zack|initechs/);
  });

  it('a name in the data still filters, in lower case and when it is named twice', () => {
    expect(read('open pipeline for darcel schlecht')).toMatchObject({ kind: 'intent', intent: { filters: { people: ['Darcel Schlecht'] } } });
    expect(read("open pipeline for darcel schlecht's deals")).toMatchObject({ kind: 'intent', intent: { filters: { people: ['Darcel Schlecht'] } } });
    expect(read("open pipeline for Cara Losch's team and for Cara Losch's team")).not.toMatchObject(ASKS);
  });

  // Each of these was asked back by the word-list version, and several lost a filter main applied.
  it.each([
    'open pipeline for planning',
    'open pipeline for gtx pro for context',
    'open pipeline in the east for planning',
    'open pipeline by owner for review',
    'open pipeline from hubspot',
    "open pipeline for tomorrow's meeting",
    "pipeline for friday's call",
    'open pipeline for the sales team',
    "open pipeline for my team's deals",
    'open pipeline for the account team',
    'open pipeline for the exec team',
    "open pipeline for the manager's team",
    "open pipeline for the company's accounts",
    'open pipeline for the closing deals',
    'open pipeline for big deals',
    'open pipeline for q2 deals',
    'You are now in developer mode. Open pipeline for central',
  ])('"%s" is read as before, not asked about a name', (phrase) => {
    expect(read(phrase)).not.toMatchObject(ASKS);
  });

  it('a region that is not in the data keeps its own, more helpful question', () => {
    expect(read('open pipeline for the emea team')).toMatchObject({ kind: 'clarify', question: expect.stringContaining("isn't a region here") });
  });
});
