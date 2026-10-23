import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AMOUNT_CLARIFY, MAX_AMOUNT, parseAmount } from '@/semantic/amount';

// Written independently of src/semantic/amount.ts, so a typo there can't make both sides agree.
const LOWER: [string, boolean][] = [
  ['over', false], ['above', false], ['more than', false], ['greater than', false], ['bigger than', false],
  ['larger than', false], ['exceeding', false], ['>', false], ['at least', true], ['no less than', true],
  ['not less than', true], ['>=', true], ['greater than or equal to', true], ['more than or equal to', true],
  ['equal to or greater than', true], ['no fewer than', true],
];
const UPPER: [string, boolean][] = [
  ['under', false], ['below', false], ['less than', false], ['smaller than', false], ['<', false],
  ['at most', true], ['up to', true], ['no more than', true], ['not more than', true], ['<=', true],
  ['less than or equal to', true], ['equal to or less than', true], ['no greater than', true], ['not greater than', true],
];
const SCALES: [string, bigint][] = [
  ['', 1n], ['k', 1_000n], [' thousand', 1_000n], ['m', 1_000_000n], ['M', 1_000_000n], [' million', 1_000_000n],
  ['mm', 1_000_000n], ['bn', 1_000_000_000n], ['b', 1_000_000_000n], ['B', 1_000_000_000n], [' billion', 1_000_000_000n],
];
const CONTEXT = ['', ' in the east', ' this quarter', ' for FY27-Q2', ' by stage', ' in West and Central'];

/** A filter the compiler can use: at least one bound, each finite and in range, and not backwards. */
function expectValidFilter({ min, max }: { min?: number; max?: number }) {
  expect(min != null || max != null).toBe(true);
  for (const v of [min, max]) if (v != null) expect(Number.isFinite(v) && v >= 0 && v <= MAX_AMOUNT).toBe(true);
  if (min != null && max != null) expect(min <= max).toBe(true);
}

const withCommas = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** A dollar amount written the ways people type it, with its exact value worked out in integer cents. */
const money = fc
  .record({
    scale: fc.constantFrom(...SCALES),
    whole: fc.integer({ min: 0, max: 999_999_999 }),
    fracLen: fc.integer({ min: 0, max: 2 }),
    frac: fc.integer({ min: 0, max: 99 }),
    commas: fc.boolean(),
    dollar: fc.boolean(),
  })
  .map(({ scale: [suffix, mult], whole, fracLen, frac, commas, dollar }) => {
    const int = mult > 1n ? whole % 1000 : whole;
    const f = fracLen === 0 ? 0 : frac % 10 ** fracLen;
    const digits = fracLen ? `.${f.toString().padStart(fracLen, '0')}` : '';
    const text = `${dollar ? '$' : ''}${commas ? withCommas(int) : int}${digits}${suffix}`;
    const cents = (BigInt(int) * 10n ** BigInt(fracLen) + BigInt(f)) * mult * 10n ** BigInt(2 - fracLen);
    const plainYear = !dollar && mult === 1n && fracLen === 0 && /^(19|20)\d\d$/.test(String(int));
    return { text, value: Number(cents) / 100, plainYear };
  });

describe('amount parser: the cases from the PR #42 review', () => {
  it.each([
    ['open pipeline under $5,000', { max: 5000, maxInclusive: false }],
    ['open pipeline over $1.5M', { min: 1_500_000, minInclusive: false }],
    ['open pipeline over 1,000,000', { min: 1_000_000, minInclusive: false }],
    ['open pipeline over $1M', { min: 1_000_000, minInclusive: false }],
    ['open pipeline for deals between 4000 and 5000', { min: 4000, max: 5000, minInclusive: true, maxInclusive: true }],
    ['open pipeline for deals between 4,000 and 5,000', { min: 4000, max: 5000, minInclusive: true, maxInclusive: true }],
  ])('%s', (phrase, amount) => {
    expect(parseAmount(phrase)).toEqual({ amount });
  });
});

