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
// Periods we can't answer: anything other than a single fiscal quarter in the snapshot. A month too ("in October" was
// answered for all time; bug hunt, Oct 31), except "may", which is usually the verb.
const MONTH_NAMES = 'january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec';
const UNSUPPORTED_PERIOD = new RegExp(` (last|previous|prior) (quarter|year|month)| (this|next|fiscal|calendar) (year|month)| (ytd|qtd|mtd|month|year|week|annual|yearly) | (19|20)\\d\\d | (${MONTH_NAMES}) `);

const FOLLOW_UP = /^ (and|what about|how about|same for|same but|also|now|then|instead|ok|okay) /;
const ALL_REGIONS_PHRASE = / (all regions|every region|everything|everyone|all teams|whole company|company wide|company-wide) /;
const NO_BREAKDOWN = / (total|overall|no breakdown|combined) /;
/**
 * "East vs West", "compare east and west", "is east higher than (the) west", "higher in East than West": two figures
 * wanted, not their sum. A comparative counts only next to a region ("than west", "in east than"), so "deals larger
 * than $50,000" stays a deal-size filter. The "in East than" form was answered as one combined total (phrasing hunt, Oct 31).
 */
const COMPARISON =
  / (vs|versus|compare|compared|comparing|(higher|lower|bigger|smaller|larger|better|worse|more|less) than (in |for )?(the )?(central|east|west)|(higher|lower|bigger|smaller|larger|better|worse|more|less) (in|for) (the )?(central|east|west) than) /;
const ALL_STAGES = / (all stages|every stage|any stage|all open stages|both stages) /;

