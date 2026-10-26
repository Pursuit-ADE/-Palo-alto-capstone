// Governed answers as chart data for the Graphs view. Every value and label comes from the same rows, and the same
// format()/cell() text, as the Numbers view, so a graph can never show a number the table doesn't. Missing values
// (no quota) stay missing: drawn as "n/a", never as 0.
import type { Answer } from '@/semantic/answer';
import { coverageSpec, coverageStanding } from '@/semantic/coverage-target';
import type { ChartData, ChartDatum, Unit } from './chart3d-math';
import { cell, format } from './format';

/** Open-deal stages in funnel order, then the closed ones. */
export const STAGE_ORDER = ['Prospecting', 'Engaging', 'Won', 'Lost'];
/** Larger breakdowns stay a table: a graph of hundreds of bars helps no one. */
export const MAX_CATEGORIES = 60;

const unitOf = (u: string): Unit => (u === 'currency' || u === 'ratio' ? u : 'count');
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A dimension value as the table and narrative show it (owner ids become names, regions are capitalized). */
export function dimLabel(a: Answer, dim: string, v: unknown): string {
  return dim === 'owner' ? (a.ownerNames?.[String(v)] ?? String(v)) : cell(dim, v, '');
}

function orderCategories(dim: string, keys: string[], rankOf: (k: string) => number) {
  if (dim === 'stage') return [...keys].sort((a, b) => (STAGE_ORDER.indexOf(a) + 99) % 99 - ((STAGE_ORDER.indexOf(b) + 99) % 99));
  if (dim === 'owner') return [...keys].sort((a, b) => rankOf(b) - rankOf(a)); // largest first, as the bar chart spec says
  return keys; // regions keep the query's order
}

const sentence = (title: string, data: ChartDatum[], labelOf: (d: ChartDatum) => string) => `${title}: ${data.map((d) => `${labelOf(d)} ${d.display}`).join(', ')}.`;

/** Actual coverage as a bar inside its target, one category at a time. Opens as a bullet chart. */
function againstTarget(metric: Answer['metric'], categories: { key: string; label: string }[], values: { value: number | null; display: string }[], id: string, title: string): ChartData | null {
  const goal = coverageSpec(metric);
  if (!goal) return null;
  const data: ChartDatum[] = categories.flatMap((c, i) => {
    const v = values[i]!;
    return [
      { category: c.key, series: 0, value: v.value, display: v.display },
      { category: c.key, series: 1, value: goal.target, display: `${goal.target.toFixed(2)}x` },
    ];
  });
  const summary = categories.map((c, i) => {
    const v = values[i]!.value;
    if (v == null) return `${c.label} is not available`;
    const standing = coverageStanding(v, goal);
    return `${c.label} is ${values[i]!.display}, ${standing.standing}, ${standing.words}`;
  }).join('; ');
  return {
    id, tab: 'Against target', title, unit: 'ratio', form: 'columns', prefer: 'bullet',
    categoryName: 'Coverage', categories, series: ['Coverage', `${goal.target.toFixed(2)}x target`],
    data, compare: true, summary: `${summary}.`,
  };
}

/** True when the parts add up to the total exactly (to the cent for money). */
export function reconciles(parts: (number | null)[], total: number, unit: Unit): boolean {
  if (parts.some((p) => p === null)) return false;
  const sum = parts.reduce<number>((s, p) => s + (p ?? 0), 0);
  return unit === 'currency' ? Math.round(sum * 100) === Math.round(total * 100) : Math.abs(sum - total) < 1e-9;
}

/**
 * A dashboard tile's number split by stage. The split is drawn only when it comes from the same snapshot and adds up
 * to the tile's number; otherwise the graph shows the total alone and says why.
 */
