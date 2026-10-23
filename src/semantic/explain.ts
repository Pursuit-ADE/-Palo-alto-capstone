// "Why is my number different?" for pipeline coverage: a fixed, deterministic explanation, never model text.
// It runs before the intent model, so both models answer it the same way (the F10 pattern), and it only queries
// inside the asker's own scope. A figure someone else sees is never fetched, checked or repeated back (decision D1
// in the readiness audit: the conservative default until the client says otherwise).
import type { Database } from '../db/client';
import { catalog, QUOTA_PERIODS } from '../db/seed';
import type { Registry } from '../registry/load';
import type { Intent } from '../registry/types';
import { classify, explanationText, type Verdict } from './explain-text';
import { currentSnapshot, run, type Answer, type AuditFields } from './governed';
import { findPeriods, quotaBlocked, readSelectors } from './normalize';
import { resolvePeriod } from './periods';
import { ALL_REGIONS, type Principal } from './scope';

export const EXPLAINED_METRIC = 'pipeline_coverage';

export interface Explanation {
  kind: 'explanation';
  /** The asker's figure, or the first of two figures that are both inside the asker's scope. */
  answer: Answer;
  /** The second figure, only when the asker may see both; null when the other number is someone else's. */
  other: Answer | null;
  /** How the two figures differ, from their inputs; null when there is only one figure. */
  verdict: Verdict | null;
  /** Fixed sentences built from the rows and the registry, never from a model or from numbers in the question. */
  summary: string;
  reasons: string[];
  /** Arithmetic checks that each figure reconciles: value = numerator / denominator, numerator = open pipeline. */
  checks: { label: string; ok: boolean }[];
}

type Clarify = { kind: 'clarify'; question: string };
type Region = NonNullable<Intent['filters']['regions']>[number];

const WHY = / (why|how come|explain|reason|reasons) /;
const DIFFERENCE =
  / (different|differ|differs|difference|discrepancy|mismatch|match|matches|higher|lower|bigger|smaller|than|versus|vs|say|says|said|show|shows|showing|see|sees|seeing|get|gets|got|report|reports|reported) /;
const THIS_NUMBER = / (this|that|my|our|the) (number|figure|ratio|result) /;
/** A ratio someone else quoted ("3x", "0.5 x"). Never read as a filter or an amount, and never repeated back. */
const QUOTED_RATIO = /\b\d+(?:\.\d+)?\s*x\b/gi;
const SECTOR_CUE = /\b(sector|sectors|industry|industries|vertical|verticals)\b/i;
const STAGE_WORDS = / (prospecting|engaging|won|lost) /;

function clean(phrase: string): string {
  return ` ${phrase.replace(QUOTED_RATIO, ' ').toLowerCase().replace(/[^a-z0-9-]+/g, ' ').trim()} `;
}

/** A "why is my coverage different / why does X say 3x" question, or "why is this number different" right after coverage. */
export function isDiscrepancyQuestion(phrase: string, registry: Registry, previous?: Intent): boolean {
  const text = clean(phrase);
  if (!WHY.test(text) || !DIFFERENCE.test(text)) return false;
  const metric = registry.metrics.get(EXPLAINED_METRIC);
  const names = metric ? [metric.name.toLowerCase(), ...metric.synonyms.map((s) => s.toLowerCase())] : [];
  if (names.some((n) => text.includes(` ${n} `))) return true;
  return previous?.metric === EXPLAINED_METRIC && THIS_NUMBER.test(text);
}

/**
 * The question with the parts that are about someone else's number removed: quoted ratios, and everyday words that
 * are also sector names ("marketing says…"). Coverage can't be filtered by sector, so a question that does say
 * "sector" keeps them and is asked back below.
 */
