// A breakdown's sentence names every row that ties for highest or lowest, and says when all rows are equal, instead
// of picking one by row order (bug hunt, Oct 31: "Engaging is highest at $31,784, and Prospecting is lowest at $31,784").
import { describe, expect, it } from 'vitest';
import { narrate } from '@/semantic/narrative';

const pipeline = { name: 'Open pipeline', unit: 'currency' };

describe('ties in a breakdown (PRD A6, bug hunt Oct 31)', () => {
  it('says every row is equal when they all tie', () => {
    const s = narrate(pipeline, [{ stage: 'Engaging', value: 31784 }, { stage: 'Prospecting', value: 31784 }], ['stage'], 'FY27-Q2');
    expect(s).toBe('Open pipeline for FY27-Q2 by stage: both stages are equal at $31,784.');
  });

  it('says "all 3" when three rows tie (review, Oct 31)', () => {
    const rows = [{ stage: 'A', value: 5 }, { stage: 'B', value: 5 }, { stage: 'C', value: 5 }];
    expect(narrate(pipeline, rows, ['stage'])).toBe('Open pipeline by stage: all 3 stages are equal at $5.');
  });

  it('names every row tied for highest or lowest', () => {
    const rows = [
      { region: 'west', value: 500 },
      { region: 'east', value: 500 },
      { region: 'central', value: 100 },
    ];
    expect(narrate(pipeline, rows, ['region'])).toBe('Open pipeline by region: West and East are highest at $500 and Central is lowest at $100 (3 regions).');
    const low = [{ region: 'west', value: 900 }, { region: 'east', value: 100 }, { region: 'central', value: 100 }];
    expect(narrate(pipeline, low, ['region'])).toBe('Open pipeline by region: West is highest at $900 and East and Central are lowest at $100 (3 regions).');
  });

  it('names every combination tied for the largest in a two-way breakdown', () => {
    const rows = [
      { region: 'east', stage: 'Engaging', value: 50 },
      { region: 'west', stage: 'Engaging', value: 50 },
      { region: 'west', stage: 'Prospecting', value: 10 },
    ];
    expect(narrate(pipeline, rows, ['region', 'stage'])).toBe(
      'Open pipeline by region and stage: 3 combinations. The largest are East and Engaging, and West and Engaging, at $50.',
    );
  });

  it('counts only the rows that have a value as equal (review, Oct 31)', () => {
    const coverage = { name: 'Pipeline coverage', unit: 'ratio' };
    const rows = [{ region: 'west', value: 1.5 }, { region: 'east', value: 1.5 }, { region: 'central', value: null }];
    expect(narrate(coverage, rows, ['region'])).toMatch(/^Pipeline coverage by region: both regions are equal at 1\.50x/);
  });

  it('treats values that show the same as a tie (review, Oct 31)', () => {
    const rows = [{ stage: 'Engaging', value: 31784.4 }, { stage: 'Prospecting', value: 31783.6 }];
    expect(narrate(pipeline, rows, ['stage'])).toBe('Open pipeline by stage: both stages are equal at $31,784.');
    const three = [{ stage: 'A', value: 50.4 }, { stage: 'B', value: 49.6 }, { stage: 'C', value: 10 }];
    expect(narrate(pipeline, three, ['stage'])).toBe('Open pipeline by stage: A and B are highest at $50 and C is lowest at $10 (3 stages).');
  });

  it('says "All 3 are" for the standing when there are more than two rows, since every row between shares the band (reviews, Oct 31)', () => {
    const coverage = { name: 'Pipeline coverage', unit: 'ratio', target: 3, caution: 2 };
    const rows = [{ region: 'west', value: 1.0 }, { region: 'east', value: 1.0 }, { region: 'central', value: 0.8 }];
    const s = narrate(coverage, rows, ['region']);
    expect(s).not.toContain('Both are');
    expect(s).toContain('All 3 are off target');
  });

  it('says "1 combination", not "1 combinations" (review, Oct 31)', () => {
    const s = narrate(pipeline, [{ region: 'east', stage: 'Engaging', value: 50 }], ['region', 'stage']);
    expect(s).toBe('Open pipeline by region and stage: 1 combination. The largest is East and Engaging at $50.');
  });

  it('keeps the sentence as it was without ties', () => {
    const rows = [{ region: 'west', value: 900 }, { region: 'east', value: 100 }];
    expect(narrate(pipeline, rows, ['region'])).toBe('Open pipeline by region: West is highest at $900 and East is lowest at $100 (2 regions).');
  });
});
