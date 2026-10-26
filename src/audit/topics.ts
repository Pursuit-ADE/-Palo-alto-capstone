// Topic labels for questions the copilot did not answer (client call, Oct 24: "why are sellers asking about support
// cases?"). The audit log keeps only a fingerprint of the question, so the trend needs a coarse label instead of the
// words. The label always comes from this fixed list, never from the question, so no text can reach the log through it.

export const TOPICS = [
  'support_cases',
  'product_usage',
  'renewals_churn',
  'forecast',
  'engagements_contacts',
  'competitors',
  'pricing_discounts',
  'people_hr',
  'other',
] as const;

export type Topic = (typeof TOPICS)[number];

// Checked in order; the first match wins. Word starts only, so "cased" or "reuse" don't count by accident.
const PATTERNS: [Topic, RegExp][] = [
  ['support_cases', /\b(support|cases?|tickets?|escalat\w*|sev(erity)?\s*[1-4]?|p[1-4]|incidents?|outages?)\b/i],
  ['product_usage', /\b(usage|consum\w*|adoption|utili[sz]\w*|deploy\w*|activat\w*|licen[cs]e\w*|seats?)\b/i],
  ['renewals_churn', /\b(renew\w*|churn\w*|retention|expir\w*|cancel\w*)\b/i],
  ['forecast', /\b(forecast\w*|predict\w*|projection\w*|will (we|i)|next year|likel(y|ihood))\b/i],
  ['engagements_contacts', /\b(meetings?|engagements?|calls?|contacts?|cxo|ciso|cio|cfo|ceo|champions?|stakeholders?)\b/i],
  ['competitors', /\b(competit\w*|crowdstrike|fortinet|zscaler|cisco|check ?point|vs\.?|versus)\b/i],
  ['pricing_discounts', /\b(pric\w*|discount\w*|margins?|list price|cost)\b/i],
  ['people_hr', /\b(salar\w*|compensation|commission\w*|hir(e|ing)|headcount|performance review|fired)\b/i],
];

/** The topic of a question, from the fixed list. "other" when nothing matches. */
export function topicOf(question: string): Topic {
  for (const [topic, pattern] of PATTERNS) if (pattern.test(question)) return topic;
  return 'other';
}

/** A readable name for a topic label, for the trends page and the weekly summary. */
export function topicName(topic: string): string {
  return (TOPICS as readonly string[]).includes(topic) ? topic.replace(/_/g, ' ') : 'other';
}
