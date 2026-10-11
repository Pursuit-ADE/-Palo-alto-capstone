// Deterministic intent normalizer. This is the golden-set mock that stands in for the AI model:
// it maps a phrasing to a registry metric plus filters using the context layer's synonyms and phrases.
// The real model (Week 3) must produce the same structured Intent and passes the same validation.
import type { Registry } from '../registry/load';
import type { Dimension, Intent } from '../registry/types';
import { QUOTA_PERIODS } from '../db/seed';
import type { Glossary } from '../registry/types';
import { findPeriod, resolvePeriod } from './periods';

const EXCLUSION = / (excluding|exclude|except|without|other than|apart from|besides|minus|outside of|not) /;
const UNKNOWN_REGIONS = ['north', 'south', 'emea', 'apac', 'apj', 'americas', 'latam', 'europe', 'asia', 'japan'];
const STAGE_WORDS: Record<string, string> = { prospecting: 'Prospecting', engaging: 'Engaging', won: 'Won', lost: 'Lost' };
// Periods we can't answer: anything other than a single fiscal quarter in the snapshot.
const UNSUPPORTED_PERIOD = / (last|previous|prior) (quarter|year|month)| (this|next|fiscal|calendar) (year|month)| (ytd|qtd|mtd|month|year|week|annual|yearly) | (19|20)\d\d /;

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
  rest = rest.replace(/ fy ?-?(\d{2}|\d{4}) ?-? ?q([1-9]) /g, (_, y: string, q: string) => {
    const label = `FY${y.slice(-2)}-Q${q}`;
    if (findPeriod(label)) labels.add(label);
    else unsupported = true;
    return ' ';
  });
  // Bare quarters ("q2") are in the current fiscal year.
  rest = rest.replace(/ q([1-9]) /g, (_, q: string) => {
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
  | { kind: 'clarify'; question: string }
  | { kind: 'unsupported'; message: string };

function clean(phrase: string): string {
  return ` ${phrase.toLowerCase().replace(/[^a-z0-9-]+/g, ' ').trim()} `;
}

export function normalize(phrase: string, registry: Registry, asOfDate: string): NormalizeResult {
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
  if (matches.length === 0) {
    return { kind: 'unsupported', message: 'I can only answer questions about the governed metrics in the registry.' };
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
  const unknownRegion = UNKNOWN_REGIONS.find((r) => text.includes(` ${r} `));
  if (unknownRegion) {
    return { kind: 'clarify', question: `"${unknownRegion.toUpperCase()}" isn't a region here. The regions are Central, East and West.` };
  }

  const regions = (['central', 'east', 'west'] as const).filter((r) => text.includes(` ${r} `));

  const periods = findPeriods(text, glossary, asOfDate);
  if (periods.unsupported) {
    return { kind: 'clarify', question: `I can only answer for ${QUOTA_PERIODS.map((p) => p.period).join(' and ')}. Which of those do you mean?` };
  }
  if (periods.labels.size > 1) {
    return { kind: 'clarify', question: `You mentioned more than one quarter (${[...periods.labels].join(', ')}). Which one do you mean?` };
  }
  const period = [...periods.labels][0];

  const stages = findStages(text);
  if (stages.length && metric.kind === 'ratio') {
    return { kind: 'clarify', question: `${metric.name} can't be filtered by stage. Do you want ${metric.name.toLowerCase()} for all open deals?` };
  }
  if (stages.some((st) => st === 'Won' || st === 'Lost')) {
    return { kind: 'clarify', question: `${metric.name} only counts open deals (Prospecting and Engaging). Won and lost deals aren't included.` };
  }

  const groupBy: Dimension[] = [];
  const dimHits = Object.entries(glossary.dimensionPhrases)
    .map(([p, d]) => ({ at: text.indexOf(` ${p} `), d }))
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at);
  for (const h of dimHits) if (!groupBy.includes(h.d)) groupBy.push(h.d);

  if (metric.kind === 'ratio' && metric.requiresPeriod && !period) {
    return { kind: 'clarify', question: `${metric.name} needs a period. Which quarter do you mean, for example this quarter or next quarter?` };
  }

  const filters: Intent['filters'] = {};
  if (regions.length) filters.regions = [...regions];
  if (stages.length) filters.stages = stages;
  if (period) filters.period = period;
  return { kind: 'intent', intent: { metric: metric.id, filters, groupBy } };
}