function selectorPhrase(phrase: string): string {
  let text = phrase.replace(QUOTED_RATIO, ' ');
  if (SECTOR_CUE.test(text)) return text;
  for (const sector of new Set(catalog().accounts.map((a) => a.sector))) {
    text = text.replace(new RegExp(`\\b${sector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' ');
  }
  return text;
}

/** The slice the question names inside the asker's scope (regions, reps, a manager's team), or a clarifying question. */
function namedSlice(phrase: string): Intent['filters'] | Clarify {
  const text = clean(phrase);
  if (STAGE_WORDS.test(text)) return { kind: 'clarify', question: 'Pipeline coverage counts every open stage, so it cannot be split by stage. Ask about open pipeline by stage instead.' };
  const read = readSelectors(selectorPhrase(phrase));
  if (read.clarify) return { kind: 'clarify', question: read.clarify };
  const blocked = quotaBlocked(read.filters);
  if (blocked) return { kind: 'clarify', question: blocked };
  const filters: Intent['filters'] = {};
  const regions = ALL_REGIONS.filter((r): r is Region => text.includes(` ${r} `));
  if (regions.length) filters.regions = regions;
  if (read.filters.people?.length) filters.people = read.filters.people;
  if (read.filters.teams?.length) filters.teams = read.filters.teams;
  return filters;
}

const isClarify = (x: object): x is Clarify => 'kind' in x && x.kind === 'clarify';

/** The one or two coverage requests to run. Both are re-scoped by the compiler, so neither can leave the asker's scope. */
function plan(phrase: string, registry: Registry, asOfDate: string, previous?: Intent): { first: Intent; second: Intent | null } | Clarify {
  const periods = findPeriods(clean(phrase), registry.glossary, asOfDate);
  if (periods.unsupported || periods.labels.size > 2) {
    return { kind: 'clarify', question: `I can only explain coverage for ${QUOTA_PERIODS.map((p) => p.period).join(' and ')}. Which do you mean?` };
  }
  const slice = namedSlice(phrase);
  if (isClarify(slice)) return slice;
  const named = Object.keys(slice).length > 0;
  // A "why is this number different?" follow-up explains the previous coverage answer, with its filters.
  const base: Intent['filters'] = !named && previous?.metric === EXPLAINED_METRIC ? { ...previous.filters } : slice;
  const coverage = (filters: Intent['filters']): Intent => ({ metric: EXPLAINED_METRIC, filters, groupBy: [] });
  const [p1, p2] = [...periods.labels].sort();
  if (p1 && p2) return { first: coverage({ ...base, period: p1 }), second: coverage({ ...base, period: p2 }) };
  const period = p1 ?? base.period ?? resolvePeriod('current', asOfDate);
  if (!period) return { kind: 'clarify', question: 'Pipeline coverage needs a period. Which quarter do you mean?' };
  // A named slice is compared with the asker's whole scope; both are figures the asker may already see.
  return { first: coverage({ ...base, period }), second: named ? coverage({ period }) : null };
}

/** The coverage numerator recomputed as its own governed metric, for the same slice and quarter. */
async function numeratorMatches(database: Database, registry: Registry, principal: Principal, a: Answer): Promise<boolean> {
  const metric = registry.metrics.get(EXPLAINED_METRIC);
  const row = a.rows[0];
  if (!metric || metric.kind !== 'ratio' || !row) return false;
  const { period, regions, people, teams } = (a.intent as Intent).filters;
  const filters: Intent['filters'] = { ...(period ? { period } : {}), ...(regions ? { regions } : {}), ...(people ? { people } : {}), ...(teams ? { teams } : {}) };
  const check = await run(database, registry, principal, { metric: metric.numerator, filters, groupBy: [] }, {});
  return Number(check.rows[0]?.value ?? 0) === Number(row.numerator ?? 0);
}

/** Answers a discrepancy question (see isDiscrepancyQuestion). Called inside the audited request in ask(). */
export async function explainDiscrepancy(
  database: Database,
  registry: Registry,
  principal: Principal,
  phrase: string,
  previous: Intent | undefined,
  fields: AuditFields,
): Promise<Explanation | Clarify> {
  const snapshot = await currentSnapshot(database);
  if (!snapshot) throw new Error('No data snapshot loaded');
  const p = plan(phrase, registry, snapshot.asOfDate, previous);
  if (isClarify(p)) return p;
  const answer = await run(database, registry, principal, p.first, fields);
  const second: AuditFields = {};
  const other = p.second ? await run(database, registry, principal, p.second, second) : null;
  const sides = other ? [answer, other] : [answer];
  const numerators = await Promise.all(sides.map((a) => numeratorMatches(database, registry, principal, a)));
  const verdict = other ? classify(answer, other, numerators) : null;
  // The audit row records every region queried; all of them are inside the asker's scope.
  fields.regions = [...new Set([...(fields.regions ?? []), ...(second.regions ?? [])])].sort();
  fields.reason = `explanation:${verdict ?? 'own_scope'}`;
  return { kind: 'explanation', answer, other, verdict, ...explanationText(answer, other, verdict, numerators) };
}
