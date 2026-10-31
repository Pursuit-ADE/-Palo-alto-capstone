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
/** "How much higher is my coverage than the company's?" asks about a gap without saying why (PR #51 review). */
const HOW_MUCH = / how much (higher|lower|bigger|smaller|more|less|better|worse) /;
const DIFFERENCE =
  / (different|differ|differs|difference|discrepancy|mismatch|match|matches|higher|lower|bigger|smaller|than|versus|vs|say|says|said|show|shows|showing|see|sees|seeing|get|gets|got|report|reports|reported) /;
const THIS_NUMBER = / (this|that|my|our|the) (number|figure|ratio|result) /;
/** "Why is mine 0.52x when the company is 0.65x?" sets two figures side by side without a comparison word (user test, Oct 29). */
const SET_AGAINST = / (when|while|whereas|but) /;
/** A ratio someone else quoted ("3x", "0.5 x"). Never read as a filter or an amount, and never repeated back. */
const QUOTED_RATIO = /\b\d+(?:\.\d+)?\s*x\b/gi;
/** The same pattern without the g flag, so .test() keeps no state between calls. */
const HAS_QUOTED_RATIO = new RegExp(QUOTED_RATIO.source, 'i');
const SECTOR_CUE = /\b(sector|sectors|industry|industries|vertical|verticals)\b/i;
const STAGE_WORDS = / (prospecting|engaging|won|lost) /;
/**
 * Words that point at a figure someone else holds ("marketing says…", "the company number"). With one of these,
 * a single named quarter is the asker's own figure for that quarter, not a request to compare two quarters.
 */
const OTHER_FIGURE =
  / (marketing|sales|finance|leadership|company|companys|everyone|everybody|whole|overall|total|dashboard|report|spreadsheet|someone|somebody|they|their|them|he|she|his|her|manager|boss|say|says|said) /;

/** The question is about a figure someone else holds: it names one (OTHER_FIGURE) or quotes a ratio. */
const pointsElsewhere = (phrase: string) => OTHER_FIGURE.test(clean(phrase)) || HAS_QUOTED_RATIO.test(phrase);

function clean(phrase: string): string {
  return ` ${phrase.replace(QUOTED_RATIO, ' ').toLowerCase().replace(/[^a-z0-9-]+/g, ' ').trim()} `;
}

