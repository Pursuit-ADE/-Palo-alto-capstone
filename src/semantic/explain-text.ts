// How two coverage figures differ, and the fixed sentences that say so. Pure functions of governed answers: no
// database, no model. The wording names only the asker's own scope, never another person's slice or figure.
import { findPeriod } from './periods';
import type { Answer } from './governed';

/** Why two figures differ. The first that applies wins; a figure that doesn't reconcile always wins. */
export type Verdict =
  | 'reconciliation_failure'
  | 'different_metric'
  | 'different_snapshot'
  | 'different_period'
  | 'same_definition_different_scope'
  | 'same_inputs';

const usd = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const scopeOf = (a: Answer) => a.scope.replace(/^Scope: /, '').replace(/\.$/, '');

function parts(a: Answer): { n: number; d: number | null; v: number | null } | null {
  const row = a.rows[0];
  if (a.rows.length !== 1 || !row || typeof row.numerator !== 'number') return null;
  return { n: row.numerator, d: typeof row.denominator === 'number' ? row.denominator : null, v: typeof row.value === 'number' ? row.value : null };
}

/** The stored value is numerator / denominator rounded to 4 places (src/semantic/compile.ts), or null with no quota. */
export function reconciles(a: Answer): boolean {
  const p = parts(a);
  if (!p) return false;
  if (p.d === null || p.d === 0) return p.v === null;
  return p.v !== null && Math.abs(p.n / p.d - p.v) <= 0.00005 + 1e-9;
}

const sliceKey = (a: Answer) => JSON.stringify([[...a.filters.regions].sort(), a.filters.people ?? [], a.filters.teams ?? [], a.scope]);

/** Classifies two figures the asker may both see. `numerators` says whether each numerator matched open pipeline. */
export function classify(a: Answer, b: Answer, numerators: boolean[] = [true, true]): Verdict {
  if (!reconciles(a) || !reconciles(b) || numerators.some((ok) => !ok)) return 'reconciliation_failure';
  if (a.metric.id !== b.metric.id || a.metric.version !== b.metric.version) return 'different_metric';
  if (a.provenance.snapshotId !== b.provenance.snapshotId) return 'different_snapshot';
  if (a.filters.period?.label !== b.filters.period?.label) return 'different_period';
  if (sliceKey(a) !== sliceKey(b)) return 'same_definition_different_scope';
  // The same metric, data, quarter and slice must give the same rows. Anything else is a defect, not a difference.
  return JSON.stringify(a.rows) === JSON.stringify(b.rows) ? 'same_inputs' : 'reconciliation_failure';
}

/** The slice a figure covers, in the asker's own terms: a named team, rep or region, or their whole scope. */
function sliceLabel(a: Answer): string {
  const named = (a.intent as { filters?: { regions?: string[] } }).filters?.regions;
  const bits = [
    ...(named?.length ? [`${named.map((r) => r[0]!.toUpperCase() + r.slice(1)).join(' and ')} region`] : []),
    ...(a.filters.teams ?? []).map((t) => `${t}'s team`),
    ...(a.filters.people ?? []),
  ];
  return bits.length ? bits.join(', ') : `all of ${scopeOf(a)}`;
}

function figure(a: Answer): string {
  const p = parts(a);
  if (!p) return 'not available';
  if (p.v === null) return `not available: ${usd(p.n)} of open pipeline and no quota`;
  return `${p.v.toFixed(2)}x (${usd(p.n)} of open pipeline / ${usd(p.d ?? 0)} of quota)`;
}

function quarter(a: Answer): string {
  const label = a.filters.period?.label ?? '';
  const p = findPeriod(label);
  return p ? `${label} (${p.start} to ${p.end})` : label;
}

