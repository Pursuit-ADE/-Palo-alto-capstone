// Plain-language summary and chart for an answer (PRD A6). Both are built deterministically from the
// governed result rows, so the words and the chart can never disagree with the numbers.
import { coverageSpec, coverageStanding } from './coverage-target';

type Row = Record<string, string | number | null>;
/** Display names for owner ids ("u_corliss_cosme" -> "Corliss Cosme"). Labels only: rows keep the ids. */
export type OwnerNames = Record<string, string>;

const usd = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmt = (v: unknown, unit: string) =>
  v === null || v === undefined ? 'not available' : typeof v !== 'number' ? String(v) : unit === 'currency' ? usd(v) : unit === 'ratio' ? `${v.toFixed(2)}x` : v.toLocaleString('en-US');
// A ratio with no denominator (no quota) is NULL. It is unavailable, not zero, and never ranked.
const hasValue = (r: Row) => r.value !== null && r.value !== undefined;
const label = (k: string, v: unknown, names?: OwnerNames) =>
  k === 'region' ? String(v).replace(/^./, (c) => c.toUpperCase()) : k === 'owner' && names && Object.hasOwn(names, String(v)) ? names[String(v)]! : String(v);

function standingPhrase(metric: { unit: string; target?: number | null; caution?: number | null }, value: unknown): string {
  const spec = metric.unit === 'ratio' ? coverageSpec(metric) : null;
  if (!spec || value == null || typeof value !== 'number') return '';
  const standing = coverageStanding(value, spec);
  return `, ${standing.standing}, ${standing.words}`;
}

export function narrate(metric: { name: string; unit: string; target?: number | null; caution?: number | null }, rows: Row[], groupBy: string[], period?: string, names?: OwnerNames): string {
  const when = period ? ` for ${period}` : '';
  if (rows.length === 0) return `No data matched for ${metric.name.toLowerCase()}${when}.`;
  if (groupBy.length === 0) {
    const r = rows[0]!;
    if (metric.unit === 'ratio') {
      if (!hasValue(r)) return `${metric.name}${when} is not available: there is no quota for this period, so ${usd(Number(r.numerator ?? 0))} of open pipeline has nothing to cover.`;
      return `${metric.name}${when} is ${fmt(r.value, 'ratio')}${standingPhrase(metric, Number(r.value))}. That is ${usd(Number(r.numerator ?? 0))} of open pipeline closing in the quarter against ${usd(Number(r.denominator ?? 0))} of quota.`;
    }
    return `${metric.name}${when} is ${fmt(r.value, metric.unit)}.`;
  }
  const ranked = rows.filter(hasValue);
  const missing = rows.length - ranked.length;
  const note = missing ? ` ${missing} ${missing === 1 ? 'has' : 'have'} no quota, so coverage is not available there.` : '';
  if (ranked.length === 0) return `${metric.name}${when} is not available for any ${groupBy.join(' and ')}: there is no quota.`;
  if (groupBy.length > 1) return combinationBreakdown(metric, rows, ranked, groupBy, when, note, names);
  return rankedBreakdown(metric, rows, ranked, groupBy[0]!, when, note, names);
}

/**
 * Two breakdowns: each row is one combination (for example Central and Engaging), so rank combinations, not totals.
 * Every combination tied for the largest is named. A helper, so narrate() stays at its complexity before the ties work.
 */
function combinationBreakdown(metric: { name: string; unit: string }, rows: Row[], ranked: Row[], groupBy: string[], when: string, note: string, names?: OwnerNames): string {
  const sortedCells = [...ranked].sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0));
  const top = sortedCells[0]!;
  const largest = tiedWith(sortedCells, top, metric.unit).map((cell) => groupBy.map((d) => label(d, cell[d], names)).join(' and '));
  const which = largest.length > 1 ? `are ${largest.slice(0, -1).join(', ')}, and ${largest[largest.length - 1]},` : `is ${largest[0]}`;
  return `${metric.name}${when} by ${groupBy.join(' and ')}: ${rows.length} combination${rows.length === 1 ? '' : 's'}. The largest ${which} at ${fmt(top.value, metric.unit)}.${note}`;
}

