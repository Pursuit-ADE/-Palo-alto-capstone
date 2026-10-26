// Coverage target from the metric registry. Alex confirmed 3x for this demo on the midpoint check call.
// The 2x color boundary is the plan's split (red below it, amber up to the target, green at or above).
// Words travel with the color so the standing is readable without it.

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

/** The receipt's Target row: the standing and the band, in one line. */
export function coverageReceipt(value: number, spec: CoverageTarget): string {
  const standing = coverageStanding(value, spec);
  return `${standing.standing}, ${standing.words}.`;
}

export function coverageSpec(metric: { target?: number | null; caution?: number | null }): CoverageTarget | null {
  if (metric.target == null || metric.caution == null || metric.caution >= metric.target) return null;
  return { target: metric.target, caution: metric.caution };
}

/** Headroom past a target line. A marker at the end of a clipped, rounded track is hidden. The ratio charts use this same pad. */
export const COVERAGE_AXIS_PAD = 0.25;

/** Scale for the Numbers-view coverage bars: at least the old 1.25 floor, and always past the target line. */
export function coverageTrackMax(line: number, values: readonly number[]): number {
  return Math.max(line + COVERAGE_AXIS_PAD, 1.25, ...values);
}
