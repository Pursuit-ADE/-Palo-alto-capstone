// The coverage target is read from the registry: 3x is on target, and the 2x line only changes the color.
import { describe, expect, it } from 'vitest';
import { coverageStanding } from '@/semantic/coverage-target';
import { narrate } from '@/semantic/narrative';

const spec = { target: 3, caution: 2 };

describe('coverage target', () => {
  it('says on target at 3x and above, and off target below, with the color in words', () => {
    expect(coverageStanding(3, spec)).toEqual({ standing: 'on target', words: 'at or above 3.00x', tone: 'green' });
    expect(coverageStanding(3.4, spec).tone).toBe('green');
    expect(coverageStanding(2, spec)).toEqual({ standing: 'off target', words: 'between 2.00x and 3.00x', tone: 'amber' });
    expect(coverageStanding(2.5, spec).tone).toBe('amber');
    expect(coverageStanding(1.99, spec)).toEqual({ standing: 'off target', words: 'below 2.00x', tone: 'red' });
  });

  it('puts the standing in the sentence when the metric carries a target', () => {
    const text = narrate(
      { name: 'Pipeline coverage', unit: 'ratio', target: 3, caution: 2 },
      [{ value: 0.52, numerator: 174325, denominator: 338000 }],
      [],
      'FY27-Q1',
    );
    expect(text).toContain('0.52x, off target, below 2.00x');
  });

  it('leaves a ratio with no target unlabeled', () => {
    const text = narrate({ name: 'Pipeline coverage', unit: 'ratio' }, [{ value: 0.52, numerator: 1, denominator: 2 }], [], 'FY27-Q1');
    expect(text).not.toContain('target');
  });
});
