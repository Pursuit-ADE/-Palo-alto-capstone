// Scoring for the golden phrasing set over repeated runs (scripts/eval-golden.ts). Claude isn't deterministic, so one
// pass proves little; pass^k (tau-bench) is the chance that all k runs of a phrase are right, which is what "same
// question, same answer" means. Pure functions, so the arithmetic is tested without calling a model.
import type { Registry } from '../registry/load';
import { validateIntent } from './compile';
import type { NormalizeResult } from './normalize';

export type GoldenExpect = { clarify: boolean } | { unsupported: boolean } | Record<string, unknown>;

/** Whether one reply matches a golden case. A clarifying question also counts for an "unsupported" case. */
export function goldenMatch(expect: GoldenExpect, r: NormalizeResult, registry: Registry): boolean {
  if ('clarify' in expect) return r.kind === 'clarify';
  if ('unsupported' in expect) return r.kind === 'unsupported' || r.kind === 'clarify';
  if (r.kind !== 'intent') return false;
  try {
    return JSON.stringify(validateIntent(r.intent, registry).intent) === JSON.stringify(validateIntent(expect, registry).intent);
  } catch {
    return false;
  }
}

/** pass^k for one phrase from n runs with c correct: the chance that k runs drawn from them are all correct. */
export function passHatK(n: number, c: number, k: number): number {
  if (k < 1 || k > n) throw new RangeError(`k must be between 1 and ${n}`);
  let p = 1;
  for (let i = 0; i < k; i++) p *= (c - i) / (n - i);
  return Math.max(0, p);
}

export interface PhraseRuns {
  phrase: string;
  /** Whether each run matched the golden case. */
  correct: boolean[];
  /** A canonical form of each run's reply, to tell a stable answer from one that changes between runs. */
  replies: string[];
}

export interface GoldenSummary {
  runs: number;
  phrases: number;
  /** Share of all runs that matched (pass^1). */
  passRate: number;
  /** pass^k averaged over phrases, for each k from 1 to the number of runs. */
  passHatK: Record<number, number>;
  /** Phrases whose reply was the same on every run, whether or not it was right. */
  stable: number;
  /** Phrases that were wrong on at least one run, with how many runs were right. */
  failing: { phrase: string; correct: number }[];
}

export function summarize(results: PhraseRuns[]): GoldenSummary {
  const runs = results[0]?.correct.length ?? 0;
  if (!runs || results.some((r) => r.correct.length !== runs || r.replies.length !== runs)) throw new RangeError('every phrase needs the same number of runs');
  const right = results.map((r) => r.correct.filter(Boolean).length);
  const passHatKByK: Record<number, number> = {};
  for (let k = 1; k <= runs; k++) passHatKByK[k] = right.reduce((sum, c) => sum + passHatK(runs, c, k), 0) / results.length;
  return {
    runs,
    phrases: results.length,
    passRate: right.reduce((a, b) => a + b, 0) / (runs * results.length),
    passHatK: passHatKByK,
    stable: results.filter((r) => new Set(r.replies).size === 1).length,
    failing: results.flatMap((r, i) => (right[i]! < runs ? [{ phrase: r.phrase, correct: right[i]! }] : [])),
  };
}
