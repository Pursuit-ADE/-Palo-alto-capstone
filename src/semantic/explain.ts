// "Why is my number different?" for pipeline coverage: a fixed, deterministic explanation, never model text.
// It runs before the intent model, so both models answer it the same way (the F10 pattern), and it only queries
// inside the asker's own scope. A figure someone else sees is never fetched, checked or repeated back (decision D1
// in the readiness audit: the conservative default until the client says otherwise).
import type { Database } from '../db/client';
import { catalog, QUOTA_PERIODS } from '../db/seed';
import type { Registry } from '../registry/load';
import type { Intent } from '../registry/types';
import { classify, explanationText, premiseCorrection, type Verdict } from './explain-text';
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

/** Asks for coverage split by something ("by region"): a breakdown request, not a comparison (#50 review, Oct 31). */
const BREAKDOWN = / (by|per|for each|across) (region|regions|rep|reps|owner|owners|team|teams|stage|stages|manager|managers) /;
/** Words right before a quoted ratio that make it the figure itself: "marketing says 3x", "mine is 0.5x", "we're at 3x". */
const RATIO_LEAD = /^(say|says|said|show|shows|showed|showing|report|reports|reported|see|sees|saw|get|gets|got|quote|quotes|quoted|claim|claims|claimed|at|of|is|was|are|be)$/;
/** Who may sit before "is 3x" for the ratio to be a coverage figure: "mine is", "the dashboard is", not "revenue is". */
const RATIO_SUBJECT = /^(mine|ours|yours|theirs|it|that|this|we|i|you|they|coverage|ratio|number|figure|one)$/;
/** Words right after a quoted ratio that make it a multiplier: "2x higher", "2x more deals", "1.5x what finance reports". */
const MULTIPLIER = /^(higher|lower|more|less|bigger|smaller|greater|larger|than|what|as|times|the|growth|faster|slower|better|worse)$/;

/**
 * A quoted ratio that is itself a coverage figure (Oct 29: the deck's "marketing say 3x when mine is 0.5x" has no
 * "coverage"). Not a multiplier ("2x higher", "grew 2x") or a ratio of something else ("revenue is 2x", "my ARR 1.5x").
 */
function quotesCoverage(phrase: string): boolean {
  const words = phrase.toLowerCase().replace(/(\d)\s+x\b/g, '$1x').replace(/['’]re\b/g, ' are').replace(/['’]s\b/g, ' is').split(/[^a-z0-9.]+/).filter(Boolean);
  return words.some((w, i) => {
    if (!/^\d+(?:\.\d+)?x$/.test(w)) return false;
    const [before, after] = [words[i - 1] ?? '', words[i + 1] ?? ''];
    if (MULTIPLIER.test(after) || !RATIO_LEAD.test(before)) return false;
    if (!/^(is|was|are|be)$/.test(before)) return true;
    const subject = words[i - 2] ?? '';
    return RATIO_SUBJECT.test(subject) || OTHER_FIGURE.test(` ${subject} `);
  });
}

/** The cleaned question with every coverage synonym written as "coverage", so "pipeline vs quota" is not read as "vs". */
function withCoverageWords(text: string, registry: Registry): string {
  const m = registry.metrics.get(EXPLAINED_METRIC);
  const names = m ? [m.name.toLowerCase(), ...m.synonyms.map((x) => x.toLowerCase())].sort((a, b) => b.length - a.length) : [];
  return names.reduce((t, n) => t.split(` ${n} `).join(' coverage '), text);
}

/** Whether the question names a governed metric other than coverage ("the number of open deals", "open pipeline"). */
function namesOtherMetric(text: string, registry: Registry): boolean {
  return [...registry.metrics.values()].some(
    (m) => m.id !== EXPLAINED_METRIC && [m.name, ...m.synonyms].some((n) => text.includes(` ${n.toLowerCase()} `)),
  );
}

