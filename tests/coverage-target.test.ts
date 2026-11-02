// The coverage target is read from the registry: 3x is on target, and the 2x line only changes the color.
import { describe, expect, it } from 'vitest';
import { openDatabase } from '@/db/client';
import { loadRegistry } from '@/registry/load';
import { answerIntent, type Answer } from '@/semantic/answer';
import { coverageReceipt, coverageStanding, coverageTrackMax } from '@/semantic/coverage-target';
import { narrate } from '@/semantic/narrative';
import { answerCharts } from '../app/chart-data';

const spec = { target: 3, caution: 2 };

describe('coverage target', () => {
  it('says on target at 3x and above, and off target below, with the color in words', () => {
    expect(coverageStanding(3, spec)).toEqual({ standing: 'on target', words: 'at or above 3.00x. The target is 3.00x', tone: 'green' });
    expect(coverageStanding(3.4, spec).tone).toBe('green');
    expect(coverageStanding(2, spec)).toEqual({ standing: 'off target', words: 'between 2.00x and 3.00x. The target is 3.00x', tone: 'amber' });
    expect(coverageStanding(2.5, spec)).toEqual({ standing: 'off target', words: 'between 2.00x and 3.00x. The target is 3.00x', tone: 'amber' });
    expect(coverageStanding(1.99, spec)).toEqual({ standing: 'off target', words: 'below 2.00x. The target is 3.00x', tone: 'red' });
  });

  it('puts the standing in the sentence when the metric carries a target', () => {
    const text = narrate(
      { name: 'Pipeline coverage', unit: 'ratio', target: 3, caution: 2 },
      [{ value: 0.52, numerator: 174325, denominator: 338000 }],
      [],
      'FY27-Q1',
    );
    expect(text).toContain('0.52x, off target, below 2.00x. The target is 3.00x.');
    expect(text).toContain('That is $174,325 of open pipeline closing in the quarter against $338,000 of quota.');
  });

  it('names the standing of the lowest figure as well as the highest', () => {
    const text = narrate(
      { name: 'Pipeline coverage', unit: 'ratio', target: 3, caution: 2 },
      [{ region: 'west', value: 3.1 }, { region: 'east', value: 0.52 }],
      ['region'],
    );
    expect(text).toBe(
      'Pipeline coverage by region: West is highest at 3.10x and East is lowest at 0.52x (2 regions). West is on target (at or above 3.00x) and East is off target (below 2.00x); the target is 3.00x.',
    );
  });

  it('states a shared standing once when both ends are in the same band', () => {
    const text = narrate(
      { name: 'Pipeline coverage', unit: 'ratio', target: 3, caution: 2 },
      [{ region: 'central', value: 0.76 }, { region: 'east', value: 0.43 }, { region: 'west', value: 0.5 }],
      ['region'],
      'FY27-Q1',
    );
    expect(text).toBe(
      'Pipeline coverage for FY27-Q1 by region: Central is highest at 0.76x and East is lowest at 0.43x (3 regions). All 3 are off target (below 2.00x; the target is 3.00x).',
    );
  });

  it('puts the receipt Target row and the Against target chart on the same 3x line', () => {
    expect(coverageReceipt(0.52, spec)).toBe('Off target, below 2.00x. The target is 3.00x.');
    const answer = {
      metric: { id: 'pipeline_coverage', name: 'Pipeline coverage', unit: 'ratio', target: 3, caution: 2 },
      filters: { groupBy: [], period: { label: 'FY27-Q1' } },
      rows: [{ numerator: 174325, denominator: 338000, value: 0.52 }],
      narrative: 'n',
      ownerNames: null,
    } as unknown as Answer;
    const bullet = answerCharts(answer, 'x')!.find((c) => c.tab === 'Against target');
    expect(bullet).toMatchObject({ prefer: 'bullet', series: ['Coverage', '3.00x target'] });
  });

  it('carries the registry target and color boundary onto the answer', async () => {
    const db = await openDatabase();
    try {
      const a = await answerIntent(db, loadRegistry(), 'u_analyst', { metric: 'pipeline_coverage', filters: { period: 'FY27-Q1' }, groupBy: [] });
      expect(a.metric.target).toBe(3);
      expect(a.metric.caution).toBe(2);
    } finally {
      await db.close();
    }
  });

  it('keeps the target line inside the bar track when every region is below it', () => {
    const regions = [0.76, 0.43, 0.5];
    const max = coverageTrackMax(3, regions);
    expect(max).toBeGreaterThan(3);
    expect((3 / max) * 100).toBeLessThan(100);
    expect(coverageTrackMax(3, [4.2])).toBe(4.2);
    expect(coverageTrackMax(1, [0.52])).toBe(1.25);
  });

  it('leaves a ratio with no target unlabeled', () => {
    const text = narrate({ name: 'Pipeline coverage', unit: 'ratio' }, [{ value: 0.52, numerator: 1, denominator: 2 }], [], 'FY27-Q1');
    expect(text).not.toContain('target');
  });
});
