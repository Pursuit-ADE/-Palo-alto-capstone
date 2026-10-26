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
  if (groupBy.length > 1) {
    // Each row is one combination (for example Central and Engaging), so rank combinations, not totals.
    const sortedCells = [...ranked].sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0));
    const top = sortedCells[0]!;
    const name = groupBy.map((d) => label(d, top[d], names)).join(' and ');
    return `${metric.name}${when} by ${groupBy.join(' and ')}: ${rows.length} combinations. The largest is ${name} at ${fmt(top.value, metric.unit)}.${note}`;
  }
  return rankedBreakdown(metric, rows, ranked, groupBy[0]!, when, note, names);
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
  const ranking = `${metric.name}${when} by ${dim}: ${label(dim, top[dim], names)} is highest at ${fmt(top.value, metric.unit)} and ${label(dim, bottom[dim], names)} is lowest at ${fmt(bottom.value, metric.unit)} (${count}).`;
  return `${ranking}${sharedStanding(metric, top, bottom, dim, names)}${note}`;
}

/** The band without the repeated "The target is" sentence. The ranking names the target once. */
function bandOnly(words: string): string {
  return words.split('. ')[0] ?? words;
}

function sharedStanding(metric: { unit: string; target?: number | null; caution?: number | null }, top: Row, bottom: Row, dim: string, names?: OwnerNames): string {
  const spec = metric.unit === 'ratio' ? coverageSpec(metric) : null;
  if (!spec || typeof top.value !== 'number' || typeof bottom.value !== 'number') return '';
  const high = coverageStanding(top.value, spec);
  const low = coverageStanding(bottom.value, spec);
  const target = `the target is ${spec.target.toFixed(2)}x`;
  if (high.standing === low.standing && high.words === low.words) return ` Both are ${high.standing} (${bandOnly(high.words)}; ${target}).`;
  return ` ${label(dim, top[dim], names)} is ${high.standing} (${bandOnly(high.words)}) and ${label(dim, bottom[dim], names)} is ${low.standing} (${bandOnly(low.words)}); ${target}.`;
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
