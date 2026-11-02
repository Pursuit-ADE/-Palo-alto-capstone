// The trends page speaks analyst, not engineer, and counts ask-backs apart from failures (UX review, Nov 2).
import { expect, it } from 'vitest';
import { metricWords, outcomeWords, readableFact, splitUnanswered, weekWords } from '../app/trends/words';

const names = new Map([['open_pipeline', 'Open pipeline'], ['pipeline_coverage', 'Pipeline coverage']]);

it('names metrics, outcomes and weeks in words', () => {
  expect(metricWords('pipeline_coverage', names)).toBe('Pipeline coverage');
  expect(metricWords('(no metric)', names)).toBe('No metric');
  expect(outcomeWords('clarify')).toBe('Asked back for detail');
  expect(outcomeWords('refused_rate')).toBe('Refused: too many questions in a minute');
  expect(outcomeWords('something_new')).toBe('something new');
  expect(weekWords('2026-11-02')).toBe('Nov 2, 2026');
});

it('rewrites the trend facts without changing a number', () => {
  expect(readableFact('35 questions in the week of 2026-11-02; 22 answered (63%).', names)).toBe('35 questions in the week of Nov 2, 2026; 22 answered (63%).');
  expect(readableFact('open_pipeline: 9 answered questions.', names)).toBe('Open pipeline: 9 answered questions.');
  expect(readableFact('12 unanswered questions about other.', names)).toBe('12 questions asked back or not answered, on other topics.');
  expect(readableFact('1 unanswered question about support cases, up from 0 the week before.', names)).toBe('1 question asked back or not answered, about support cases, up from 0 the week before.');
});

it('keeps ask-backs apart from questions that were not answered', () => {
  const rows = [
    { week: '2026-11-02', metric: '(no metric)', outcome: 'clarify', count: 7 },
    { week: '2026-11-02', metric: '(no metric)', outcome: 'unsupported', count: 5 },
    { week: '2026-11-02', metric: 'open_pipeline', outcome: 'refused_scope', count: 1 },
  ];
  const { askedBack, notAnswered } = splitUnanswered(rows);
  expect(askedBack.map((r) => r.count)).toEqual([7]);
  expect(notAnswered.map((r) => r.outcome)).toEqual(['unsupported', 'refused_scope']);
});
