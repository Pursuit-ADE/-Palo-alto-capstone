// Plain words for the trends page (UX review, Nov 2): the audit log's metric ids, outcome codes and ISO weeks, as an
// analyst reads them. Display only: the counts and the facts the trends agent reads are unchanged.
import type { TrendCount } from '@/audit/question-trends';
import { dateRange } from '../format';

const OUTCOMES: Record<string, string> = {
  answered: 'Answered',
  explanation: 'Explained a difference',
  clarify: 'Asked back for detail',
  unsupported: 'Not a governed metric yet',
  refused_scope: 'Refused: outside the asker’s access',
  refused_injection: 'Refused: flagged as an attack',
  refused_locked: 'Refused: asking paused',
  refused_rate: 'Refused: too many questions in a minute',
  refused_intent: 'Refused: not a valid request',
  error: 'Error',
};

export const outcomeWords = (outcome: string) => OUTCOMES[outcome] ?? outcome.replace(/_/g, ' ');

export const metricWords = (id: string, names: ReadonlyMap<string, string>) => (id === '(no metric)' ? 'No metric' : (names.get(id) ?? id));

/** "Nov 2, 2026" for a week's Monday. */
export const weekWords = (iso: string) => dateRange(iso);

/**
 * A trend fact in the page's words. The facts name metrics by id and weeks as ISO dates, and count a question the
 * copilot asked back about together with one it couldn't answer, so the topic lines say both.
 */
export function readableFact(text: string, names: ReadonlyMap<string, string>): string {
  let out = text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, weekWords);
  for (const [id, name] of names) out = out.replace(new RegExp(`^${id}:`), `${name}:`);
  return out
    .replace(/^(\d+) unanswered (questions?) about other\b/, '$1 $2 asked back or not answered, on other topics')
    .replace(/^(\d+) unanswered (questions?) about /, '$1 $2 asked back or not answered, about ');
}

/** Questions that didn't become an answer, with the copilot's ask-backs apart: an ask-back is the copilot working. */
export function splitUnanswered(missed: TrendCount[]) {
  return { askedBack: missed.filter((c) => c.outcome === 'clarify'), notAnswered: missed.filter((c) => c.outcome !== 'clarify') };
}