// A capitalized name, including a product id whose last token is a number ("GTK 500").
const NAMED = /\b(?:for|at|from|with|on|in)\s+([A-Z][A-Za-z0-9&'.-]*(?:\s+(?:[A-Z][A-Za-z0-9&'.-]*|\d[\w.&'-]*))*)/g;
const KNOWN_WORDS = new Set(['central', 'east', 'west', 'this', 'next', 'last', 'the', 'our', 'my', 'all', 'every', 'each', 'fiscal', 'q1', 'q2', 'q3', 'q4', 'fy27', 'fy2027', 'prospecting', 'engaging', 'won', 'lost']);

/**
 * Words that are a period, region, weekday or currency, not a name: "in October", "in EMEA", "Monday's", "in USD".
 * Months and regions get their own question elsewhere; the rest are ignored, as before (review, Oct 31).
 */
const WEEKDAYS = 'monday tuesday wednesday thursday friday saturday sunday';
const NOT_A_NAME_HERE = new Set([...MONTH_NAMES.split('|'), 'may', ...UNKNOWN_REGIONS, ...WEEKDAYS.split(' '), 'usd', 'us', 'dollar', 'dollars']);

/**
 * A first name of a rep or manager in the data ("Darcel's", "for Melvin") is not unknown, just not enough to pick one
 * person. A fixed sentence that names no one asks for the full name (review, Oct 31: "I don't know that name" was
 * untrue for a demo persona's own first name).
 */
const FULL_NAME = "Use the person's full name, as it is in the data, so I don't answer for everything. For a manager's team, say the manager's full name and \"team\".";
// A cache: the catalog is fixed for the process, so its first names are read once.
let firstNames: Set<string> | undefined;
function isFirstName(word: string): boolean {
  firstNames ??= new Set([...catalog().owners, ...catalog().managers].map((p) => words(p.name).split(' ')[0]!));
  return firstNames.has(word);
}

/** The question for a name after "for" or "in" that isn't in the data: a lone first name gets FULL_NAME. */
function nameQuestion(parts: string[]): string {
  return parts.length === 1 && isFirstName(parts[0]!.replace(/['’]s$/, '')) ? FULL_NAME : UNKNOWN_NAME;
}

const UNKNOWN_NAME = "I don't know that name, so I won't answer for everything. I can filter by a product, account, sector or sales rep that is in the data.";

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
 * Nouns that make the word before them a name: "for zephyra deals", "from zephyra's team". Only with one of these does a
 * lower-case word count as a name, because "for planning" and "for review" look the same as "for zephyra" without a
 * dictionary (a word-list version asked back 1 in 3 ordinary questions, review Oct 31).
 */
const NAME_NOUN = /^(deal|deals|team|teams|account|accounts|pipeline|pipelines|opportunity|opportunities|quota|quotas|book|territory|portfolio|customers|clients|reps)$/;
/** Words that can sit before those nouns without being a name: "for open deals", "for the team", "of big accounts". */
const PLAIN_BEFORE_NOUN = new Set(
  ('the a an my our your his her their its this that these those each every all any both some no me us them everyone ' +
    'open closed won lost active stalled new old big large small largest biggest top key whole entire total overall ' +
    'current next last previous prior early late high low remaining existing other same sales east west central ' +
    'prospecting engaging enterprise smb mid-market strategic commercial renewal upsell inbound outbound q1 q2 q3 q4 ' +
    'exec execs executive leadership management marketing finance ops revops field inside channel partner partners ' +
    'support product regional global direct dream mine ours company everyone everybody manager managers boss vp svp ' +
    'cro ceo cfo coo board director head lead leader closing pending at-risk risky slipping stuck hot warm cold ' +
    // Purpose words: "for review deals", "for the qbr team" (review, Oct 31).
    'review reviews planning reference context forecast forecasting qbr qbrs prep preparation presentation demo test ' +
    'analysis analytics budgeting status update standup sync kickoff audit compliance alignment internal external ' +
    // The name nouns themselves: "for my team's deals", "for the account team".
    'deal deals team teams account accounts pipeline pipelines opportunity opportunities quota quotas book territory ' +
    'portfolio customer customers client clients rep reps').split(' '),
);

/** A word that starts a name the catalog resolved. findNames records only a name's first mention, so match by words. */
const startsResolvedName = (text: string, at: number, picked: Hit[]) => picked.some((h) => text.startsWith(` ${words(h.name)} `, at - 1));

/**
 * A lower-case name used as one, which is neither an ordinary word nor a name the catalog resolved (QA cycle 5, Oct 31;
 * PRD A2): "for zephyra deals", "for the zephyra account", "from zephyra's team", "the rep named zack". A bare "for
 * zephyra" is left alone, because it reads the same as "for planning".
 */
function unknownLowerName(text: string, picked: Hit[]): boolean {
  const unknown = (word: string, at: number) =>
    !PLAIN_BEFORE_NOUN.has(word) && !UNKNOWN_REGIONS.includes(word) && !/^(fy\d{2,4})?(-?q[1-4])?$/.test(word) && !startsResolvedName(text, at, picked);
  // The 's survives cleaning as " s ": "for zephyra s account". It counts only before a name noun too, so "for
  // tomorrow's meeting" and "for friday's call" stay ordinary.
  for (const m of text.matchAll(/ (?:for|from|of|at|with)(?: (?:the|my|our|a|an))? ([a-z][a-z0-9-]*)(?: s)? ([a-z]+)(?= )/g)) {
    const [word, next] = [m[1]!, m[2]!];
    if (NAME_NOUN.test(next) && unknown(word, m.index! + m[0].lastIndexOf(` ${word} `) + 1)) return true;
  }
  for (const m of text.matchAll(/ (?:named|called) ([a-z][a-z0-9-]*)(?= )/g)) {
    if (unknown(m[1]!, m.index! + m[0].length - m[1]!.length)) return true;
  }
  return false;
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
    // "West's" is the region West: drop the possessive before looking the word up (bug hunt, Oct 31).
    const known = parts.every((w) => {
      const token = w.replace(/['’]s$/, '').replace(/[^a-z0-9]/g, '');
      // Months and regions we don't have get their own question below, not "I don't know that name".
      return KNOWN_WORDS.has(token) || NOT_A_NAME_HERE.has(token) || /^(fy\d{2,4})?q[1-4]$|^fy\d{2,4}$/.test(token);
    });
    const named = covered.some((c) => sameName(c, raw));
    // A fixed sentence: a clarifying question never repeats typed text back (evaluator B-03).
    if (!known && !named) return { filters: {}, clarify: nameQuestion(parts) };
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
  // A lower-case name used as one ("for zephyra deals"): NAMED only sees capitalised names, so it was dropped and the
  // whole scope answered (QA cycle 5, Oct 31; PRD A2).
  if (unknownLowerName(text, picked)) {
    return { filters: {}, clarify: "I don't know that name, so I won't answer for everything. I can filter by a product, account, sector or sales rep that is in the data." };
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
 * The asker's own team or reps, which replaces a rep or team named earlier in the conversation. Only "my" or "our":
 * "his whole team" or "the whole team" is someone else's, and for the analyst it would widen to the company (review,
 * Oct 31).
 */
const WHOLE_TEAM = / (my|our) (whole |entire )?(team|reps) | all (of )?(my|our) reps /;

/** Any word with 's, in any case and with a straight or curly apostrophe ("Jordan's", "JORDAN'S", "Priya’s"). */
// Capitalised words only: everyday nouns in lower case ("the owner's", "yesterday's") are not names, and no word list
// can hold them all (review, Oct 31). A lower-case name ("jordan's") is not caught here.
const POSSESSIVE = /\b([A-Z][A-Za-z.-]*)['’][sS]\b/g;
/**
 * Words that take 's in a question and are not names: contractions ("what's", "how's") and everyday nouns ("my
 * team's"). The same words as NOT_A_NAME and EVERYDAY in explain.ts, plus deal, client and sales.
 */
const NOT_A_NAME = new Set(
  ('what how why where who when it that there here this let everyone everybody anyone someone somebody nobody ' +
    'team teams company quarter quarters year month week today region regions rep reps manager managers boss board ' +
    'deck slide sheet chart dashboard report spreadsheet number figure coverage pipeline quota data ' +
    'org organization department group division unit segment territory sector industry customer customers account accounts partner ' +
    'market business forecast plan target goal one other he she deal deals client clients sales ' +
    'owner owners seller sellers product products stage stages period yesterday tomorrow ' +
    'palo alto crm salesforce vp svp evp ceo cfo cro coo cmo director directors').split(' '),
);

/**
 * "What is Jordan's open pipeline?": a possessive that is not a region, rep, team or other name the question
 * resolved. NAMED only catches names after "for", "at" and the like, so this one was dropped and the asker's whole
 * scope answered (bug hunt, Oct 31; PRD A2). The explanation path has its own check, with "marketing's" and other
 * outside figures allowed (explain.ts).
 */
/** The question to ask about a possessive that isn't a resolved name, or undefined when every possessive is known. */
function unknownPossessive(phrase: string, filters: Omit<SelectorFilters, 'amount'>): string | undefined {
  const names = [...(filters.products ?? []), ...(filters.accounts ?? []), ...(filters.sectors ?? []), ...(filters.people ?? []), ...(filters.teams ?? [])];
  const resolved = new Set(names.flatMap((n) => words(n).split(' ')));
  for (const m of phrase.matchAll(POSSESSIVE)) {
    const word = m[1]!.toLowerCase();
    if (NOT_A_NAME.has(word) || KNOWN_WORDS.has(word) || NOT_A_NAME_HERE.has(word) || resolved.has(word)) continue;
    return isFirstName(word) ? FULL_NAME : UNKNOWN_NAME;
  }
  return undefined;
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
  const named: Omit<SelectorFilters, 'amount'> = {
    products: read.filters.products ?? checkedProducts(intent.filters.products),
    accounts: read.filters.accounts ?? checkedAccounts(intent.filters.accounts),
    sectors: read.filters.sectors ?? checkedSectors(intent.filters.sectors, phrase),
    people: read.filters.people ?? checkedPeople(intent.filters.people),
    teams: read.filters.teams ?? checkedTeams(intent.filters.teams),
  };
  // A name the model resolved ("my rep Darcel's" as Darcel Schlecht) is known too (review, Oct 31).
  const unknown = unknownPossessive(phrase, named);
  if (unknown) return { kind: 'clarify', question: unknown };
  const filters: Intent['filters'] = {};
  if (intent.filters.regions?.length) filters.regions = intent.filters.regions;
  if (intent.filters.stages?.length) filters.stages = intent.filters.stages;
  if (intent.filters.period) filters.period = intent.filters.period;
  const source = inherited?.filters;
  const amount = read.filters.amount ?? modelAmount ?? source?.amount;
  if (amount) filters.amount = amount;
  // "and my whole team?" after a question about one rep is about the team, not that rep again (bug hunt, Oct 31).
  const ownTeam = WHOLE_TEAM.test(clean(phrase));
  const kept = (k: keyof typeof named) => named[k] ?? (ownTeam && (k === 'people' || k === 'teams') ? undefined : source?.[k]);
  for (const k of ['products', 'accounts', 'sectors', 'people', 'teams'] as const) {
    const v = kept(k);
    if (v?.length) filters[k] = v;
  }
  return { metric: intent.metric, filters, groupBy: intent.groupBy };
}

/** Whether the question changes something a follow-up can change: region, period, stage, breakdown or a ranking. */
function hasModifier(text: string, registry: Registry, phrase: string): boolean {
  if (/ (central|east|west) /.test(text) || ALL_REGIONS_PHRASE.test(text) || NO_BREAKDOWN.test(text) || ALL_STAGES.test(text)) return true;
  if (/ (q[1-9]|fy ?-?\d+)/.test(text) || / (this|next|last|previous) quarter /.test(text)) return true;
  if (Object.keys(registry.glossary.dimensionPhrases).some((p) => text.includes(` ${p} `))) return true;
  // "Who has the most?" after an answer ranks that answer by its owners (bug hunt, Oct 31). A superlative is needed,
  // so "who are you?" doesn't become a breakdown.
  if (SUPERLATIVE.test(text) && rankedBy(text)) return true;
  if (selectorFollowUp(text, phrase)) return true;
  return findStages(text).length > 0;
}

/** A follow-up that starts with a filter word: "for Darcel Schlecht", "in the retail sector", "and for GTK 500". */
const SELECTOR_LEAD = /^ (and |what about |how about |now |then )?(for|in|at|with|from|on|only|just) /;

/**
 * "for Darcel Schlecht", "in the retail sector", or a bare name: a filter alone changes the previous question (bug
 * hunt, Oct 31). Only when the filter leads, or is all there is, so "Who is Darcel Schlecht's manager?" is not read as
 * a follow-up (review, Oct 31).
 */
function selectorFollowUp(text: string, phrase: string): boolean {
  const f = readSelectors(phrase).filters;
  const names = [...(f.products ?? []), ...(f.accounts ?? []), ...(f.sectors ?? []), ...(f.people ?? []), ...(f.teams ?? [])];
  if (!names.length && !f.amount) return false;
  return SELECTOR_LEAD.test(text) || (names.length === 1 && text === ` ${words(names[0]!)} `);
}

function findStages(text: string): string[] {
  const hits = Object.entries(STAGE_WORDS).filter(([w]) => text.includes(` ${w} `)).map(([, s]) => s);
  return [...new Set(hits)];
}

/** Every period the question mentions, resolved to quarter labels; `unsupported` if any can't be answered. */
export function findPeriods(text: string, glossary: Glossary, asOfDate: string): { labels: Set<string>; unsupported: boolean } {
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
  // `about: 'metric'` marks a question about which metric is meant. `ask()` keeps asking it even when a model
  // proposes a metric, because the model would be choosing the metric the reading could not (#52 review).
  | { kind: 'clarify'; question: string; resume?: Intent; about?: 'metric' }
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

/**
 * A comparison of two or more named regions is answered region by region, never as one combined figure (PR #51
 * review). The regions stay as filters, so only the named ones are shown. If region can't be added as a breakdown,
 * the question is asked back. Applied to both intent models (here and in followUpRule), like the follow-up rule.
 */
export function comparedRegions(intent: Intent, phrase: string, registry: Registry): Intent | { kind: 'clarify'; question: string } {
  const regions = intent.filters.regions ?? [];
  if (regions.length < 2 || intent.groupBy.includes('region') || !COMPARISON.test(clean(phrase))) return intent;
  const metric = registry.metrics.get(intent.metric);
  if (metric?.dimensions.includes('region') && intent.groupBy.length < 2) return { ...intent, groupBy: [...intent.groupBy, 'region'] };
  const names = regions.map((r) => r[0]!.toUpperCase() + r.slice(1)).join(' and ');
  return { kind: 'clarify', question: `To compare ${names} I show each region on its own, which leaves room for one other breakdown. Which one do you want?` };
}

/** "Darcel Schlecht vs Niesha Huffines", "higher than Niesha Huffines": two named reps or teams set against each other. */
const SET_AGAINST = / (vs|versus|compare|compared|comparing|against) /;

/**
 * "higher than Niesha Huffines": a comparative only sets two reps against each other when a named rep or team follows
 * "than". "deals more than 5000" is a deal size (review, Oct 31).
 */
function thanNamed(text: string, names: string[]): boolean {
  return names.some((name) => text.includes(` than ${words(name)} `) || text.includes(` than for ${words(name)} `) || text.includes(` than the ${words(name)} `));
}

/**
 * Two or more named reps compared are shown rep by rep, like regions (comparedRegions), never added into one figure
 * (bug hunt, Oct 31: "open pipeline for Darcel Schlecht vs Niesha Huffines" answered their sum). Teams, and metrics
 * with no owner breakdown, are asked about. Without a comparison word the named reps stay one combined filter.
 */
export function comparedPeople(intent: Intent, phrase: string, registry: Registry): Intent | { kind: 'clarify'; question: string } {
  const people = intent.filters.people?.length ?? 0;
  const teams = intent.filters.teams?.length ?? 0;
  const text = clean(phrase);
  const named = [...(intent.filters.people ?? []), ...(intent.filters.teams ?? [])];
  if (people + teams < 2 || intent.groupBy.includes('owner') || !(SET_AGAINST.test(text) || thanNamed(text, named))) return intent;
  const metric = registry.metrics.get(intent.metric);
  if (!teams && metric?.dimensions.includes('owner') && intent.groupBy.length < 2) return { ...intent, groupBy: [...intent.groupBy, 'owner'] };
  if (!teams && metric?.dimensions.includes('owner')) {
    return { kind: 'clarify', question: 'To compare them I show each rep on their own, which leaves room for one other breakdown. Which one do you want?' };
  }
  return { kind: 'clarify', question: `${metric?.name ?? 'This metric'} can't be shown rep by rep or team by team here, so I won't add them together. Ask about each one on its own.` };
}

/** Comparisons of named reps or teams, then of named regions: each is shown on its own or asked about. */
export function compared(intent: Intent, phrase: string, registry: Registry): Intent | { kind: 'clarify'; question: string } {
  const byPeople = comparedPeople(intent, phrase, registry);
  return 'kind' in byPeople ? byPeople : comparedRegions(byPeople, phrase, registry);
}

/** The question asked when a phrase names more than one metric. */
function whichMetric(ids: string[], registry: Registry): string {
  return `Do you mean ${ids.map((id) => registry.metrics.get(id)?.name).join(' or ')}?`;
}

/**
 * The "never a quietly different answer" checks for an intent a model proposed (PR #51 review): the question names
 * two metrics, or its measure words contradict the proposed metric ("total value of open opportunities" read as the
 * count). normalize() asks in both cases; followUpRule applies this so the Claude path asks too. The measure check is
 * against the model's own metric, so "total value of open opportunities" read as open pipeline is still answered.
 */
export function proposalQuestion(phrase: string, metricId: string, registry: Registry): string | undefined {
  const text = clean(phrase);
  const named = namedMetrics(text, registry);
  if (named.length > 1) return whichMetric(named, registry);
  const metric = registry.metrics.get(metricId);
  return metric ? measureContradiction(text, metric, registry) : undefined;
}

/** An intent, or the clarifying question a rule returned instead. */
export const asResult = (x: Intent | { kind: 'clarify'; question: string }): NormalizeResult => ('kind' in x ? x : { kind: 'intent', intent: x });

/** "The pipeline" is also how people say "the open deals", so beside a more specific metric it doesn't name a second one. */
const GENERIC_METRIC_WORDS = new Set(['pipeline']);
/** What may sit between a generic word and another metric for the two to be a list ("coverage and pipeline", "coverage, pipeline"). */
const LISTED = /^(and|plus|with|or|vs|versus)?$/;

/** A generic word listed next to another metric names its own metric too, so the question is asked about (issue #81). */
function listedWith(h: { at: number; end: number }, others: { at: number; end: number }[], text: string): boolean {
  return others.some((o) => LISTED.test((o.end <= h.at ? text.slice(o.end, h.at) : text.slice(h.end, o.at)).trim()));
}

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
  const kept = specific.length ? [...specific, ...picked.filter((h) => h.generic && listedWith(h, specific, text))] : picked;
  return [...new Set(kept.map((h) => h.id))];
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
 * The breakdowns a question asks for, in the order named: glossary phrases, a second one chained with "and", or the one
 * a ranking needs. A breakdown the metric doesn't have, or one by period, is asked about, never silently dropped.
 */
function askedBreakdown(text: string, phrase: string, metric: MetricDefinition, registry: Registry, asOfDate: string): Dimension[] | { kind: 'clarify'; question: string } {
  const groupBy: Dimension[] = [];
  const dimHits = Object.entries(registry.glossary.dimensionPhrases)
    .map(([p, d]) => ({ at: text.indexOf(` ${p} `), d }))
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at);
  for (const d of [...dimHits.map((h) => h.d), ...chainedDimensions(text)]) if (!groupBy.includes(d)) groupBy.push(d);
  // "per quarter for Q1" names its quarter, so it is not a breakdown by period (review, Oct 31).
  if (PERIOD_BREAKDOWN.test(text) && findPeriods(text, registry.glossary, asOfDate).labels.size === 0) {
    return { kind: 'clarify', question: PERIOD_BREAKDOWN_QUESTION };
  }
  const named = readSelectors(phrase).filters;
  const ranked = groupBy.length ? undefined : rankedBy(text, Boolean(named.people?.length || named.teams?.length));
  if (ranked && !metric.dimensions.includes(ranked)) return { kind: 'clarify', question: cannotRank(metric, ranked) };
  if (ranked) groupBy.push(ranked);
  const unsupportedDim = groupBy.find((d) => !metric.dimensions.includes(d));
  if (unsupportedDim) {
    return { kind: 'clarify', question: `${metric.name} can't be broken down by ${unsupportedDim}. It can be broken down by ${metric.dimensions.join(', ')}. Which do you want?` };
  }
  return groupBy;
}

const DIMENSION_WORDS: Record<string, Dimension> = { region: 'region', stage: 'stage', owner: 'owner', rep: 'owner', seller: 'owner' };
/** "by region and stage", "by stage, region": a second breakdown named without its own "by". */
const CHAINED = / (?:by|per|each) (?:sales )?(region|stage|owner|rep|seller)s? (?:and |plus )?(?:by |per )?(?:sales )?(region|stage|owner|rep|seller)s? /;

/** Both breakdowns of a chained phrase, in the order named. The glossary phrases only catch the one after "by" (bug hunt, Oct 31). */
function chainedDimensions(text: string): Dimension[] {
  const m = CHAINED.exec(text);
  return m ? [DIMENSION_WORDS[m[1]!]!, DIMENSION_WORDS[m[2]!]!] : [];
}

/** "by quarter", "per month": every answer is for one quarter, so a breakdown by period is asked about, not dropped. */
const PERIOD_BREAKDOWN = / (by|per|each|every) (quarter|quarters|month|months|year|years|week|weeks|period|periods) (?!end )/;
const PERIOD_BREAKDOWN_QUESTION = 'I answer for one quarter at a time, so I can\'t break this down by period. Which quarter do you want, this quarter or next quarter?';

const SUPERLATIVE = / (top|bottom|highest|lowest|most|least|best|worst|biggest|smallest|largest|rank|ranked|ranking) /;
/** What a ranking ranks, checked in this order: "who" alone means people. */
const RANKED: [RegExp, Dimension][] = [
  [/ (region|regions) /, 'region'],
  [/ (stage|stages) /, 'stage'],
  [/ (who|whose|rep|reps|owner|owners|seller|sellers|salesperson|salespeople) /, 'owner'],
];

/**
 * "Which rep has the lowest coverage?", "who has the most open pipeline?", "top 3 reps": a ranking needs the
 * breakdown it ranks by. Without one the scope's total was answered (bug hunt, Oct 31; PRD A2). A superlative is
 * needed ("the reps who report to me" is not a ranking), and a question that names a rep ("my top rep Darcel
 * Schlecht") or asks about the asker ("am I the top rep?") is about that rep (review, Oct 31).
 */
function rankedBy(text: string, namesRep = false): Dimension | undefined {
  if (!SUPERLATIVE.test(text) || namesRep || / am i /.test(text)) return undefined;
  return RANKED.find(([w]) => w.test(text))?.[1];
}

function cannotRank(metric: MetricDefinition, by: Dimension): string {
  const what = by === 'owner' ? 'rep' : by;
  const name = metric.name.toLowerCase();
  return `${metric.name} can't be broken down by ${what}, so I can't rank ${what}s by it. I can show ${name} for one ${what} you name, or ${name} by ${metric.dimensions.join(' or ')}.`;
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
    if (text.includes(` ${term} `)) return { kind: 'clarify', question, about: 'metric' };
  }

  let matches = namedMetrics(text, registry);
  const prior = previous && registry.metrics.has(previous.metric) ? previous : undefined;
  const followUpCue = FOLLOW_UP.test(text);
  let continued = false; // this turn names no metric and only changes a modifier
  if (matches.length === 0) {
    if (prior && (hasModifier(text, registry, phrase) || followUpCue)) {
      matches = [prior.metric];
      continued = true;
    }
    else return { kind: 'unsupported', message: 'I can only answer questions about the governed metrics in the registry.' };
  }
  if (matches.length > 1) return { kind: 'clarify', question: whichMetric(matches, registry), about: 'metric' };
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

  const asked = askedBreakdown(text, phrase, metric, registry, asOfDate);
  if (!Array.isArray(asked)) return asked;
  const groupBy: Dimension[] = asked;
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
  const openStages = stages.filter((st): st is 'Prospecting' | 'Engaging' => st === 'Prospecting' || st === 'Engaging');
  if (openStages.length) filters.stages = openStages;
  else delete filters.stages;
  if (period) filters.period = period;
  else delete filters.period;
  return asResult(compared({ metric: metric.id, filters, groupBy }, phrase, registry));
}