// One sentence for the ranking, then one clause for the standing, so the target is not repeated on both ends.
function rankedBreakdown(
  metric: { name: string; unit: string; target?: number | null; caution?: number | null },
  rows: Row[],
  ranked: Row[],
  dim: string,
  when: string,
  note: string,
  names?: OwnerNames,
): string {
  const sorted = [...ranked].sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0));
  const top = sorted[0]!;
  const bottom = sorted[sorted.length - 1]!;
  // One row is not a ranking: say it is the only one, not that it is both highest and a list of '1 stages'.
  if (sorted.length === 1) return `${metric.name}${when} by ${dim}: ${label(dim, top[dim], names)} is the only ${dim}, at ${fmt(top.value, metric.unit)}${standingPhrase(metric, Number(top.value))}.${note}`;
  const count = `${rows.length} ${dim === 'owner' ? 'owners' : `${dim}s`}`;
  // Rows with no value (no quota) are not part of a tie; the note says how many there are. Two rows are "both", not
  // "all 2" (review, Oct 31).
  const plural = dim === 'owner' ? 'owners' : `${dim}s`;
  const valued = sorted.length === 2 ? `both ${plural}` : `all ${sorted.length} ${plural}`;
  if (fmt(top.value, metric.unit) === fmt(bottom.value, metric.unit)) {
    return `${metric.name}${when} by ${dim}: ${valued} are equal at ${fmt(top.value, metric.unit)}${standingPhrase(metric, Number(top.value))}.${note}`;
  }
  const highs = tiedWith(sorted, top, metric.unit);
  const lows = tiedWith(sorted, bottom, metric.unit);
  const high = listed(highs.map((r) => label(dim, r[dim], names)));
  const low = listed(lows.map((r) => label(dim, r[dim], names)));
  const ranking = `${metric.name}${when} by ${dim}: ${high} highest at ${fmt(top.value, metric.unit)} and ${low} lowest at ${fmt(bottom.value, metric.unit)} (${count}).`;
  return `${ranking}${sharedStanding(metric, top, bottom, high, low, sorted.length)}${note}`;
}

/**
 * Every row that shows the same value as `row`. Rows that tie are all named, never one picked by row order (bug hunt,
 * Oct 31: "Engaging is highest at $31,784 and Prospecting is lowest at $31,784"). Compared as shown, so $31,784.40 and
 * $31,783.60 tie too (review, Oct 31).
 */
function tiedWith(sorted: Row[], row: Row, unit: string): Row[] {
  return sorted.filter((r) => fmt(r.value, unit) === fmt(row.value, unit));
}

/** "West is", "West and East are", "West, East and Central are". */
function listed(labels: string[]): string {
  if (labels.length === 1) return `${labels[0]} is`;
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]} are`;
}

/** The band without the repeated "The target is" sentence. The ranking names the target once. */
function bandOnly(words: string): string {
  return words.split('. ')[0] ?? words;
}

/** `high` and `low` are the tied labels with their verb, from listed(): "West is", "West and East are". */
function sharedStanding(metric: { unit: string; target?: number | null; caution?: number | null }, top: Row, bottom: Row, high: string, low: string, ranked: number): string {
  const spec = metric.unit === 'ratio' ? coverageSpec(metric) : null;
  if (!spec || typeof top.value !== 'number' || typeof bottom.value !== 'number') return '';
  const highest = coverageStanding(top.value, spec);
  const lowest = coverageStanding(bottom.value, spec);
  const target = `the target is ${spec.target.toFixed(2)}x`;
  // When the highest and lowest share a band, every row between them does too, so with more than two rows it is "All 3
  // are", not "Both are" (reviews, Oct 31: "Both" read as if only two regions were off target).
  if (highest.standing === lowest.standing && highest.words === lowest.words) return ` ${ranked > 2 ? `All ${ranked}` : 'Both'} are ${highest.standing} (${bandOnly(highest.words)}; ${target}).`;
  return ` ${high} ${highest.standing} (${bandOnly(highest.words)}) and ${low} ${lowest.standing} (${bandOnly(lowest.words)}); ${target}.`;
}

/** A Vega-Lite bar chart spec for one breakdown, or null when a single number needs no chart. */
/** The chart carries display labels (names, capitalized regions), resolved here once, so the bars and the sentence match. */
export function chartSpec(metric: { name: string; unit: string }, rows: Row[], groupBy: string[], names?: OwnerNames) {
  const drawn = rows.filter(hasValue);
  if (groupBy.length !== 1 || drawn.length < 2) return null;
  const dim = groupBy[0]!;
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    description: `${metric.name} by ${dim}`,
    data: { values: drawn.map((r) => ({ [dim]: label(dim, r[dim], names), value: Number(r.value) })) },
    mark: 'bar',
    encoding: {
      y: { field: dim, type: 'nominal', sort: '-x', title: dim },
      x: { field: 'value', type: 'quantitative', title: metric.name },
    },
  } as const;
}
