// Deterministic intent normalizer. This is the golden-set mock that stands in for the AI model:
// it maps a phrasing to a registry metric plus filters using the context layer's synonyms and phrases.
// The real model (Week 3) must produce the same structured Intent and passes the same validation.
import type { Registry } from '../registry/load';
import type { Dimension, Intent } from '../registry/types';
import { entityNames, QUOTA_PERIODS } from '../db/seed';
import type { Glossary } from '../registry/types';
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

// Selectors the registry can't express. Matching the metric while ignoring them would answer a narrower
// question with the whole scope's number, so they get a clarifying question instead (PRD A2).
const AMOUNT = / (over|above|under|below|more than|less than|greater than|at least|at most|bigger than|larger than|smaller than|exceeding) \d| \d+ ?(k|m|mm|million|thousand|bn|billion) | (deal size|deal sizes|size of deal|size of deals) /;
const SECTOR = / (sector|sectors|industry|industries|vertical|verticals) /;

function unsupportedSelector(phrase: string, text: string): string | undefined {
  if (AMOUNT.test(text) || /[$<>]\s*\d/.test(phrase)) return 'deal size';
  if (SECTOR.test(text)) return 'sector';
  const names = entityNames();
  const has = (n: string) => text.includes(clean(n));
  if (names.products.some(has)) return 'product';
  if (names.accounts.some(has)) return 'account';
  if (names.sectors.some(has)) return 'sector';
  if (names.people.some(has)) return 'person';
  return undefined;
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

  // Longest matching synonym wins, so "pipeline coverage" beats "pipeline".
  let best = 0;
  let matches: string[] = [];
  for (const m of registry.metrics.values()) {
    const len = Math.max(0, ...m.synonyms.filter((s) => text.includes(` ${s.toLowerCase()} `)).map((s) => s.length));
    if (len === 0) continue;
    if (len > best) {
      best = len;
      matches = [m.id];
    } else if (len === best) matches.push(m.id);
  }
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
  if (EXCLUSION.test(text)) {
    return { kind: 'clarify', question: "I can't leave out a region or stage yet. Which regions or stages do you want included?" };
  }
  const unsupported = unsupportedSelector(phrase, text);
  if (unsupported) {
    return {
      kind: 'clarify',
      question: `I can't filter ${metric.name.toLowerCase()} by ${unsupported} yet, so I won't answer for everything instead. I can break it down by ${metric.dimensions.join(', ')}, or filter by region${metric.kind === 'aggregate' ? ', stage' : ''} and quarter.`,
    };
  }
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
  const inherit = prior && (continued || (prior.metric === metric.id && followUpCue)) ? prior : undefined;

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
    return { metric: metric.id, filters: f, groupBy: groupBy.filter((d) => metric.dimensions.includes(d)) };
  };

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

  const filters: Intent['filters'] = {};
  const finalRegions = regions.length ? regions : (inherit?.filters.regions ?? []);
  if (finalRegions.length) filters.regions = [...finalRegions];
  if (stages.length) filters.stages = stages;
  if (period) filters.period = period;
  return { kind: 'intent', intent: { metric: metric.id, filters, groupBy } };
}
