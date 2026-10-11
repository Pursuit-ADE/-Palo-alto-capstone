import { describe, expect, it } from 'vitest';
import golden from '../registry/golden/phrases.json';
import { loadRegistry } from '@/registry/load';
import { normalize } from '@/semantic/normalize';
import { validateIntent } from '@/semantic/compile';

const reg = loadRegistry();

describe('golden phrasing set', () => {
  it('has at least 5 phrasings for every metric', () => {
    for (const id of reg.metrics.keys()) {
      const n = golden.cases.filter((c) => 'metric' in c.expect && c.expect.metric === id).length;
      expect(n, id).toBeGreaterThanOrEqual(5);
    }
  });

  for (const c of golden.cases) {
    it(`"${c.phrase}"`, () => {
      const r = normalize(c.phrase, reg, golden.asOfDate);
      if ('clarify' in c.expect) return expect(r.kind).toBe('clarify');
      if ('unsupported' in c.expect) return expect(r.kind).toBe('unsupported');
      expect(r.kind).toBe('intent');
      if (r.kind !== 'intent') return;
      expect(r.intent).toEqual(c.expect);
      expect(() => validateIntent(r.intent, reg)).not.toThrow();
    });
  }
});
