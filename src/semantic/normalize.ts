// Deterministic intent normalizer. This is the golden-set mock that stands in for the AI model:
// it maps a phrasing to a registry metric plus filters using the context layer's synonyms and phrases.
// The real model (Week 3) must produce the same structured Intent and passes the same validation.
import type { Registry } from '../registry/load';
import type { Dimension, Intent, MetricDefinition } from '../registry/types';
import { catalog, QUOTA_PERIODS } from '../db/seed';
import type { Glossary } from '../registry/types';
import { AMOUNT_CLARIFY, parseAmount } from './amount';
import { findPeriod, resolvePeriod } from './periods';

const EXCLUSION = / (excluding|exclude|except|without|other than|apart from|besides|minus|outside of|not) /;
const UNKNOWN_REGIONS = ['north', 'south', 'emea', 'apac', 'apj', 'americas', 'latam', 'europe', 'asia', 'japan'];
const STAGE_WORDS: Record<string, string> = { prospecting: 'Prospecting', engaging: 'Engaging', won: 'Won', lost: 'Lost' };
// Periods we can't answer: anything other than a single fiscal quarter in the snapshot.
const UNSUPPORTED_PERIOD = / (last|previous|prior) (quarter|year|month)| (this|next|fiscal|calendar) (year|month)| (ytd|qtd|mtd|month|year|week|annual|yearly) | (19|20)\d\d /;

const FOLLOW_UP = /^ (and|what about|how about|same for|same but|also|now|then|instead|ok|okay) /;
const ALL_REGIONS_PHRASE = / (all regions|every region|everything|everyone|all teams|whole company|company wide|company-wide) /;
const NO_BREAKDOWN = / (total|overall|no breakdown|combined) /;
const ALL_STAGES = / (all stages|every stage|any stage|all open stages|both stages) /;

