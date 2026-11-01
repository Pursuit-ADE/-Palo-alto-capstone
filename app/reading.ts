// How an answer read the question, in words: the filters it applied, shared by the provenance panel and the Read as line.
import type { Answer } from '@/semantic/answer';
import { dateRange } from './format';

const titleCase = (s: string) => s.replace(/^./, (c) => c.toUpperCase());
const list = (xs: string[]) => xs.join(', ').replace(/, ([^,]*)$/, ' and $1');
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

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
 */
export function readingParts(a: Answer): string[] {
  const f = a.filters;
  return [
    f.period ? `${f.period.label} (${dateRange(f.period.start, f.period.end)})` : 'Any expected close date',
    `${list(f.regions.map(titleCase))} region${f.regions.length > 1 ? 's' : ''}`,
    f.stages ? `stage ${list(f.stages)}` : null,
    f.amount ? amountText(f.amount) : null,
    f.products?.length ? `product ${list(f.products)}` : null,
    f.accounts?.length ? `account ${list(f.accounts)}` : null,
    f.sectors?.length ? `sector ${list(f.sectors)}` : null,
    f.people?.length ? `rep ${list(f.people)}` : null,
    f.teams?.length ? list(f.teams.map((name) => `${name}'s team`)) : null,
    f.groupBy.length ? `by ${list(f.groupBy)}` : null,
  ].filter((part): part is string => part !== null);
}
