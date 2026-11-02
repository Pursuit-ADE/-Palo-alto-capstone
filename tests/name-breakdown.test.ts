// "by account", "by product" and "by sector" are breakdowns no metric has. They get the breakdown reply and a way to
// filter instead, not "I don't know that account" (UX round 1, BH 2, Nov 2: the word "account" was read as a name).
import { describe, expect, it } from 'vitest';
import { AS_OF_DATE } from '@/db/seed';
import { loadRegistry } from '@/registry/load';
import { normalize } from '@/semantic/normalize';

const reg = loadRegistry();
const read = (q: string) => normalize(q, reg, AS_OF_DATE);
const asked = (q: string) => {
  const r = read(q);
  return r.kind === 'clarify' ? r.question : `(${r.kind})`;
};

describe('a breakdown by a kind of name', () => {
  it.each([
    ['open pipeline by account', 'account'],
    ['open pipeline by product', 'product'],
    ['open opportunities per customer', 'account'],
    ['open pipeline by sector', 'sector'],
    ['and by industry?', 'sector'],
  ])('"%s" says it can\'t be broken down by %s', (q, kind) => {
    const question = q.startsWith('and') ? (() => {
      const r = normalize(q, reg, AS_OF_DATE, { metric: 'open_pipeline', filters: {}, groupBy: [] });
      return r.kind === 'clarify' ? r.question : `(${r.kind})`;
    })() : asked(q);
    expect(question).toContain(`can't be broken down by ${kind}.`);
    expect(question).not.toContain("I don't know that");
  });

  it('offers a filter example from the data that is answered', () => {
    for (const q of ['open pipeline by account', 'open pipeline by product', 'open opportunities by account', 'open pipeline by sector']) {
      const example = /"([^"]+)"/.exec(asked(q))?.[1];
      expect(example, q).toBeDefined();
      expect(read(example!).kind, example).toBe('intent');
    }
  });

  it('on coverage, says quota is not split that way and offers no filter', () => {
    const q = asked('pipeline coverage by account this quarter');
    expect(q).toContain("Quota isn't split by account");
    expect(q).not.toContain('for example');
  });

  it('leaves a named account, product or sector filter alone', () => {
    expect(read('open pipeline for Acme Corporation').kind).toBe('intent');
    expect(read('open pipeline in the Retail sector by stage').kind).toBe('intent');
  });
});