// A capitalized name, including a product id whose last token is a number ("GTK 500").
const NAMED = /\b(?:for|at|from|with|on)\s+([A-Z][A-Za-z0-9&'.-]*(?:\s+(?:[A-Z][A-Za-z0-9&'.-]*|\d[\w.&'-]*))*)/g;
const KNOWN_WORDS = new Set(['central', 'east', 'west', 'this', 'next', 'last', 'the', 'our', 'my', 'all', 'every', 'each', 'fiscal', 'q1', 'q2', 'q3', 'q4', 'fy27', 'fy2027', 'prospecting', 'engaging', 'won', 'lost']);

type SelectorFilters = Pick<Intent['filters'], 'amount' | 'products' | 'accounts' | 'sectors' | 'people' | 'teams'>;

const SECTOR_CUES = ['sector', 'sectors', 'industry', 'industries', 'vertical', 'verticals'];

function words(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Possessive "'s" survives cleaning as a stray "s". Fold it so "Cara Losch's" matches "Cara Losch". */
function sameName(a: string, b: string): boolean {
  const fold = (s: string) => words(s).replace(/\bs\b/g, '').replace(/\s+/g, ' ').trim();
  return fold(a) === fold(b);
}

function sectorBeside(text: string, name: string): boolean {
  const n = words(name);
  return SECTOR_CUES.some((c) => text.includes(` ${n} ${c} `) || text.includes(` ${c} ${n} `));
}

function managerWithTeam(text: string, name: string): boolean {
  const n = words(name);
  return text.includes(` ${n} s team `) || text.includes(` ${n} team `) || text.includes(` team of ${n} `);
}

interface Hit { kind: 'product' | 'account' | 'sector' | 'owner' | 'manager'; name: string; at: number; len: number }

function findNames(text: string, kind: Hit['kind'], names: string[]): Hit[] {
  const hits: Hit[] = [];
  for (const name of names) {
    const n = name.toLowerCase().replace(/[^a-z0-9-]+/g, ' ').trim();
    if (n.length < 2) continue;
    const token = ` ${n} `;
    const at = text.indexOf(token);
    if (at >= 0) hits.push({ kind, name, at, len: token.length });
  }
  return hits;
}

/**
 * Filters named in this question. An unknown name, a manager, or a deal size with no comparison is a
 * clarifying question: dropping it would answer for the whole scope (PRD A2).
 */
export function readSelectors(phrase: string): { filters: SelectorFilters; clarify?: string } {
  const text = clean(phrase);
  const cat = catalog();
  const series = [...new Set(cat.products.map((p) => p.series))];
  const sectors = [...new Set(cat.accounts.map((a) => a.sector))];
  const hits = [
    ...findNames(text, 'product', [...cat.products.map((p) => p.id), ...series]),
    ...findNames(text, 'account', cat.accounts.map((a) => a.name)),
    ...findNames(text, 'sector', sectors.filter((s) => sectorBeside(text, s))),
    ...findNames(text, 'owner', cat.owners.map((o) => o.name)),
    ...findNames(text, 'manager', cat.managers.map((m) => m.name)),
  ].sort((a, b) => b.len - a.len || a.at - b.at);
  const used: [number, number][] = [];
  const picked: Hit[] = [];
  for (const hit of hits) {
    const end = hit.at + hit.len;
    if (used.some(([start, stop]) => hit.at < stop && end > start)) continue;
    used.push([hit.at, end]);
    picked.push(hit);
  }
  const managers = picked.filter((h) => h.kind === 'manager').map((h) => h.name);
  const teams = managers.filter((name) => managerWithTeam(text, name));
  const loneManagers = managers.filter((name) => !teams.includes(name));
  if (loneManagers.length) {
    return { filters: {}, clarify: `${loneManagers.join(', ')} manages a team and doesn't own deals. I can break the number down by owner, or filter by a sales rep.` };
  }
  const bareSectors = sectors.filter((name) => {
    const n = words(name);
    if (!text.includes(` ${n} `) || sectorBeside(text, name)) return false;
    const at = text.indexOf(` ${n} `);
    const end = at + n.length + 2;
    return !picked.some((h) => h.kind !== 'sector' && at >= h.at && end <= h.at + h.len);
  });
  if (bareSectors.length) {
    const list = bareSectors.join(', ');
    return { filters: {}, clarify: `I won't treat ${list} as a sector unless you say it with "sector", "industry", or "vertical".` };
  }
  const ofKind = (kind: Hit['kind']) => [...new Set(picked.filter((h) => h.kind === kind).sort((a, b) => a.at - b.at).map((h) => h.name))];
  const products = ofKind('product');
  const accounts = ofKind('account');
  const sectorNames = ofKind('sector');
  const people = ofKind('owner');
  const covered = [...products, ...accounts, ...sectorNames, ...people, ...teams];
  for (const m of phrase.matchAll(NAMED)) {
    const raw = m[1]!;
    const parts = raw.toLowerCase().split(/\s+/);
    const known = parts.every((w) => {
      const token = w.replace(/[^a-z0-9]/g, '');
      return KNOWN_WORDS.has(token) || /^(fy\d{2,4})?q[1-4]$|^fy\d{2,4}$/.test(token);
    });
    const named = covered.some((c) => sameName(c, raw));
    if (!known && !named) {
      return { filters: {}, clarify: `I don't know "${raw}", so I won't answer for everything. I can filter by a product, account, sector or sales rep that is in the data.` };
    }
  }
  if (/ (for|in|of|from|on|at|by) (the |a |an |our |my )?(product|sku)s? /.test(text) && products.length === 0) {
    return { filters: {}, clarify: "I don't know that product, so I won't answer for everything. I can filter by a product that is in the data." };
  }
  if (/ (for|in|of|from|on|at|by) (the |a |an |our |my )?(account|customer|client)s? /.test(text) && accounts.length === 0) {
    return { filters: {}, clarify: "I don't know that account, so I won't answer for everything. I can filter by an account that is in the data." };
  }
  if (/ (sector|sectors|industry|industries|vertical|verticals) /.test(text) && sectorNames.length === 0) {
    return { filters: {}, clarify: `I can filter by sector. The sectors in this data are ${sectors.join(', ')}.` };
  }
  // "open deal value" is a name for the metric. The amount parser also treats "deal value" as a deal size,
  // so the synonym is blanked and a real comparison in the same question still counts.
  const amount = parseAmount(phrase, { ignore: [...covered, 'open deal value'] });
  if (amount.clarify) return { filters: {}, clarify: amount.clarify };
  const filters: SelectorFilters = {};
  if (amount.amount) filters.amount = amount.amount;
  if (products.length) filters.products = products;
  if (accounts.length) filters.accounts = accounts;
  if (sectorNames.length) filters.sectors = sectorNames;
  if (people.length) filters.people = people;
  if (teams.length) filters.teams = teams;
  if ([filters.products, filters.accounts, filters.sectors, filters.people, filters.teams].some((xs) => (xs?.length ?? 0) > 10)) {
    return { filters: {}, clarify: 'Name up to 10 products, accounts, sectors or people in one question.' };
  }
  return { filters };
}

/** Coverage divides by quota, which is not split by deal size, product, account or sector. */
export function quotaBlocked(filters: Intent['filters']): string | undefined {
  const which = [filters.amount ? 'deal size' : '', filters.products?.length ? 'product' : '', filters.accounts?.length ? 'account' : '', filters.sectors?.length ? 'sector' : ''].filter(Boolean);
  if (!which.length) return undefined;
  const list = which.length === 1 ? which[0]! : `${which.slice(0, -1).join(', ')} or ${which[which.length - 1]}`;
  return `Pipeline coverage can't be filtered by ${list}, because quota isn't split that way. I can filter open pipeline by that, or filter coverage by the sales rep who owns the deal.`;
}

function boundOk(n: number | undefined): boolean {
  return n == null || (Number.isFinite(n) && n >= 0 && n <= 1e12);
}

/**
 * A model-proposed amount is kept only when it is a real bound. An empty range (min above max, or the same
 * number with an exclusive side) is refused, the same rule the amount parser uses.
 */
function checkedAmount(amount: Intent['filters']['amount']): Intent['filters']['amount'] | undefined {
  if (!amount || !boundOk(amount.min) || !boundOk(amount.max) || (amount.min == null && amount.max == null)) return undefined;
  const { min, max } = amount;
  if (min != null && max != null && (min > max || (min === max && (amount.minInclusive === false || amount.maxInclusive === false)))) return undefined;
  return amount;
}

function checkedProducts(names: string[] | undefined): string[] | undefined {
  if (!names?.length || names.length > 10) return undefined;
  const products = catalog().products;
  const out: string[] = [];
  for (const name of names) {
    const exact = products.find((p) => p.id.toLowerCase() === name.toLowerCase());
    if (exact) { out.push(exact.id); continue; }
    const series = products.find((p) => p.series.toLowerCase() === name.toLowerCase());
    if (!series) return undefined;
    out.push(series.series);
  }
  return [...new Set(out)];
}

function checkedAccounts(names: string[] | undefined): string[] | undefined {
  if (!names?.length || names.length > 10) return undefined;
  const accounts = catalog().accounts;
  const out: string[] = [];
  for (const name of names) {
    const hit = accounts.find((a) => a.name.toLowerCase() === name.toLowerCase());
    if (!hit) return undefined;
    out.push(hit.name);
  }
  return [...new Set(out)];
}

function checkedSectors(names: string[] | undefined, phrase: string): string[] | undefined {
  if (!names?.length || names.length > 10 || !SECTOR_CUES.some((c) => clean(phrase).includes(` ${c} `))) return undefined;
  const known = [...new Set(catalog().accounts.map((a) => a.sector))];
  const out: string[] = [];
  for (const name of names) {
    const hit = known.find((s) => s.toLowerCase() === name.toLowerCase());
    if (!hit) return undefined;
    out.push(hit);
  }
  return [...new Set(out)];
}

function checkedPeople(names: string[] | undefined): string[] | undefined {
  if (!names?.length || names.length > 10) return undefined;
  const owners = catalog().owners;
  const out: string[] = [];
  for (const name of names) {
    const hit = owners.find((o) => o.name.toLowerCase() === name.toLowerCase());
    if (!hit) return undefined;
    out.push(hit.name);
  }
  return [...new Set(out)];
}

function checkedTeams(names: string[] | undefined): string[] | undefined {
  if (!names?.length || names.length > 10) return undefined;
  const managers = catalog().managers;
  const out: string[] = [];
  for (const name of names) {
    const hit = managers.find((m) => m.name.toLowerCase() === name.toLowerCase());
    if (!hit) return undefined;
    out.push(hit.name);
  }
  return [...new Set(out)];
}

/**
 * The phrase's selectors win. A checked model amount fills a gap only when the question has no digits, so a
 * spelled-out amount the parser cannot read can still be used. A question with digits keeps the parser's
 * answer, including a refusal. On a follow-up, an unnamed selector stays from the previous intent.
 */
export function assignSelectors(intent: Intent, phrase: string, inherited?: Intent): Intent | { kind: 'clarify'; question: string } {
  const read = readSelectors(phrase);
  const modelAmount = /\d/.test(phrase) ? undefined : checkedAmount(intent.filters.amount);
  if (read.clarify && !(read.clarify === AMOUNT_CLARIFY && modelAmount)) return { kind: 'clarify', question: read.clarify };
  const filters: Intent['filters'] = {};
  if (intent.filters.regions?.length) filters.regions = intent.filters.regions;
  if (intent.filters.stages?.length) filters.stages = intent.filters.stages;
  if (intent.filters.period) filters.period = intent.filters.period;
  const source = inherited?.filters;
  const amount = read.filters.amount ?? modelAmount ?? source?.amount;
  if (amount) filters.amount = amount;
  const products = read.filters.products ?? checkedProducts(intent.filters.products) ?? source?.products;
  if (products?.length) filters.products = products;
  const accounts = read.filters.accounts ?? checkedAccounts(intent.filters.accounts) ?? source?.accounts;
  if (accounts?.length) filters.accounts = accounts;
  const sectors = read.filters.sectors ?? checkedSectors(intent.filters.sectors, phrase) ?? source?.sectors;
  if (sectors?.length) filters.sectors = sectors;
  const people = read.filters.people ?? checkedPeople(intent.filters.people) ?? source?.people;
  if (people?.length) filters.people = people;
  const teams = read.filters.teams ?? checkedTeams(intent.filters.teams) ?? source?.teams;
  if (teams?.length) filters.teams = teams;
  return { metric: intent.metric, filters, groupBy: intent.groupBy };
}

/** Whether the question changes something a follow-up can change: region, period, stage or breakdown. */
function hasModifier(text: string, registry: Registry): boolean {
  if (/ (central|east|west) /.test(text) || ALL_REGIONS_PHRASE.test(text) || NO_BREAKDOWN.test(text) || ALL_STAGES.test(text)) return true;
  if (/ (q[1-9]|fy ?-?\d+)/.test(text) || / (this|next|last|previous) quarter /.test(text)) return true;
  if (Object.keys(registry.glossary.dimensionPhrases).some((p) => text.includes(` ${p} `))) return true;
  return findStages(text).length > 0;
}

function findStages(text: string): string[] {
  const hits = Object.entries(STAGE_WORDS).filter(([w]) => text.includes(` ${w} `)).map(([, s]) => s);
  return [...new Set(hits)];
}

/** Every period the question mentions, resolved to quarter labels; `unsupported` if any can't be answered. */
function findPeriods(text: string, glossary: Glossary, asOfDate: string): { labels: Set<string>; unsupported: boolean } {
  const labels = new Set<string>();
  let unsupported = false;
  let rest = text;
  // Explicit fiscal quarters: "fy27-q1", "fy27 q1", "fy 2027 q1".
  rest = rest.replace(/(?<= )fy ?-?(\d{2}|\d{4}) ?-? ?q([1-9])(?= )/g, (_, y: string, q: string) => {
    const label = `FY${y.slice(-2)}-Q${q}`;
    if (findPeriod(label)) labels.add(label);
    else unsupported = true;
    return ' ';
  });
  // Bare quarters ("q2") are in the current fiscal year.
  rest = rest.replace(/(?<= )q([1-9])(?= )/g, (_, q: string) => {
    const fy = resolvePeriod('current', asOfDate)?.slice(0, 4) ?? 'FY27';
    const label = `${fy}-Q${q}`;
    if (findPeriod(label)) labels.add(label);
    else unsupported = true;
    return ' ';
  });
  if (/ fy ?-?\d/.test(rest) || UNSUPPORTED_PERIOD.test(rest)) unsupported = true; // a year, month or other non-quarter period
  // Relative phrases from the glossary ("this quarter", "next quarter").
  for (const [key, value] of Object.entries(glossary.periodPhrases)) {
    if (/^(q\d|fy)/.test(key)) continue; // handled above
    if (rest.includes(` ${key} `)) {
      const label = resolvePeriod(value, asOfDate);
      if (label) labels.add(label);
      else unsupported = true;
    }
  }
  return { labels, unsupported };
}

export type NormalizeResult =
  | { kind: 'intent'; intent: Intent }
  // `resume` is the partial request a clarification is waiting on (for example coverage with no quarter yet).
  // The client sends it back as the previous intent, so the answer to the clarification finishes that request.
  | { kind: 'clarify'; question: string; resume?: Intent }
  | { kind: 'unsupported'; message: string };

// Words for what is being measured. The synonym match picks a metric by its name ("open opportunities"), so a
// question can name one metric while asking for another's measure ("total value of open opportunities").
const VALUE_WORDS = / (value|worth|dollar|dollars|amount|how much|sum|money) /;
const COUNT_WORDS = / (how many|number of|count|counts) /;
const QUOTA_WORDS = / (quota|quotas|target|targets) /;

/**
 * A question whose measure words contradict the metric its name matched: a value on a count metric, a count on a
 * currency metric, or quota on a metric that isn't a ratio of pipeline to quota (semantic invariance suite). Answering
 * would be a valid query for the wrong metric, so it is asked about instead.
 */
function measureContradiction(text: string, metric: MetricDefinition, registry: Registry): string | undefined {
  const named = (unit: string) => [...registry.metrics.values()].filter((m) => m.unit === unit).map((m) => m.name);
  const value = VALUE_WORDS.test(text);
  const count = COUNT_WORDS.test(text);
  if ((metric.unit === 'count' && value && !count) || (metric.unit === 'currency' && count && !value)) {
    return `Do you mean ${named('currency').join(' or ')} (the dollar value of open deals) or ${named('count').join(' or ')} (how many open deals)?`;
  }
  if (metric.kind !== 'ratio' && QUOTA_WORDS.test(text)) {
    return `Do you mean ${named('ratio').join(' or ')} (open pipeline divided by quota for a quarter)? For example, "pipeline coverage this quarter".`;
  }
  return undefined;
}

/** Questions that can't be read exactly once the metric is known: contradicting measure words, or leaving something out. */
function unreadableQuestion(text: string, metric: MetricDefinition, registry: Registry): string | undefined {
  const contradiction = measureContradiction(text, metric, registry);
  if (contradiction) return contradiction;
  // Leaving a region or stage out can't be represented yet.
  return EXCLUSION.test(text) ? "I can't leave out a region or stage yet. Which regions or stages do you want included?" : undefined;
}

/** "The pipeline" is also how people say "the open deals", so beside a more specific metric it doesn't name a second one. */
const GENERIC_METRIC_WORDS = new Set(['pipeline']);

/**
 * The metrics a question names. Synonyms are taken longest first and may not overlap, so "pipeline coverage" beats
 * the "pipeline" inside it, but "open pipeline ... open opportunity count" names two metrics and is asked about, never
 * answered as the longer one (PR #51 review).
 */
function namedMetrics(text: string, registry: Registry): string[] {
  const hits: { id: string; at: number; end: number; generic: boolean }[] = [];
  for (const m of registry.metrics.values()) {
    for (const synonym of m.synonyms) {
      const word = synonym.toLowerCase();
      for (let at = text.indexOf(` ${word} `); at >= 0; at = text.indexOf(` ${word} `, at + 1)) {
        hits.push({ id: m.id, at: at + 1, end: at + 1 + word.length, generic: GENERIC_METRIC_WORDS.has(word) });
      }
    }
  }
  hits.sort((a, b) => b.end - b.at - (a.end - a.at) || a.at - b.at);
  const picked: typeof hits = [];
  for (const h of hits) if (!picked.some((p) => h.at < p.end && h.end > p.at)) picked.push(h);
  const specific = picked.filter((h) => !h.generic);
  return [...new Set((specific.length ? specific : picked).map((h) => h.id))];
}

/** The follow-up rule for a question that names a metric: it keeps the previous filters only for the same metric with a follow-up word. */
function keepsPrevious(text: string, registry: Registry, previous: Intent, metricId: string): boolean {
  return previous.metric === metricId && namedMetrics(text, registry).includes(metricId) && FOLLOW_UP.test(text);
}

/**
 * The follow-up rule (glossary "follow_up"), the same for every intent model: a question keeps the previous
 * question's filters and breakdown only when it names no metric ("what about West?"), or names the same metric
 * with a follow-up word ("and the open pipeline by stage?"). Naming a different metric, or restating the
 * question, starts fresh.
 */
export function continuesPrevious(phrase: string, registry: Registry, previous: Intent | undefined, metricId: string): boolean {
  if (!previous) return false;
  const text = clean(phrase);
  return namedMetrics(text, registry).length === 0 || keepsPrevious(text, registry, previous, metricId);
}

/**
 * For a question that starts fresh: removes the filters and breakdowns that only came from the previous question,
 * keeping anything this question names itself. Used on a model's proposal, which may have carried them over.
 */
export function withoutCarryOver(intent: Intent, phrase: string, registry: Registry, previous: Intent): Intent {
  const text = clean(phrase);
  const allRegions = ALL_REGIONS_PHRASE.test(text);
  const regions = intent.filters.regions?.filter((r) => allRegions || text.includes(` ${r} `) || !previous.filters.regions?.includes(r));
  const named = findStages(text);
  const stages = intent.filters.stages?.filter((s) => named.includes(s) || !previous.filters.stages?.includes(s));
  const dims = Object.entries(registry.glossary.dimensionPhrases).filter(([p]) => text.includes(` ${p} `)).map(([, d]) => d);
  const groupBy = intent.groupBy.filter((d) => dims.includes(d) || !previous.groupBy.includes(d));
  const mentionsPeriod = / (q[1-9]|fy ?-?\d+)/.test(text) || / (this|next|last|previous|fiscal) quarter /.test(text) || Object.keys(registry.glossary.periodPhrases).some((p) => text.includes(` ${p} `));
  const period = intent.filters.period && (mentionsPeriod || intent.filters.period !== previous.filters.period) ? intent.filters.period : undefined;
  return {
    metric: intent.metric,
    filters: {
      ...(regions?.length ? { regions } : {}),
      ...(stages?.length ? { stages } : {}),
      ...(period ? { period } : {}),
    },
    groupBy,
  };
}

function clean(phrase: string): string {
  return ` ${phrase.toLowerCase().replace(/[^a-z0-9-]+/g, ' ').trim()} `;
}

/**
 * Follow-ups (PRD A5): with a previous intent, a question that names no metric but changes a region, period,
 * stage or breakdown ("what about West?", "by stage", "and next quarter?") starts from the previous intent.
 * The previous intent is the whole conversation state: a small structured summary, never rows or chat text.
 */
export function normalize(phrase: string, registry: Registry, asOfDate: string, previous?: Intent): NormalizeResult {
  const text = clean(phrase);
  const { glossary } = registry;

  for (const [term, question] of Object.entries(glossary.ambiguousTerms)) {
    if (text.includes(` ${term} `)) return { kind: 'clarify', question };
  }

  let matches = namedMetrics(text, registry);
  const prior = previous && registry.metrics.has(previous.metric) ? previous : undefined;
  const followUpCue = FOLLOW_UP.test(text);
  let continued = false; // this turn names no metric and only changes a modifier
  if (matches.length === 0) {
    if (prior && (hasModifier(text, registry) || followUpCue)) {
      matches = [prior.metric];
      continued = true;
    }
    else return { kind: 'unsupported', message: 'I can only answer questions about the governed metrics in the registry.' };
  }
  if (matches.length > 1) {
    const names = matches.map((id) => registry.metrics.get(id)?.name).join(' or ');
    return { kind: 'clarify', question: `Do you mean ${names}?` };
  }
  const metric = registry.metrics.get(matches[0]!)!;

  // Conservative interpretation (PRD A2): anything we can't represent exactly gets a clarifying question,
  // never a quietly different answer.
  const unreadable = unreadableQuestion(text, metric, registry);
  if (unreadable) return { kind: 'clarify', question: unreadable };
  const read = readSelectors(phrase);
  if (read.clarify) return { kind: 'clarify', question: read.clarify };
  const unknownRegion = UNKNOWN_REGIONS.find((r) => text.includes(` ${r} `));
  if (unknownRegion) {
    return { kind: 'clarify', question: `"${unknownRegion.toUpperCase()}" isn't a region here. The regions are Central, East and West.` };
  }

  const regions: ('central' | 'east' | 'west')[] = ALL_REGIONS_PHRASE.test(text)
    ? ['central', 'east', 'west']
    : (['central', 'east', 'west'] as const).filter((r) => text.includes(` ${r} `));
  // Carry forward what this turn doesn't change, but only when it clearly continues the previous question:
  // it names no metric ("what about West?"), or it names the same metric with a follow-up cue ("and the
  // open pipeline by stage?"). A newly named metric, or a full question restated, starts fresh.
  const inherit = prior && (continued || keepsPrevious(text, registry, prior, metric.id)) ? prior : undefined;

  const mentionedStages = findStages(text);
  // "all stages" clears an inherited stage filter; saying nothing about stages keeps it.
  const stages = mentionedStages.length
    ? mentionedStages
    : ALL_STAGES.test(text) || metric.kind !== 'aggregate'
      ? []
      : (inherit?.filters.stages ?? []);

  const groupBy: Dimension[] = [];
  const dimHits = Object.entries(glossary.dimensionPhrases)
    .map(([p, d]) => ({ at: text.indexOf(` ${p} `), d }))
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at);
  for (const h of dimHits) if (!groupBy.includes(h.d)) groupBy.push(h.d);
  // A breakdown this metric doesn't have is asked about, not silently dropped.
  const unsupportedDim = groupBy.find((d) => !metric.dimensions.includes(d));
  if (unsupportedDim) {
    return { kind: 'clarify', question: `${metric.name} can't be broken down by ${unsupportedDim}. It can be broken down by ${metric.dimensions.join(', ')}. Which do you want?` };
  }
  if (!groupBy.length && inherit && !NO_BREAKDOWN.test(text)) {
    for (const d of inherit.groupBy) if (metric.dimensions.includes(d)) groupBy.push(d);
  }

  const partial = (): Intent => {
    const f: Intent['filters'] = {};
    const r = regions.length ? regions : (inherit?.filters.regions ?? []);
    if (r.length) f.regions = [...r];
    // Keep everything the question already named, so the reply to the clarification only adds what was missing.
    const openStages = stages.filter((st) => st === 'Prospecting' || st === 'Engaging');
    if (metric.kind === 'aggregate' && openStages.length) f.stages = openStages;
    const draft: Intent = { metric: metric.id, filters: f, groupBy: groupBy.filter((d) => metric.dimensions.includes(d)) };
    const withSelectors = assignSelectors(draft, phrase, inherit);
    return 'kind' in withSelectors ? draft : withSelectors;
  };

  const selected = assignSelectors({ metric: metric.id, filters: {}, groupBy }, phrase, inherit);
  if ('kind' in selected) return selected;
  if (metric.kind === 'ratio') {
    const blocked = quotaBlocked(selected.filters);
    if (blocked) return { kind: 'clarify', question: blocked };
  }

  const periods = findPeriods(text, glossary, asOfDate);
  if (periods.unsupported) {
    return { kind: 'clarify', question: `I can only answer for ${QUOTA_PERIODS.map((p) => p.period).join(' and ')}. Which of those do you mean?` };
  }
  if (periods.labels.size > 1) {
    return { kind: 'clarify', question: `You mentioned more than one quarter (${[...periods.labels].join(', ')}). Which one do you mean?`, resume: partial() };
  }
  const period = [...periods.labels][0] ?? inherit?.filters.period;

  if (stages.length && metric.kind === 'ratio') {
    return { kind: 'clarify', question: `${metric.name} can't be filtered by stage. Do you want ${metric.name.toLowerCase()} for all open deals?` };
  }
  if (stages.some((st) => st === 'Won' || st === 'Lost')) {
    return { kind: 'clarify', question: `${metric.name} only counts open deals (Prospecting and Engaging). Won and lost deals aren't included.` };
  }


  if (metric.kind === 'ratio' && metric.requiresPeriod && !period) {
    return { kind: 'clarify', question: `${metric.name} needs a period. Which quarter do you mean, for example this quarter or next quarter?`, resume: partial() };
  }

  const filters: Intent['filters'] = { ...selected.filters };
  const finalRegions = regions.length ? regions : (inherit?.filters.regions ?? []);
  if (finalRegions.length) filters.regions = [...finalRegions];
  else delete filters.regions;
  if (stages.length) filters.stages = stages;
  else delete filters.stages;
  if (period) filters.period = period;
  else delete filters.period;
  return { kind: 'intent', intent: { metric: metric.id, filters, groupBy } };
}
