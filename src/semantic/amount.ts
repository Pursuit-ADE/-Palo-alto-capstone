// Deal-size filters in a question: "over $1.5M", "under 5,000", "between 4,000 and 5,000", "at most a million".
// Reads the question as typed, before normalize()'s clean() strips punctuation, because commas and decimal
// points change the number ("$5,000" must not become 5). Anything that looks like a deal size but can't be read
// exactly is a clarifying question, never a guess: dropping it would answer for the whole scope (PRD A2).

export interface AmountFilter {
  min?: number;
  max?: number;
  minInclusive?: boolean;
  maxInclusive?: boolean;
}

export interface AmountResult {
  amount?: AmountFilter;
  clarify?: string;
}

/** Same bound as the Intent schema's amount filter. */
export const MAX_AMOUNT = 1e12;

export const AMOUNT_CLARIFY =
  'I can filter by deal size, but I need the comparison: for example over $1M, under $5,000, or between 4,000 and 5,000.';

// Comparison words, with whether the bound includes the number. Longest first, so "no more than" wins over "more than".
const LOWER: Record<string, boolean> = {
  'no less than': true, 'not less than': true, 'at least': true, '>=': true,
  'more than': false, 'greater than': false, 'bigger than': false, 'larger than': false, 'exceeding': false,
  'over': false, 'above': false, '>': false,
};
const UPPER: Record<string, boolean> = {
  'no more than': true, 'not more than': true, 'at most': true, 'up to': true, '<=': true,
  'less than': false, 'fewer than': false, 'smaller than': false, 'under': false, 'below': false, '<': false,
};
const EXACT = ['exactly', 'equal to', 'equals', 'worth', 'valued at'];

const SCALE: Record<string, number> = { thousand: 1e3, million: 1e6, billion: 1e9, mm: 1e6, bn: 1e9, k: 1e3, m: 1e6 };
const SCALE_WORDS = Object.keys(SCALE).join('|');

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alternation = (words: string[]) => [...words].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');

// A number: "$5,000", "1.5m", "$2 million", or "a/one million". Not part of a word ("fy27", "q3") or a longer number.
const NUM = String.raw`(?:(\$\s?)?(?<![\w.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?!\d|,\d|\.\d)(?:\s?(${SCALE_WORDS})\b)?|\b(?:a|one)\s(${SCALE_WORDS})\b)`;
const COMPARISON = new RegExp(String.raw`(?<![a-z])(${alternation([...Object.keys(LOWER), ...Object.keys(UPPER), ...EXACT])})\s*${NUM}`, 'g');
const RANGE = new RegExp(String.raw`(?<![a-z])(?:between|from)\s+${NUM}\s*(?:and|to|-)\s*${NUM}`, 'g');

// A number followed by one of these is a count, a ratio or a duration, not dollars ("more than 5 deals", "over 3x").
const NOT_MONEY = /^\s?(%|x\b|percent|times\b|deals?\b|opportunit|opps?\b|accounts?\b|reps?\b|people\b|days?\b|weeks?\b|months?\b|years?\b|quarters?\b)/;
const DEAL_SIZE_WORDS = /\b(deal sizes?|size of (the )?deals?|deal values?|deal amounts?)\b/;

interface Num {
  value: number;
  scaled: boolean;
  plainYear: boolean;
}

function readNum(dollar: string | undefined, int: string | undefined, frac: string | undefined, scale: string | undefined, wordScale: string | undefined): Num {
  if (wordScale) return { value: SCALE[wordScale]!, scaled: true, plainYear: false };
  const digits = int!.replace(/,/g, '');
  const raw = Number(frac ? `${digits}.${frac}` : digits) * (scale ? SCALE[scale]! : 1);
  return {
    value: Math.round(raw * 100) / 100,
    scaled: Boolean(scale),
    plainYear: !dollar && !scale && !frac && /^(19|20)\d\d$/.test(int!),
  };
}

function blank(text: string, start: number, end: number): string {
  return text.slice(0, start) + ' '.repeat(end - start) + text.slice(end);
}

/**
 * Reads the deal-size filter in a question. `ignore` lists names already matched as products, accounts or people,
 * so "GTK 500" isn't read as a number. Returns `{}` when the question names no deal size.
 */