export function kpiStageChart(total: Answer, byStage: Answer | null, id: string, title: string): ChartData {
  const unit = unitOf(total.metric.unit);
  const totalV = num(total.rows[0]?.value);
  const parts = byStage?.rows.map((r) => ({ stage: String(r.stage), value: num(r.value) })) ?? [];
  const same = !!byStage && byStage.provenance.snapshotId === total.provenance.snapshotId;
  const ok = same && totalV !== null && parts.length > 0 && reconciles(parts.map((p) => p.value), totalV, unit);
  // No open deals at all is an answer, not a failure: there is simply nothing to split.
  const none = same && parts.length === 0 && totalV === 0;
  if (!ok) {
    const data: ChartDatum[] = [{ category: 'all', series: 0, value: totalV, display: format(totalV, unit) }];
    return {
      id,
      title,
      unit,
      size: 'tile',
      form: 'columns',
      categoryName: 'Deals',
      categories: [{ key: 'all', label: 'All open deals' }],
      series: [total.metric.name],
      data,
      summary: sentence(title, data, () => 'All open deals'),
      note: none ? 'There are no open deals in your scope, so there is nothing to split by stage.' : 'The split by stage is not available right now, so the graph shows the total.',
    };
  }
  const keys = orderCategories('stage', parts.map((p) => p.stage), () => 0);
  const data: ChartDatum[] = keys.map((k) => {
    const v = parts.find((p) => p.stage === k)!.value;
    return { category: k, series: 0, value: v, display: format(v, unit) };
  });
  return {
    id,
    title,
    unit,
    size: 'tile',
    form: 'columns',
    categoryName: 'Stage',
    categories: keys.map((k) => ({ key: k, label: k })),
    series: [total.metric.name],
    data,
    summary: sentence(title, data, (d) => d.category),
    // Stages run in funnel order, and the parts add up to the tile's number (checked above), which the donut's hole shows.
    ordered: true,
    parts: true,
    total: { value: totalV, display: format(totalV, unit), label: 'total' },
  };
}

// Coverage divides pipeline closing in the quota period, not every open deal (the dashboard's "Open pipeline" tile), so
// every graph of coverage rows names its numerator the same way, with the period, and the ratio's detail keeps the period.
const closingLabel = (period?: string) => (period ? `Pipeline closing in ${period}` : 'Pipeline closing in the period');
const quotaLabel = (period?: string, word = 'Quota') => (period ? `${word} for ${period}` : word);
const coverageDetail = (r: Answer['rows'][number], v: number | null, period?: string) =>
  `${format(r.numerator, 'currency')} closing in ${period ?? 'the period'} vs ${format(r.denominator, 'currency')} quota${v === null ? ' (no quota, so not available)' : ''}`;

/** Coverage by region: the ratio against its target line when the registry defines one, otherwise the 1.00x line, plus pipeline next to quota. */
export function coverageRegionCharts(byRegion: Answer, period: string, idPrefix: string): ChartData[] {
  const goal = coverageSpec(byRegion.metric);
  const regions = byRegion.rows.map((r) => String(r.region));
  const label = (k: string) => cell('region', k, '');
  const row = (k: string) => byRegion.rows.find((r) => String(r.region) === k)!;
  const ratio: ChartDatum[] = regions.map((k) => {
    const r = row(k);
    const v = num(r.value);
    return { category: k, series: 0, value: v, display: format(v, 'ratio'), detail: coverageDetail(r, v, period) };
  });
  const money: ChartDatum[] = regions.flatMap((k) => {
    const r = row(k);
    const p = num(r.numerator);
    const q = num(r.denominator);
    return [
      { category: k, series: 0, value: p, display: format(p, 'currency') },
      { category: k, series: 1, value: q, display: q === null ? 'No quota' : format(q, 'currency') },
    ];
  });
  const cats = regions.map((k) => ({ key: k, label: label(k) }));
  const bullet = againstTarget(byRegion.metric, cats, regions.map((k) => ({ value: num(row(k).value), display: format(num(row(k).value), 'ratio') })), `${idPrefix}-target`, `Coverage against target · ${period}`);
  return [
    ...(bullet ? [bullet] : []),
    {
      id: `${idPrefix}-ratio`,
      tab: 'Coverage',
      title: `Coverage by region · ${period}`,
      unit: 'ratio',
      size: 'card',
      form: 'columns',
      categoryName: 'Region',
      categories: cats,
      series: ['Coverage'],
      data: ratio,
      target: goal ? { value: goal.target, label: `${goal.target.toFixed(2)}x target` } : { value: 1, label: '1.00x = quota' },
      axisFloor: goal ? Math.max(goal.target + 0.25, 1.25) : 1.25,
      summary: `${sentence(`Pipeline coverage by region, ${period}`, ratio, (d) => label(d.category))} ${goal ? `The target is ${goal.target.toFixed(2)}x.` : '1.00x means pipeline equals quota.'}`,
    },
    {
      id: `${idPrefix}-money`,
      tab: 'Pipeline vs quota',
      title: `Pipeline vs quota by region · ${period}`,
      unit: 'currency',
      size: 'card',
      form: 'columns',
      categoryName: 'Region',
      categories: cats,
      series: [closingLabel(period), quotaLabel(period)],
      data: money,
      compare: true,
      summary: `${closingLabel(period)} and ${quotaLabel(period, 'quota')}, by region: ${regions
        .map((k) => `${label(k)} ${format(row(k).numerator, 'currency')} vs ${format(row(k).denominator, 'currency')}`)
        .join(', ')}.`,
    },
  ];
}

