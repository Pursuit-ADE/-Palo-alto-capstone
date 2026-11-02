// How an answer read the question, in words: the filters it applied, shared by the provenance panel and the Read as line.
import type { Answer } from '@/semantic/answer';
import { ALL_REGIONS } from '@/semantic/regions';
import { dateRange } from './format';

const titleCase = (s: string) => s.replace(/^./, (c) => c.toUpperCase());
const list = (xs: string[]) => xs.join(', ').replace(/, ([^,]*)$/, ' and $1');
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** "all regions" for the whole company, matching the Scope row's "all teams"; otherwise the regions by name. */
const regionText = (regions: string[]) =>
  ALL_REGIONS.every((r) => regions.includes(r)) ? 'all regions' : `${list(regions.map(titleCase))} region${regions.length > 1 ? 's' : ''}`;

function amountText(amount: NonNullable<Answer['filters']['amount']>): string {
  if (amount.min != null && amount.max != null && amount.min === amount.max && amount.minInclusive !== false && amount.maxInclusive !== false) return `amount ${money(amount.min)}`;
  const bits: string[] = [];
  if (amount.min != null) bits.push(`${amount.minInclusive === false ? 'over' : 'at least'} ${money(amount.min)}`);
  if (amount.max != null) bits.push(`${amount.maxInclusive === false ? 'under' : 'at most'} ${money(amount.max)}`);
  return bits.join(' and ');
}

/**
 * The filters an answer applied after scoping, as short phrases in a fixed order. Built only from the validated, scoped
 * answer, never from the typed question, so every surface that shows it reads the same (receipts design, Nov 1).
 * Lower case throughout, so it reads as one line after "Read as:" as well as in the panel's Filters row (review, Nov 1).
 */
export function readingParts(a: Answer): string[] {
  const f = a.filters;
  return [
    f.period ? `${f.period.label} (${dateRange(f.period.start, f.period.end)})` : 'any expected close date',
    regionText(f.regions),
    f.stages ? `stage ${list(f.stages)}` : null,
    f.amount ? amountText(f.amount) : null,
    f.products?.length ? `product ${list(f.products)}` : null,
    f.accounts?.length ? `account ${list(f.accounts)}` : null,
    f.sectors?.length ? `sector ${list(f.sectors)}` : null,
    f.people?.length ? `rep ${list(f.people)}` : null,
    f.teams?.length ? list(f.teams.map((name) => `${name}'s team`)) : null,
    // Breakdowns in the answer's own words ("by owner", as the answer, chart heading and chips say). It said "by rep"
    // under "Open pipeline by owner: …" (UX review, Nov 2); typing "by rep" still works through the glossary.
    f.groupBy.length ? `by ${list(f.groupBy)}` : null,
  ].filter((part): part is string => part !== null);
}

/**
 * The slice in a scope sentence ("Scope: East region, Cara Losch's team (6 reps)." gives "Cara Losch's team (6 reps)"),
 * or null for the whole company's "all teams". The sentence's form is scopeStatement() in src/semantic/scope.ts.
 */
export function narrowerSlice(scope: string): string | null {
  const slice = /^Scope: .+? regions?, (.+)\.$/.exec(scope)?.[1];
  return slice && slice !== 'all teams' ? slice : null;
}

/**
 * The whole Read as line: the metric and version, then the reading, with a narrower slice named beside its region. Without
 * the slice, "East region" right above the number would read as all of East when it is one team's (review, Nov 1).
 */
export function readAs(a: Answer): string {
  const parts = readingParts(a);
  const slice = narrowerSlice(a.scope);
  // The regions are always the second part, after the period.
  if (slice) parts[1] = `${slice}, ${parts[1]}`;
  return [`${a.metric.name} v${a.metric.version}`, ...parts].join(' · ');
}
