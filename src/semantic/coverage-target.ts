// Coverage target from the metric registry. The number 3 is the confirmed target. The 2x color
// boundary is the plan's split (red below it, amber up to the target, green at or above). Words travel
// with the color so the standing is readable without it.

export type CoverageTarget = { target: number; caution: number };
export type CoverageTone = 'red' | 'amber' | 'green';

export function coverageStanding(value: number, spec: CoverageTarget): { standing: 'on target' | 'off target'; words: string; tone: CoverageTone } {
  const target = spec.target.toFixed(2);
  const caution = spec.caution.toFixed(2);
  // The band alone can be read as the rule. Name the target in the same words so 2.00x is not mistaken for it.
  const named = `The target is ${target}x`;
  if (value >= spec.target) return { standing: 'on target', words: `at or above ${target}x. ${named}`, tone: 'green' };
  if (value >= spec.caution) return { standing: 'off target', words: `between ${caution}x and ${target}x. ${named}`, tone: 'amber' };
  return { standing: 'off target', words: `below ${caution}x. ${named}`, tone: 'red' };
}

export function coverageSpec(metric: { target?: number | null; caution?: number | null }): CoverageTarget | null {
  if (metric.target == null || metric.caution == null || metric.caution >= metric.target) return null;
  return { target: metric.target, caution: metric.caution };
}