/** A "why is my coverage different / why does X say 3x" question, or "why is this number different" right after coverage. */
export function isDiscrepancyQuestion(phrase: string, registry: Registry, previous?: Intent): boolean {
  const text = clean(phrase);
  const compared = DIFFERENCE.test(text) || (SET_AGAINST.test(text) && pointsElsewhere(phrase));
  if (!(WHY.test(text) || HOW_MUCH.test(text)) || !compared) return false;
  const names = (id: string) => {
    const m = registry.metrics.get(id);
    return m ? [m.name.toLowerCase(), ...m.synonyms.map((s) => s.toLowerCase())] : [];
  };
  const says = (id: string) => names(id).some((n) => text.includes(` ${n} `));
  if (says(EXPLAINED_METRIC)) return true;
  // Coverage is the only metric written as "3x", so a quoted ratio names it, unless the question names another
  // metric ("my pipeline is 3x bigger", where 3x is a multiplier). The deck's wording has no "coverage" (Oct 29).
  if (HAS_QUOTED_RATIO.test(phrase) && ![...registry.metrics.keys()].some((id) => id !== EXPLAINED_METRIC && says(id))) return true;
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

/** A capitalised name with 's ("Jordan's", "Cara Losch's"). */
const POSSESSIVE = /\b([A-Z][A-Za-z.-]*(?:\s+[A-Z][A-Za-z.-]*)*)['’]s\b/g;

/**
 * "Why is Jordan's coverage 0.52x…": a possessive name that is not a rep, team or region the question resolved.
 * readSelectors only catches unknown names after "for", "at" and the like, so this one would be dropped and the
 * analyst's whole scope explained instead (user test, Oct 29; PRD A2). Someone else's figure ("Marketing's") is fine.
 */
function unknownPossessive(phrase: string, resolved: string[]): string | null {
  for (const m of phrase.matchAll(POSSESSIVE)) {
    const name = m[1]!;
    const lower = name.toLowerCase();
    if (OTHER_FIGURE.test(` ${lower} `)) continue;
    if (resolved.some((r) => r.toLowerCase().includes(lower) || lower.includes(r.toLowerCase()))) continue;
    return name;
  }
  return null;
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
  const unknown = unknownPossessive(phrase, [...regions, ...(read.filters.people ?? []), ...(read.filters.teams ?? [])]);
  if (unknown) return { kind: 'clarify', question: `I don't know "${unknown}", so I won't explain the figure for everything. Name a sales rep, a manager's team or a region in the data.` };
  if (regions.length) filters.regions = regions;
  if (read.filters.people?.length) filters.people = read.filters.people;
  if (read.filters.teams?.length) filters.teams = read.filters.teams;
  return filters;
}

const isClarify = (x: object): x is Clarify => 'kind' in x && x.kind === 'clarify';

type Piece = Pick<Intent['filters'], 'regions' | 'people' | 'teams'>;

/** Each region, rep or team the question names as a slice of its own, in the order the question names them. */
function namedPieces(slice: Intent['filters'], text: string): Piece[] {
  const at = (name: string) => text.indexOf(clean(name));
  const pieces: { at: number; piece: Piece }[] = [
    ...(slice.regions ?? []).map((r) => ({ at: at(r), piece: { regions: [r] } })),
    ...(slice.people ?? []).map((p) => ({ at: at(p), piece: { people: [p] } })),
    ...(slice.teams ?? []).map((t) => ({ at: at(t), piece: { teams: [t] } })),
  ];
  return pieces.sort((a, b) => a.at - b.at).map((p) => p.piece);
}

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
  const current = resolvePeriod('current', asOfDate);
  const period = p1 ?? base.period ?? current;
  if (!period) return { kind: 'clarify', question: 'Pipeline coverage needs a period. Which quarter do you mean?' };
  // "Why is coverage different next quarter?" compares the current quarter with the named one, inside the same slice.
  // Not when the question points at someone else's figure: then the named quarter is just the asker's own figure.
  if (p1 && current && p1 !== current && !named && !pointsElsewhere(phrase)) {
    return { first: coverage({ ...base, period: current }), second: coverage({ ...base, period: p1 }) };
  }
  // Two named slices ("east than west", two teams, two reps) are compared with each other in the order named, not
  // combined into one slice and compared with everything (PR #50 review). An explanation compares two figures, so
  // three or more are asked back.
  const pieces = namedPieces(slice, clean(phrase));
  if (pieces.length > 2) return { kind: 'clarify', question: 'I can explain coverage for two slices at a time. Which two do you want to compare?' };
  const [s1, s2] = pieces;
  if (s1 && s2) return { first: coverage({ ...s1, period }), second: coverage({ ...s2, period }) };
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

const sameQuarter = (a: Answer, b: Answer) => a.filters.period?.label === b.filters.period?.label;

/** Answers a discrepancy question (see isDiscrepancyQuestion). Called inside the audited request in ask(). */
export async function explainDiscrepancy(
  database: Database,
  registry: Registry,
  principal: Principal,
  phrase: string,
  previous: Intent | undefined,
  fields: AuditFields,
  linked: AuditFields[] = [],
): Promise<Explanation | Clarify> {
  const snapshot = await currentSnapshot(database);
  if (!snapshot) throw new Error('No data snapshot loaded');
  const p = plan(phrase, registry, snapshot.asOfDate, previous);
  if (isClarify(p)) return p;
  const answer = await run(database, registry, principal, p.first, fields);
  const second: AuditFields = {};
  const run2 = p.second ? await run(database, registry, principal, p.second, second) : null;
  // A named slice that is the asker's whole scope ("Cara Losch's team" for someone who sees only that team), compared
  // with someone else's figure ("the whole company"), means that figure is outside the scope: explain the asker's own
  // figure instead of comparing the slice with itself. Compared with "mine", the same figure is the right answer.
  const sameSlice = run2 && run2.scope === answer.scope && JSON.stringify(run2.rows) === JSON.stringify(answer.rows) && sameQuarter(answer, run2);
  const other = run2 && !(sameSlice && pointsElsewhere(phrase)) ? run2 : null;
  const sides = other ? [answer, other] : [answer];
  const numerators = await Promise.all(sides.map((a) => numeratorMatches(database, registry, principal, a)));
  const verdict = other ? classify(answer, other, numerators) : null;
  fields.reason = `explanation:${verdict ?? 'own_scope'}`;
  // The second figure gets its own audit row (same request id), so each side of a comparison can be replayed from
  // the log: intent, metric version, regions, snapshot and result hash (PR #50 review).
  if (other) linked.push({ ...second, role: fields.role, reason: 'explanation:second_figure' });
  return { kind: 'explanation', answer, other, verdict, ...explanationText(answer, other, verdict, numerators) };
}