function checksFor(sides: Answer[], numerators: boolean[], byPeriod: boolean) {
  return sides.flatMap((a, i) => {
    const who = byPeriod ? (a.filters.period?.label ?? '') : sliceLabel(a);
    const p = parts(a);
    const sum = p && p.d !== null && p.v !== null ? `${usd(p.n)} / ${usd(p.d)} = ${p.v.toFixed(4)}` : 'numerator / denominator';
    return [
      { label: `${who}: ${sum}`, ok: reconciles(a) },
      { label: `${who}: the numerator equals open pipeline for the same slice and quarter`, ok: numerators[i] ?? false },
    ];
  });
}

type SliceFilters = { regions?: string[]; people?: string[]; teams?: string[] };
const sliceOf = (a: Answer): SliceFilters => (a.intent as { filters?: SliceFilters }).filters ?? {};
const within = (inner?: string[], outer?: string[]) => !outer || (inner !== undefined && inner.every((x) => outer.includes(x)));

/** Whether `inner` is provably part of `outer`: every filter outer sets, inner sets too, with a subset of its values. */
function contains(outer: Answer, inner: Answer): boolean {
  const [o, i] = [sliceOf(outer), sliceOf(inner)];
  return outer.scope === inner.scope && within(i.regions, o.regions) && within(i.people, o.people) && within(i.teams, o.teams);
}

const KINDS = [
  ['regions', 'regions', 'region'],
  ['teams', 'teams', 'team'],
  ['people', 'reps', 'rep'],
] as const;

/**
 * Two slices filtered by the same kind only, with no value in common: separate regions, teams or reps. A deal and a
 * quota belong to one region and one rep, and a rep reports to one manager, so these never overlap. Returns the kind.
 */
function separateKind(a: Answer, b: Answer): (typeof KINDS)[number] | null {
  const [x, y] = [sliceOf(a), sliceOf(b)];
  for (const kind of KINDS) {
    const only = (s: SliceFilters) => (s[kind[0]]?.length ?? 0) > 0 && KINDS.every(([k]) => k === kind[0] || !s[k]);
    if (only(x) && only(y) && !x[kind[0]]?.some((v) => y[kind[0]]?.includes(v))) return kind;
  }
  return null;
}

/** Says how two slices relate only as far as their filters prove it (PR #50 review: East and West are not nested). */
function scopeReason(a: Answer, b: Answer): string {
  if (contains(a, b) || contains(b, a)) return 'The larger slice includes the smaller one, so both its pipeline and its quota include the smaller slice.';
  const separate = separateKind(a, b);
  if (separate) {
    const [, plural, one] = separate;
    return `The two ${plural} are separate: each figure is its own ${one}'s pipeline over its own ${one}'s quota, and neither includes the other.`;
  }
  return "The two slices cover different deals and quota, and may overlap. Each figure is its own slice's pipeline over its own quota.";
}

const COMBINING = "Coverage is total open pipeline over total quota. A combined figure is not the average of each team's coverage.";

/** One figure: the asker's own, with the reasons any two coverage figures can legitimately differ. */
function ownScope(a: Answer): { summary: string; reasons: string[] } {
  const f = a.filters;
  const filters = [...(f.teams ?? []).map((t) => `${t}'s team`), ...(f.people ?? [])];
  return {
    summary: [
      `${a.narrative} It covers ${scopeOf(a)}.`,
      `Every coverage figure in this copilot uses the same definition, ${a.metric.name} v${a.metric.version}: ${a.metric.definition}`,
      "I can't see or check a figure from outside your scope, so I can't say which reason applies to another number. Two coverage figures differ when one of these differs:",
    ].join(' '),
    reasons: [
      `Scope: each person's figure covers only the regions and teams they may see. Yours covers ${scopeOf(a)}.`,
      `Quarter: coverage uses one quarter's quota and the deals expected to close in it. Yours is ${quarter(a)}.`,
      `Filters: a region, rep or team filter narrows both the pipeline and the quota. ${filters.length ? `Yours is filtered to ${filters.join(', ')}.` : 'Yours has none.'}`,
      `Data: figures from different data loads can differ. Yours is from snapshot ${a.provenance.snapshotId}, as of ${a.provenance.asOfDate}.`,
      'Definition: a figure worked out outside this copilot, for example in a spreadsheet, may not use this definition.',
      COMBINING,
    ],
  };
}