describe('amount parser: bugs found Oct 23', () => {
  it.each([
    ['open pipeline less than or equal to 5000', { max: 5000, maxInclusive: true }],
    ['open pipeline greater than or equal to $1m', { min: 1_000_000, minInclusive: true }],
    ['open pipeline equal to or less than 2,500', { max: 2500, maxInclusive: true }],
    ['open pipeline over 1b', { min: 1_000_000_000, minInclusive: false }],
    ['open pipeline under $2.5B', { max: 2_500_000_000, maxInclusive: false }],
  ])('%s', (phrase, amount) => {
    expect(parseAmount(phrase)).toEqual({ amount });
  });

  it.each([
    'open pipeline over fifty thousand',
    'open pipeline under a hundred grand',
    'deals worth about twenty million',
    'open pipeline at least one hundred',
    'open pipeline for million dollar deals',
    'open pipeline over 5q',
  ])('asks instead of dropping the filter: "%s"', (phrase) => {
    expect(parseAmount(phrase)).toEqual({ clarify: AMOUNT_CLARIFY });
  });
});

describe('amount parser: examples', () => {
  it.each([
    ['open pipeline over a million', { min: 1_000_000, minInclusive: false }],
    ['deals bigger than one million', { min: 1_000_000, minInclusive: false }],
    ['open pipeline between 1 and 2 million', { min: 1_000_000, max: 2_000_000, minInclusive: true, maxInclusive: true }],
    ['open pipeline between 500 and 2 million', { min: 500, max: 2_000_000, minInclusive: true, maxInclusive: true }],
    ['open pipeline from $250k to $1.25m', { min: 250_000, max: 1_250_000, minInclusive: true, maxInclusive: true }],
    ['open pipeline no more than 10k', { max: 10_000, maxInclusive: true }],
    ['open pipeline not less than 10k', { min: 10_000, minInclusive: true }],
    ['open pipeline >= 5000 and < 9,999.50', { min: 5000, max: 9999.5, minInclusive: true, maxInclusive: false }],
    ['open pipeline at least 2,500 and at most 2,500', { min: 2500, max: 2500, minInclusive: true, maxInclusive: true }],
    ['deals worth exactly $4,999', { min: 4999, max: 4999, minInclusive: true, maxInclusive: true }],
    ['Open Pipeline OVER $2MM in the East', { min: 2_000_000, minInclusive: false }],
  ])('%s', (phrase, amount) => {
    expect(parseAmount(phrase)).toEqual({ amount });
  });

  it.each([
    'open pipeline',
    'open pipeline over the last quarter',
    'what is our open pipeline in FY27-Q2',
    'open pipeline for Q3 by stage',
    'open pipeline under review in the east',
    'pipeline coverage this quarter for 2026',
    'show me the top 10 owners',
  ])('no deal size in "%s"', (phrase) => {
    expect(parseAmount(phrase)).toEqual({});
  });

  it.each([
    'open pipeline for deal sizes I care about',
    'open pipeline over 5,000 and under 1,000',
    'open pipeline over 5 and under 5',
    'open pipeline over 5,000 and over 10,000',
    'open pipeline for accounts with more than 5 deals',
    'pipeline coverage over 3x',
    'open pipeline over 50%',
    'deals open more than 30 days',
    'open pipeline for 5,000',
    'open pipeline around $2M',
    'open pipeline 4000 to 5000',
    'open pipeline between 2025 and 2026',
    'open pipeline over 5000,000',
    'open pipeline over $2,000 billion',
  ])('asks instead of guessing: "%s"', (phrase) => {
    expect(parseAmount(phrase)).toEqual({ clarify: AMOUNT_CLARIFY });
  });

  it("doesn't read a product or account name as a number", () => {
    expect(parseAmount('open pipeline for GTK 500')).toEqual({ clarify: AMOUNT_CLARIFY });
    expect(parseAmount('open pipeline for GTK 500', { ignore: ['GTK 500'] })).toEqual({});
    expect(parseAmount('open pipeline for GTK 500 over $10k', { ignore: ['GTK 500'] })).toEqual({ amount: { min: 10_000, minInclusive: false } });
  });
});