/** A "why is my coverage different / why does X say 3x" question, or "why is this number different" right after coverage. */
export function isDiscrepancyQuestion(phrase: string, registry: Registry, previous?: Intent): boolean {
  const text = withCoverageWords(clean(phrase), registry);
  const compared = DIFFERENCE.test(text) || (SET_AGAINST.test(text) && pointsElsewhere(phrase));
  if (!(WHY.test(text) || HOW_MUCH.test(text)) || !compared || BREAKDOWN.test(text)) return false;
  if (text.includes(' coverage ')) return true;
  // Coverage is the only metric written as "3x", so a ratio quoted as the figure names it, unless the question names
  // another metric ("my pipeline is 3x bigger", where 3x is a multiplier).
  const other = namesOtherMetric(text, registry);
  if (quotesCoverage(phrase) && !other) return true;
  // "Why is the number of open deals…" after a coverage answer is about open deals, not "this number" (#50 review).
  return previous?.metric === EXPLAINED_METRIC && THIS_NUMBER.test(text) && !other;
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
/** Any single word with 's, in any case ("jordan's", "JORDAN'S", "Jordan’S"); everyday words are skipped below. */
const ANY_POSSESSIVE = /\b([a-z][a-z.-]*)['’]s\b/gi;
/** Capitalised words before 's that are contractions, not names: "Why's my coverage…", "What's the reason…" (review on #50). */
const NOT_A_NAME = new Set(['why', 'what', 'how', 'where', 'who', 'when', 'it', 'that', 'there', 'here', 'this', 'everyone', 'let']);
/** Everyday words that take 's in a coverage question and are not people: "my team's", "this quarter's", "the board's". */
const EVERYDAY = new Set(
  ('team teams company everyone everybody anyone someone somebody nobody quarter quarters year month week today region regions ' +
    'rep reps manager managers boss board deck slide sheet chart dashboard report spreadsheet number figure coverage pipeline quota data ' +
    'org organization department group division unit segment territory sector industry customer customers account accounts partner ' +
    'market business forecast plan target goal one other he she').split(' '),
);

/**
 * "Why is Jordan's coverage 0.52x…": a possessive name that is not a rep, team or region the question resolved.
 * readSelectors only catches unknown names after "for", "at" and the like, so this one would be dropped and the
 * analyst's whole scope explained instead (user test, Oct 29; PRD A2). Someone else's figure ("Marketing's") is fine.
 * Lower-case and all-caps names count too (#50 review, Oct 31).
 */
function unknownPossessive(phrase: string, resolved: string[]): string | null {
  const known = (lower: string) =>
    OTHER_FIGURE.test(` ${lower} `) || resolved.some((r) => r.toLowerCase().includes(lower) || lower.includes(r.toLowerCase()));
  for (const m of phrase.matchAll(POSSESSIVE)) {
    const words = m[1]!.split(/\s+/);
    while (words.length && NOT_A_NAME.has(words[0]!.toLowerCase())) words.shift();
    if (words.length && !known(words.join(' ').toLowerCase())) return words.join(' ');
  }
  for (const m of phrase.matchAll(ANY_POSSESSIVE)) {
    const lower = m[1]!.toLowerCase();
    if (!NOT_A_NAME.has(lower) && !EVERYDAY.has(lower) && !known(lower)) return m[1]!;
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
  // A fixed sentence: a refusal never repeats typed text back (evaluator B-03, Low).
  if (unknown) return { kind: 'clarify', question: "I don't know that person or team, so I won't explain the figure for everything. Name a sales rep, a manager's team or a region in the data." };
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

const coverageIntent = (filters: Intent['filters']): Intent => ({ metric: EXPLAINED_METRIC, filters, groupBy: [] });
type Plan = { first: Intent; second: Intent | null };

/**
 * "Why is this number higher than West / than this quarter?" right after a coverage answer: that answer against the
 * figure the question names, not the named figure against everything (#50 review, Oct 31). Null when it names neither.
 */
function thisNumberPlan(previous: Intent, pieces: Piece[], label: string | undefined, current: string | undefined): Plan | null {
  const prev = { ...previous.filters, period: previous.filters.period ?? current };
  const [piece] = pieces;
  if (pieces.length === 1 && piece) return { first: coverageIntent(prev), second: coverageIntent({ ...piece, period: label ?? prev.period }) };
  if (!pieces.length && label && label !== prev.period) return { first: coverageIntent(prev), second: coverageIntent({ ...previous.filters, period: label }) };
  return null;
}

/**
 * Questions that name more figures than one explanation compares. Two named slices ("east than west") are compared
 * with each other in the order named (PR #50 review), but three or more are asked back. So are two quarters with two
 * figures ("east this quarter than west next quarter", "mine this quarter than the company's next"): merging them
 * would explain figures nobody named (#50 review, Oct 31).
 */
function askBack(pieces: Piece[], twoQuarters: boolean, phrase: string): Clarify | null {
  if (pieces.length > 2) return { kind: 'clarify', question: 'I can explain coverage for two slices at a time. Which two do you want to compare?' };
  if (twoQuarters && (pieces.length > 1 || pointsElsewhere(phrase))) {
    return { kind: 'clarify', question: 'I can compare one slice across two quarters, or two slices in the same quarter. Which do you want?' };
  }
  return null;
}

/** The one or two coverage requests to run. Both are re-scoped by the compiler, so neither can leave the asker's scope. */
function plan(phrase: string, registry: Registry, asOfDate: string, previous?: Intent): Plan | Clarify {
  const text = clean(phrase);
  const periods = findPeriods(text, registry.glossary, asOfDate);
  const slice = periods.unsupported || periods.labels.size > 2 ? null : namedSlice(phrase);
  if (!slice) return { kind: 'clarify', question: `I can only explain coverage for ${QUOTA_PERIODS.map((p) => p.period).join(' and ')}. Which do you mean?` };
  if (isClarify(slice)) return slice;
  const named = Object.keys(slice).length > 0;
  const pieces = namedPieces(slice, text);
  const [p1, p2] = [...periods.labels].sort();
  const tooMany = askBack(pieces, Boolean(p2), phrase);
  if (tooMany) return tooMany;
  const current = resolvePeriod('current', asOfDate);
  if (previous?.metric === EXPLAINED_METRIC && THIS_NUMBER.test(text) && !p2) {
    const followUp = thisNumberPlan(previous, pieces, p1, current);
    if (followUp) return followUp;
  }
  // A "why is this number different?" follow-up explains the previous coverage answer, with its filters.
  const base: Intent['filters'] = !named && previous?.metric === EXPLAINED_METRIC ? { ...previous.filters } : slice;
  return planFor(base, pieces, named, [p1, p2], current, phrase);
}

/**
 * The figures for a question whose slices and quarters are known: two quarters, this quarter against another, two
 * slices, or a slice against the asker's whole scope.
 */
function planFor(base: Intent['filters'], pieces: Piece[], named: boolean, [p1, p2]: (string | undefined)[], current: string | undefined, phrase: string): Plan | Clarify {
  if (p1 && p2) return { first: coverageIntent({ ...base, period: p1 }), second: coverageIntent({ ...base, period: p2 }) };
  const period = p1 ?? base.period ?? current;
  if (!period) return { kind: 'clarify', question: 'Pipeline coverage needs a period. Which quarter do you mean?' };
  // "Why is coverage different next quarter?" compares the current quarter with the named one, inside the same slice.
  // Not when the question points at someone else's figure: then the named quarter is just the asker's own figure.
  if (p1 && current && p1 !== current && !named && !pointsElsewhere(phrase)) {
    return { first: coverageIntent({ ...base, period: current }), second: coverageIntent({ ...base, period: p1 }) };
  }
  const [s1, s2] = pieces;
  if (s1 && s2) return { first: coverageIntent({ ...s1, period }), second: coverageIntent({ ...s2, period }) };
  // A named slice is compared with the asker's whole scope; both are figures the asker may already see.
  return { first: coverageIntent({ ...base, period }), second: named ? coverageIntent({ period }) : null };
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

type Half = 'before' | 'after' | null;

/** Whether the first figure is the one before "than". Both figures must be placed, on different sides, or it's unclear. */
function namedFirst(a: Half, b: Half): boolean | null {
  if (a === 'before' && b === 'after') return true;
  if (a === 'after' && b === 'before') return false;
  return null;
}

const HIGHER = / (higher|bigger|greater|more|better|stronger) /;
const LOWER = / (lower|smaller|less|worse|weaker) /;
/** A direction word about another quantity ("more pipeline than", "more quota than") is not a claim about coverage. */
const OTHER_QUANTITY = / (pipeline|quota|deal|deals|opportunity|opportunities|revenue|bookings|amount|count|value|dollars) /;
/** Words that name the asker's whole scope as a figure: "the company's", "everyone's", "mine". */
const WHOLE = / (company|companys|everyone|everybody|overall|whole|total|everything|all teams|all regions|mine|ours|my team|our team) /;
/** Words that make the other side someone else's figure or no figure at all: "marketing's number", "than expected". */
const NOT_OURS =
  / (marketing|finance|sales|leadership|dashboard|report|reports|reported|spreadsheet|someone|somebody|they|their|them|manager|boss|say|says|said|expected|expect|target|goal|plan|forecast|thought) /;

/** The asker's whole scope as one side of "than": only with a WHOLE word and nothing that makes it someone else's figure. */
function wholeHalf(before: string, after: string): Half {
  const here = (t: string) => WHOLE.test(t) && !NOT_OURS.test(t);
  return sideOf(here(before), here(after));
}

/** Which side of "than" names this figure: in only one half, or neither when both or none do. */
const sideOf = (inBefore: boolean, inAfter: boolean): Half => {
  if (inBefore === inAfter) return null;
  return inBefore ? 'before' : 'after';
};

/** Where a figure is named: by its quarter when the two differ by quarter, else by its own names or "the company". */
function placeSide(side: Answer, before: string, after: string, byPeriod: boolean, registry: Registry, asOfDate: string): Half {
  if (byPeriod) {
    const label = side.filters.period?.label ?? '';
    const [x, y] = [before, after].map((t) => findPeriods(t, registry.glossary, asOfDate).labels.has(label));
    return sideOf(Boolean(x), Boolean(y));
  }
  const f = (side.intent as Intent).filters;
  const names = [...(f.regions ?? []), ...(f.people ?? []), ...(f.teams ?? [])].map((n) => clean(n));
  if (!names.length) return wholeHalf(before, after);
  const [x, y] = [before, after].map((t) => names.some((n) => t.includes(n)));
  return sideOf(Boolean(x), Boolean(y));
}

/**
 * Which figure "Why is A higher than B?" says is higher or lower: the one named before "than". Each figure is found by
 * its own names (region, rep, team), by its quarter when the two differ by quarter, or, for the asker's whole scope, by a
 * word such as "company". Null unless the question has one "than", a direction word about coverage before it, and
 * names both figures on different sides of it (#50 review, Oct 31: "than expected", "than 0.4x", "more pipeline than").
 */
function claimed(phrase: string, registry: Registry, asOfDate: string, a: Answer, b: Answer): { subject: Answer; object: Answer; higher: boolean } | null {
  const halves = withCoverageWords(clean(phrase), registry).split(' than ');
  if (halves.length !== 2) return null;
  const [before, after] = [`${halves[0]} `, ` ${halves[1]}`];
  const [up, down] = [HIGHER.test(before), LOWER.test(before)];
  if (up === down || !before.includes(' coverage ') || OTHER_QUANTITY.test(before) || OTHER_QUANTITY.test(after)) return null;
  const byPeriod = !sameQuarter(a, b);
  const half = (side: Answer) => placeSide(side, before, after, byPeriod, registry, asOfDate);
  const aFirst = namedFirst(half(a), half(b));
  if (aFirst === null) return null;
  return aFirst ? { subject: a, object: b, higher: up } : { subject: b, object: a, higher: up };
}

/**
 * A wrong direction in the question ("higher" when it is lower), corrected before anything else. Only between two
 * figures the asker may see, and only when both reconcile: a failed check is the first thing to say then.
 */
function directionCorrection(phrase: string, registry: Registry, asOfDate: string, a: Answer, b: Answer, verdict: Verdict): string | null {
  if (verdict !== 'same_definition_different_scope' && verdict !== 'different_period') return null;
  const claim = claimed(phrase, registry, asOfDate, a, b);
  return claim ? premiseCorrection(claim.subject, claim.object, claim.higher, verdict === 'different_period') : null;
}

const hasSlice = (f: Intent['filters']) => Boolean(f.regions?.length || f.people?.length || f.teams?.length);

/**
 * The second figure to run, if any. A named slice compared with "the company" by someone who can't see the company
 * (a seller or manager) is explained alone: their own whole scope is not the company's figure (#50 review, Oct 31).
 */
function secondFigure(p: Plan, principal: Principal, phrase: string): Intent | null {
  const companyWide = principal.ownerIds === null && principal.regions.length === ALL_REGIONS.length;
  if (p.second && !hasSlice(p.second.filters) && hasSlice(p.first.filters) && !companyWide && pointsElsewhere(phrase)) return null;
  return p.second;
}

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
  const run2 = await runSecond(database, registry, principal, secondFigure(p, principal, phrase), second, fields);
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
  const text = explanationText(answer, other, verdict, numerators);
  const correction = other && verdict ? directionCorrection(phrase, registry, snapshot.asOfDate, answer, other, verdict) : null;
  return { kind: 'explanation', answer, other, verdict, ...text, summary: correction ? `${correction} ${text.summary}` : text.summary };
}

/**
 * Runs the second figure. If it is refused, the request's audit row records the refused figure, not the first figure
 * that was already computed: a refused comparison must not look answered in the log (#50 review, Oct 31).
 */
async function runSecond(database: Database, registry: Registry, principal: Principal, intent: Intent | null, second: AuditFields, fields: AuditFields): Promise<Answer | null> {
  if (!intent) return null;
  try {
    return await run(database, registry, principal, intent, second);
  } catch (e) {
    for (const key of ['resultHash', 'regions', 'ownerCount', 'snapshotId'] as const) delete fields[key];
    Object.assign(fields, { intent: second.intent ?? intent });
    throw e;
  }
}