function compared(a: Answer, b: Answer, verdict: Verdict): { summary: string; reasons: string[] } {
  const same = `Both figures use ${a.metric.name} v${a.metric.version}`;
  const data = `the same data (snapshot ${a.provenance.snapshotId})`;
  switch (verdict) {
    case 'same_definition_different_scope':
      if (JSON.stringify(a.rows) === JSON.stringify(b.rows)) {
        const summary = `${same}, the same quarter and ${data}. ${sliceLabel(a)} and ${sliceLabel(b)} cover the same pipeline and quota, so the figure is the same: ${figure(a)}.`;
        return { summary, reasons: [] };
      }
      return {
        summary: `${same}, the same quarter (${a.filters.period?.label}) and ${data}. They differ only in scope: ${sliceLabel(a)} is ${figure(a)}, and ${sliceLabel(b)} is ${figure(b)}.`,
        reasons: [scopeReason(a, b), COMBINING],
      };
    case 'different_period':
      return {
        summary: `${same} and ${data}, for ${sliceLabel(a)}. They differ only in quarter: ${quarter(a)} is ${figure(a)}, and ${quarter(b)} is ${figure(b)}.`,
        reasons: ['Each quarter has its own quota and its own deals expected to close in it.', COMBINING],
      };
    case 'same_inputs':
      return { summary: `Both requests cover the same slice, quarter and data, so they give the same figure: ${figure(a)}.`, reasons: [] };
    case 'different_metric':
      return { summary: `These figures use different metric definitions (${a.metric.name} v${a.metric.version} and ${b.metric.name} v${b.metric.version}), so they are not comparable.`, reasons: [] };
    case 'different_snapshot':
      return { summary: `These figures come from different data loads (${a.provenance.snapshotId} and ${b.provenance.snapshotId}), so they can differ.`, reasons: [] };
    default:
      return { summary: `These figures do not reconcile: see the failed checks. This should not happen; report it to ${a.metric.owner}.`, reasons: [] };
  }
}

/**
 * "Why is A higher than B?" when A is not higher (user test, Oct 31): the first sentence says which way the figures
 * really go, from the rows. Null when the question has it right, or when the two figures are the same rows, which the
 * summary already says. `byPeriod` names each figure by its quarter instead of its slice.
 */
export function premiseCorrection(subject: Answer, object: Answer, saidHigher: boolean, byPeriod: boolean): string | null {
  const [s, o] = [parts(subject)?.v, parts(object)?.v];
  if (s == null || o == null || JSON.stringify(subject.rows) === JSON.stringify(object.rows)) return null;
  const label = (a: Answer) => (byPeriod ? (a.filters.period?.label ?? '') : sliceLabel(a));
  const [said, really] = saidHigher ? ['higher', 'lower'] : ['lower', 'higher'];
  if (s.toFixed(2) === o.toFixed(2)) {
    return `Coverage for ${label(subject)} and for ${label(object)} rounds to the same figure, ${s.toFixed(2)}x, so neither is clearly ${said}.`;
  }
  if (s > o === saidHigher) return null;
  return `Coverage for ${label(subject)} is ${really} than for ${label(object)}, not ${said}: ${s.toFixed(2)}x against ${o.toFixed(2)}x.`;
}

/** The explanation's sentences and checks. Figures come only from the answers' rows. */
export function explanationText(a: Answer, b: Answer | null, verdict: Verdict | null, numerators: boolean[]) {
  const text = b && verdict ? compared(a, b, verdict) : ownScope(a);
  return { ...text, checks: checksFor(b ? [a, b] : [a], numerators, verdict === 'different_period') };
}
