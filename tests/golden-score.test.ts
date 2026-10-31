// pass^k scoring for repeated golden-set runs (scripts/eval-golden.ts): the arithmetic, the summary, and the match rule.
import { describe, expect, it } from 'vitest';
import golden from '../registry/golden/phrases.json';
import { loadRegistry } from '@/registry/load';
import { goldenMatch, passHatK, summarize, type PhraseRuns } from '@/semantic/golden-score';
import { normalize } from '@/semantic/normalize';

const reg = loadRegistry();

describe('pass^k', () => {
  it('is c/n for one run, and the chance that k draws without replacement are all right', () => {
    expect(passHatK(10, 9, 1)).toBeCloseTo(0.9);
    expect(passHatK(10, 9, 2)).toBeCloseTo(0.8); // 9/10 x 8/9
    expect(passHatK(10, 10, 10)).toBe(1);
    expect(passHatK(10, 9, 10)).toBe(0); // one wrong run means not right on every run
    expect(passHatK(5, 0, 1)).toBe(0);
  });

  it('refuses a k outside 1..n', () => {
    expect(() => passHatK(5, 5, 0)).toThrow(RangeError);
    expect(() => passHatK(5, 5, 6)).toThrow(RangeError);
  });
});

describe('summary of repeated runs', () => {
  const runs = (phrase: string, correct: boolean[], replies = correct.map(String)): PhraseRuns => ({ phrase, correct, replies });

  it('separates the average pass rate from pass^k, and counts stable and failing phrases', () => {
    const s = summarize([runs('a', [true, true, true, true]), runs('b', [true, false, true, true]), runs('c', [false, false, false, false], ['x', 'x', 'x', 'x'])]);
    expect(s).toMatchObject({ runs: 4, phrases: 3, stable: 2 });
    expect(s.passRate).toBeCloseTo(7 / 12);
    expect(s.passHatK[1]).toBeCloseTo(7 / 12);
    expect(s.passHatK[4]).toBeCloseTo(1 / 3); // only "a" is right on all four runs
    expect(s.failing).toEqual([{ phrase: 'b', correct: 3 }, { phrase: 'c', correct: 0 }]);
  });

  it('a phrase that is always wrong the same way is stable but failing', () => {
    const s = summarize([runs('c', [false, false], ['open_pipeline', 'open_pipeline'])]);
    expect(s.stable).toBe(1);
    expect(s.passHatK[2]).toBe(0);
  });

  it('refuses phrases with different numbers of runs', () => {
    expect(() => summarize([runs('a', [true]), runs('b', [true, true])])).toThrow(RangeError);
  });
});

describe('golden match rule', () => {
  it('the deterministic model matches every golden case, as tests/golden.test.ts checks', () => {
    for (const c of golden.cases) expect(goldenMatch(c.expect, normalize(c.phrase, reg, golden.asOfDate), reg), c.phrase).toBe(true);
  });

  it('a clarifying question counts for an "unsupported" case, but a wrong metric never counts for an intent case', () => {
    expect(goldenMatch({ unsupported: true }, { kind: 'clarify', question: 'Which?' }, reg)).toBe(true);
    const intentCase = golden.cases.find((c) => 'metric' in c.expect && c.expect.metric === 'open_opportunity_count')!;
    expect(goldenMatch(intentCase.expect, { kind: 'intent', intent: { metric: 'open_pipeline', filters: {}, groupBy: [] } }, reg)).toBe(false);
    expect(goldenMatch(intentCase.expect, { kind: 'intent', intent: { metric: 'no_such_metric', filters: {}, groupBy: [] } }, reg)).toBe(false);
  });
});