export function parseAmount(phrase: string, opts: { ignore?: string[] } = {}): AmountResult {
  let text = ` ${phrase.toLowerCase()} `;
  for (const name of opts.ignore ?? []) {
    if (name.trim()) text = text.replace(new RegExp(escapeRegExp(name.toLowerCase()), 'g'), (m) => ' '.repeat(m.length));
  }

  const lower: { value: number; inclusive: boolean }[] = [];
  const upper: { value: number; inclusive: boolean }[] = [];
  const ranges: { min: number; max: number }[] = [];
  let unclear = false;

  for (const m of text.matchAll(RANGE)) {
    let a = readNum(m[1], m[2], m[3], m[4], m[5]);
    const b = readNum(m[6], m[7], m[8], m[9], m[10]);
    // "between 2000 and 3000" could be years or dollars. Ask rather than guess either way.
    if (a.plainYear && b.plainYear) {
      unclear = true;
      text = blank(text, m.index, m.index + m[0].length);
      continue;
    }
    // "between 1 and 2 million": the scale on the second number applies to the first, when that keeps them in order.
    const scale = m[9] ?? m[10];
    if (!a.scaled && scale && a.value * SCALE[scale]! <= b.value) a = { ...a, value: Math.round(a.value * SCALE[scale]! * 100) / 100 };
    if (NOT_MONEY.test(text.slice(m.index + m[0].length))) unclear = true;
    else ranges.push({ min: a.value, max: b.value });
    text = blank(text, m.index, m.index + m[0].length);
  }

  for (const m of text.matchAll(COMPARISON)) {
    const word = m[1]!;
    const n = readNum(m[2], m[3], m[4], m[5], m[6]);
    if (NOT_MONEY.test(text.slice(m.index + m[0].length))) unclear = true;
    else if (word in LOWER) lower.push({ value: n.value, inclusive: LOWER[word]! });
    else if (word in UPPER) upper.push({ value: n.value, inclusive: UPPER[word]! });
    else ranges.push({ min: n.value, max: n.value });
    text = blank(text, m.index, m.index + m[0].length);
  }

  // What's left: a deal size we couldn't read exactly is a question, not a dropped filter.
  if (unclear || DEAL_SIZE_WORDS.test(text) || /\$\s?\d/.test(text) || leftoverNumber(text)) return { clarify: AMOUNT_CLARIFY };
  if (!lower.length && !upper.length && !ranges.length) return {};
  if (lower.length > 1 || upper.length > 1 || ranges.length > 1 || (ranges.length && (lower.length || upper.length))) {
    return { clarify: AMOUNT_CLARIFY };
  }

  const amount: AmountFilter = {};
  if (ranges[0]) Object.assign(amount, { min: ranges[0].min, max: ranges[0].max, minInclusive: true, maxInclusive: true });
  if (lower[0]) Object.assign(amount, { min: lower[0].value, minInclusive: lower[0].inclusive });
  if (upper[0]) Object.assign(amount, { max: upper[0].value, maxInclusive: upper[0].inclusive });

  const { min, max } = amount;
  if ((min ?? 0) > MAX_AMOUNT || (max ?? 0) > MAX_AMOUNT) return { clarify: AMOUNT_CLARIFY };
  if (min != null && max != null) {
    // An empty range ("over 5,000 and under 1,000", "over 5 and under 5") would answer zero for any data.
    if (min > max || (min === max && (amount.minInclusive === false || amount.maxInclusive === false))) return { clarify: AMOUNT_CLARIFY };
  }
  return { amount };
}

/** A number left over after comparisons were read: a scaled amount, or 3+ digits that isn't a year. */
function leftoverNumber(text: string): boolean {
  if (new RegExp(String.raw`(?<![\w.,])\d+(?:\.\d+)?\s?(${SCALE_WORDS})\b`).test(text)) return true;
  for (const m of text.matchAll(/(?<![\w.,])\d[\d,.]*\d(?![\w])/g)) {
    const digits = m[0].replace(/[,.]/g, '');
    if (digits.length >= 3 && !/^(19|20)\d\d$/.test(m[0])) return true;
  }
  return false;
}