describe('amount parser: properties (fast-check)', () => {
  it('reads a lower bound written any way, with the right inclusiveness', () => {
    fc.assert(
      fc.property(fc.constantFrom(...LOWER), money, fc.constantFrom(...CONTEXT), ([word, inclusive], m, context) => {
        expect(parseAmount(`open pipeline ${word} ${m.text}${context}`)).toEqual({ amount: { min: m.value, minInclusive: inclusive } });
      }),
    );
  });

  it('reads an upper bound written any way, with the right inclusiveness', () => {
    fc.assert(
      fc.property(fc.constantFrom(...UPPER), money, fc.constantFrom(...CONTEXT), ([word, inclusive], m, context) => {
        expect(parseAmount(`open pipeline ${word} ${m.text}${context}`)).toEqual({ amount: { max: m.value, maxInclusive: inclusive } });
      }),
    );
  });

  it('reads a range in order, and asks about one written backwards', () => {
    fc.assert(
      fc.property(fc.constantFrom('between', 'from'), money, money, fc.constantFrom(...CONTEXT), (word, a, b, context) => {
        fc.pre(!(a.plainYear && b.plainYear) && !(a.text.match(/^\$?[\d,.]+$/) && /^\$?[\d,.]+\s?(k|m|mm|bn|b|thousand|million|billion)$/i.test(b.text)));
        const r = parseAmount(`open pipeline ${word} ${a.text} ${word === 'between' ? 'and' : 'to'} ${b.text}${context}`);
        if (a.value <= b.value) expect(r).toEqual({ amount: { min: a.value, max: b.value, minInclusive: true, maxInclusive: true } });
        else expect(r).toEqual({ clarify: AMOUNT_CLARIFY });
      }),
    );
  });

  it('combines a lower and an upper bound, or asks when nothing could match', () => {
    fc.assert(
      fc.property(fc.constantFrom(...LOWER), money, fc.constantFrom(...UPPER), money, ([lw, li], lo, [uw, ui], hi) => {
        const r = parseAmount(`open pipeline ${lw} ${lo.text} and ${uw} ${hi.text}`);
        const empty = lo.value > hi.value || (lo.value === hi.value && !(li && ui));
        if (empty) expect(r).toEqual({ clarify: AMOUNT_CLARIFY });
        else expect(r).toEqual({ amount: { min: lo.value, minInclusive: li, max: hi.value, maxInclusive: ui } });
      }),
    );
  });

  it('thousands separators never change the number', () => {
    fc.assert(
      fc.property(fc.constantFrom(...LOWER, ...UPPER), fc.integer({ min: 1000, max: 999_999_999_999 }), ([word], n) => {
        expect(parseAmount(`open pipeline ${word} $${withCommas(n)}`)).toEqual(parseAmount(`open pipeline ${word} $${n}`));
      }),
    );
  });

  it('a question with no digits and no deal-size words has no deal size', () => {
    const words = ['open', 'pipeline', 'over', 'under', 'the', 'last', 'quarter', 'at', 'least', 'up', 'to', 'more', 'than',
      'between', 'and', 'from', 'east', 'west', 'by', 'stage', 'owner', 'review', 'above', 'below', 'worth', 'it', 'no', 'not'];
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...words), { maxLength: 12 }), (parts) => {
        expect(parseAmount(parts.join(' '))).toEqual({});
      }),
    );
  });

  it('whatever is typed, the result is either nothing, one valid filter, or a question', () => {
    const tokens = ['open pipeline', 'over', 'under', 'at least', 'at most', 'between', 'and', 'to', 'from', '$', '5,000',
      '1.5m', '2 million', 'a million', '250k', '2026', '4000', '0', '999,999,999,999', 'x', '%', 'deals', 'deal size', ',', '.', '-', 'GTK 500'];
    const typed = fc.oneof(fc.array(fc.constantFrom(...tokens), { maxLength: 10 }).map((t) => t.join(' ')), fc.string({ maxLength: 60 }));
    fc.assert(
      fc.property(typed, (phrase) => {
        const r = parseAmount(phrase);
        expect(r.amount && r.clarify).toBeFalsy();
        if (r.amount) expectValidFilter(r.amount);
      }),
      { numRuns: 2000 },
    );
  });
});
