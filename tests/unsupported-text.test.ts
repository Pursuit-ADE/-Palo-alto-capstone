// A question about no governed metric gets a reply that says what can be asked, with two questions that work for
// every role (UX row 9, BH 5, Nov 2: the old sentence told a manager nothing about what to try).
import { describe, expect, it } from 'vitest';
import { AS_OF_DATE } from '@/db/seed';
import { loadRegistry } from '@/registry/load';
import { normalize, UNSUPPORTED_TEXT } from '@/semantic/normalize';
import { toResult, UNSUPPORTED_TEXT as MODEL_TEXT } from '@/semantic/model';

const reg = loadRegistry();

describe('the reply to a question about no metric', () => {
  it.each(['what can you do?', 'asdf', 'what was our won revenue last quarter?', 'which rep has no open deals?'])('"%s" lists the metrics and two examples', (q) => {
    const r = normalize(q, reg, AS_OF_DATE);
    expect(r).toEqual({ kind: 'unsupported', message: UNSUPPORTED_TEXT });
    for (const m of reg.metrics.values()) expect(UNSUPPORTED_TEXT.toLowerCase()).toContain(m.name.toLowerCase());
  });

  it('is the same sentence on the AI model path', () => {
    expect(MODEL_TEXT).toBe(UNSUPPORTED_TEXT);
    const out = { kind: 'unsupported', message: 'planted', metric: null, period: null, regions: null, stages: null, groupBy: null } as unknown as Parameters<typeof toResult>[0];
    expect(toResult(out)).toEqual({ kind: 'unsupported', message: UNSUPPORTED_TEXT });
  });

  it('suggests questions that are answered', () => {
    for (const q of [...UNSUPPORTED_TEXT.matchAll(/"([^"]+)"/g)].map((m) => m[1]!)) expect(normalize(q, reg, AS_OF_DATE).kind).toBe('intent');
  });
});
