// Deterministic intent normalizer. This is the golden-set mock that stands in for the AI model:
// it maps a phrasing to a registry metric plus filters using the context layer's synonyms and phrases.
// The real model (Week 3) must produce the same structured Intent and passes the same validation.
import type { Registry } from '../registry/load';
import type { Dimension, Intent } from '../registry/types';
import { resolvePeriod } from './periods';

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

  const regions = (['east', 'west'] as const).filter((r) => text.includes(` ${r} `));

  let period: string | undefined;
  const periodKeys = Object.keys(glossary.periodPhrases).sort((a, b) => b.length - a.length);
  for (const key of periodKeys) {
    if (text.includes(` ${key} `)) {
      period = resolvePeriod(glossary.periodPhrases[key]!, asOfDate);
      break;
    }
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
  if (period) filters.period = period;
  return { kind: 'intent', intent: { metric: metric.id, filters, groupBy } };
}