function singleValueCharts(a: Answer, id: string, unit: Unit, period?: string): ChartData[] {
  const r = a.rows[0]!;
  const v = num(r.value);
  if (unit === 'ratio' && ('numerator' in r || 'denominator' in r)) {
    // Coverage: the ratio is the headline; the graph shows what it divides.
    const p = num(r.numerator);
    const q = num(r.denominator);
    const data: ChartDatum[] = [
      { category: 'pipeline', series: 0, value: p, display: format(p, 'currency') },
      { category: 'quota', series: 0, value: q, display: q === null ? 'No quota' : format(q, 'currency') },
    ];
    const cats = [
      { key: 'pipeline', label: closingLabel(period) },
      { key: 'quota', label: quotaLabel(period) },
    ];
    const title = `${a.metric.name}${period ? ` · ${period}` : ''}: pipeline vs quota`;
    const divided = { id, title, unit: 'currency' as const, form: 'columns' as const, categoryName: 'Measure', categories: cats, series: ['Amount'], data, summary: `${sentence(title, data, (d) => cats.find((c) => c.key === d.category)!.label)} Coverage is ${format(v, 'ratio')}.` };
    const bullet = againstTarget(a.metric, [{ key: 'coverage', label: 'Coverage' }], [{ value: v, display: format(v, 'ratio') }], `${id}-target`, `${a.metric.name}${period ? ` · ${period}` : ''} against target`);
    return bullet ? [divided, bullet] : [divided];
  }
  const data: ChartDatum[] = [{ category: 'total', series: 0, value: v, display: format(v, unit) }];
  return [{ id, title: a.metric.name, unit, form: 'columns', categoryName: 'Scope', categories: [{ key: 'total', label: 'Your scope' }], series: [a.metric.name], data, summary: a.narrative }];
}

function oneBreakdownCharts(a: Answer, id: string, unit: Unit, period: string | undefined, dim: string): ChartData[] | null {
  const keys = a.rows.map((r) => String(r[dim]));
  if (keys.length > MAX_CATEGORIES) return null;
  const rankOf = (k: string) => num(a.rows.find((r) => String(r[dim]) === k)?.value) ?? -1;
  const ordered = orderCategories(dim, keys, rankOf);
  const row = (k: string) => a.rows.find((r) => String(r[dim]) === k)!;
  const cats = ordered.map((k) => ({ key: k, label: dimLabel(a, dim, row(k)[dim]) }));
  const data: ChartDatum[] = ordered.map((k) => {
    const r = row(k);
    const v = num(r.value);
    const detail = unit === 'ratio' && 'numerator' in r ? coverageDetail(r, v, period) : undefined;
    return { category: k, series: 0, value: v, display: format(v, unit), ...(detail ? { detail } : {}) };
  });
  const base: ChartData = {
    id,
    title: `${a.metric.name} by ${dim}`,
    unit,
    form: dim === 'owner' ? 'rows' : undefined,
    categoryName: dim.replace(/^./, (c) => c.toUpperCase()),
    categories: cats,
    series: [a.metric.name],
    data,
    summary: a.narrative,
    ordered: dim === 'stage',
    parts: unit !== 'ratio', // sums and counts add up; coverage ratios don't
  };
  if (unit !== 'ratio') return [base];
  const goal = coverageSpec(a.metric);
  const ratioChart: ChartData = { ...base, tab: 'Coverage', target: goal ? { value: goal.target, label: `${goal.target.toFixed(2)}x target` } : { value: 1, label: '1.00x = quota' }, axisFloor: goal ? Math.max(goal.target + 0.25, 1.25) : 1.25 };
  if (!a.rows.some((r) => 'numerator' in r)) return [ratioChart];
  const values = ordered.map((k) => ({ value: num(row(k).value), display: format(num(row(k).value), unit) }));
  const bullet = againstTarget(a.metric, cats, values, `${id}-target`, `${a.metric.name} against target`);
  return [...(bullet ? [bullet] : []), ratioChart, pipelineQuotaChart(a, id, period, dim, ordered, row, base)];
}

