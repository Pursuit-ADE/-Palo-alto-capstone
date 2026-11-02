// An account whose name has a spaced "&" ("Gekko & Co") is read as that account, the only one of the 85 that was
// asked back about (optimization review, Nov 2). "for East & West" is still two regions.
import { describe, expect, it } from 'vitest';
import { AS_OF_DATE, catalog } from '@/db/seed';
import { loadRegistry } from '@/registry/load';
import { normalize } from '@/semantic/normalize';

const reg = loadRegistry();
const read = (q: string) => normalize(q, reg, AS_OF_DATE);

describe('a name with an ampersand', () => {
  it('"open pipeline for Gekko & Co" filters to that account', () => {
    expect(read('open pipeline for Gekko & Co')).toMatchObject({ kind: 'intent', intent: { filters: { accounts: ['Gekko & Co'] } } });
  });

  it('every account in the data is read by its name', () => {
    const asked = catalog().accounts.filter((a) => read(`open pipeline for ${a.name}`).kind !== 'intent').map((a) => a.name);
    expect(asked).toEqual([]);
  });

  it('only a name that continues with "&" counts, so "Gekko" alone is still unknown', () => {
    expect(read('open pipeline for Gekko').kind).toBe('clarify');
    expect(read('open pipeline for East & West')).toMatchObject({ kind: 'intent', intent: { filters: { regions: ['east', 'west'] } } });
  });
});
