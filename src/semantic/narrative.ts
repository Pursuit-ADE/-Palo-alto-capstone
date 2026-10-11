// Plain-language summary and chart for an answer (PRD A6). Both are built deterministically from the
// governed result rows, so the words and the chart can never disagree with the numbers.

type Row = Record<string, string | number | null>;

const usd = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmt = (v: unknown, unit: string) =>
  typeof v !== 'number' ? String(v ?? '') : unit === 'currency' ? usd(v) : unit === 'ratio' ? `${v.toFixed(2)}x` : v.toLocaleString('en-US');
const label = (k: string, v: unknown) => (k === 'region' ? String(v).replace(/^./, (c) => c.toUpperCase()) : String(v));

export function narrate(metric: { name: string; unit: string }, rows: Row[], groupBy: string[], period?: string): string {
  const when = period ? ` for ${period}` : '';
  if (rows.length === 0) return `No data matched for ${metric.name.toLowerCase()}${when}.`;
  if (groupBy.length === 0) {
    const r = rows[0]!;
    if (metric.unit === 'ratio') {
      return `${metric.name}${when} is ${fmt(r.value, 'ratio')}: ${usd(Number(r.numerator ?? 0))} of open pipeline closing in the quarter against ${usd(Number(r.denominator ?? 0))} of quota.`;
    }
    return `${metric.name}${when} is ${fmt(r.value, metric.unit)}.`;
  }
  const dim = groupBy[0]!;
  const sorted = [...rows].sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0));
  const top = sorted[0]!;
  const bottom = sorted[sorted.length - 1]!;
  const parts = [`${metric.name}${when} by ${dim}: ${label(dim, top[dim])} is highest at ${fmt(top.value, metric.unit)}`];
  if (sorted.length > 1) parts.push(`${label(dim, bottom[dim])} is lowest at ${fmt(bottom.value, metric.unit)}`);
  return `${parts.join(', and ')} (${rows.length} ${dim === 'owner' ? 'owners' : `${dim}s`}).`;
}

/** A Vega-Lite bar chart spec for one breakdown, or null when a single number needs no chart. */
export function chartSpec(metric: { name: string; unit: string }, rows: Row[], groupBy: string[]) {
  if (groupBy.length !== 1 || rows.length < 2) return null;
  const dim = groupBy[0]!;
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    description: `${metric.name} by ${dim}`,
    data: { values: rows.map((r) => ({ [dim]: label(dim, r[dim]), value: Number(r.value ?? 0) })) },
    mark: 'bar',
    encoding: {
      y: { field: dim, type: 'nominal', sort: '-x', title: dim },
      x: { field: 'value', type: 'quantitative', title: metric.name },
    },
  } as const;
}
