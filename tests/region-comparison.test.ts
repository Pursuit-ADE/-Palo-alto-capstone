// "higher in East than West" wants each region, not one combined total (phrasing hunt, Oct 31; PRD A2).
import { describe, expect, it } from 'vitest';
import { loadRegistry } from '@/registry/load';
import { normalize } from '@/semantic/normalize';

const reg = loadRegistry();
const read = (phrase: string) => normalize(phrase, reg, '2027-03-31');

describe('regions compared with the region before "than"', () => {
  it.each(['why is open pipeline higher in East than West?', 'is open pipeline lower in the west than central?', 'open pipeline is higher in east than in west'])(
    '"%s" is broken down by region',
    (phrase) => {
      expect(read(phrase)).toMatchObject({ kind: 'intent', intent: { groupBy: ['region'] } });
    },
  );

  it('a deal-size comparison is still a deal-size filter', () => {
    expect(read('open opportunities larger than $50,000')).toMatchObject({ kind: 'intent', intent: { filters: { amount: { min: 50000 } }, groupBy: [] } });
  });
});