function pipelineQuotaChart(a: Answer, id: string, period: string | undefined, dim: string, ordered: string[], row: (k: string) => Answer['rows'][number], base: ChartData): ChartData {
  const money: ChartDatum[] = ordered.flatMap((k) => {
    const r = row(k);
    const p = num(r.numerator);
    const q = num(r.denominator);
    return [
      { category: k, series: 0, value: p, display: format(p, 'currency') },
      { category: k, series: 1, value: q, display: q === null ? 'No quota' : format(q, 'currency') },
    ];
  });
  return {
    ...base,
    id: `${id}-money`,
    tab: 'Pipeline vs quota',
    title: `Pipeline vs quota by ${dim}`,
    unit: 'currency',
    series: [closingLabel(period), quotaLabel(period)],
    data: money,
    parts: false,
    compare: true,
    summary: `${closingLabel(period)} and ${quotaLabel(period, 'quota')}, by ${dim}: ${ordered.map((k) => `${dimLabel(a, dim, row(k)[dim])} ${format(row(k).numerator, 'currency')} vs ${format(row(k).denominator, 'currency')}`).join(', ')}.`,
  };
}

// Two breakdowns: the one with fewer values (at most three) becomes the series, side by side flat, rows in depth in 3D.
function twoBreakdownCharts(a: Answer, id: string, unit: Unit, dims: string[]): ChartData[] | null {
  const [d0, d1] = dims as [string, string];
  const distinct = (d: string) => [...new Set(a.rows.map((r) => String(r[d])))];
  const [seriesDim, catDim] = distinct(d0).length <= distinct(d1).length ? [d0, d1] : [d1, d0];
  const seriesKeys = orderCategories(seriesDim, distinct(seriesDim), () => 0);
  const catTotals = new Map<string, number>();
  for (const r of a.rows) catTotals.set(String(r[catDim]), (catTotals.get(String(r[catDim])) ?? 0) + (num(r.value) ?? 0));
  const catKeys = orderCategories(catDim, distinct(catDim), (k) => catTotals.get(k) ?? 0);
  if (seriesKeys.length > 3 || catKeys.length > MAX_CATEGORIES) return null;
  const labelOf = (d: string, k: string) => dimLabel(a, d, a.rows.find((r) => String(r[d]) === k)?.[d] ?? k);
  const data: ChartDatum[] = a.rows.map((r) => {
    const v = num(r.value);
    return { category: String(r[catDim]), series: seriesKeys.indexOf(String(r[seriesDim])), value: v, display: format(v, unit) };
  });
  return [
    {
      id,
      title: `${a.metric.name} by ${catDim} and ${seriesDim}`,
      unit,
      form: catDim === 'owner' ? 'rows' : undefined,
      categoryName: catDim.replace(/^./, (c) => c.toUpperCase()),
      categories: catKeys.map((k) => ({ key: k, label: labelOf(catDim, k) })),
      series: seriesKeys.map((k) => labelOf(seriesDim, k)),
      data,
      summary: a.narrative,
      ordered: catDim === 'stage',
      parts: unit !== 'ratio',
      grid: true,
    },
  ];
}

/** A copilot answer as one or more charts (tabs), or null when a graph would not help. */
export function answerCharts(a: Answer, id: string): ChartData[] | null {
  if (a.rows.length === 0) return null;
  const unit = unitOf(a.metric.unit);
  const dims = a.filters.groupBy;
  const period = a.filters.period?.label;
  if (dims.length === 0) return singleValueCharts(a, id, unit, period);
  if (dims.length === 1) return oneBreakdownCharts(a, id, unit, period, dims[0]!);
  return twoBreakdownCharts(a, id, unit, dims);
}

/**
 * Break-down questions a single-number answer can offer (only the breakdowns its metric allows). Each is a follow-up
 * ("And open pipeline by stage"): the follow-up word plus the same metric keeps the answer's regions, stages and
 * period, so the parts add up to the number they break down.
 */
export function breakdownQuestions(a: Answer, metricDims: Record<string, string[]>): { label: string; question: string }[] {
  if (a.filters.groupBy.length > 0) return [];
  const id = a.metric.id;
  return (metricDims[id] ?? []).map((d) => ({ label: `By ${d}`, question: `And ${a.metric.name.toLowerCase()} by ${d}` }));
}
