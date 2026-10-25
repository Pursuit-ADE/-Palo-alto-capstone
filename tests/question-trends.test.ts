// Question trends count the audit log and never carry a question fingerprint into the result.
import { describe, expect, it } from 'vitest';
import { finishThenClose, formatTrends, questionTrends, unansweredTrends, weekOf, type TrendCount } from '@/audit/question-trends';

const fingerprint = 'hmac-this-must-not-appear';

describe('question trends', () => {
  it('uses the Monday of the UTC week', () => {
    expect(weekOf('2026-10-19T00:00:00Z')).toBe('2026-10-19');
    expect(weekOf('2026-10-25T23:00:00Z')).toBe('2026-10-19');
    expect(weekOf('2026-10-26T00:00:00Z')).toBe('2026-10-26');
  });

  it('counts questions by week, metric and outcome, and drops everything else', () => {
    const counts = questionTrends([
      { at: '2026-10-20T12:00:00Z', source: 'question', outcome: 'answered', metricId: 'pipeline_coverage' },
      { at: '2026-10-21T12:00:00Z', source: 'question', outcome: 'answered', metricId: 'pipeline_coverage' },
      { at: '2026-10-20T15:00:00Z', source: 'question', outcome: 'clarify', metricId: null },
      { at: '2026-10-27T12:00:00Z', source: 'question', outcome: 'refused_scope', metricId: 'open_pipeline' },
      { at: '2026-10-20T12:00:00Z', source: 'dashboard', outcome: 'answered', metricId: 'open_pipeline' },
      { at: '2026-10-20T12:00:00Z', source: 'auth', outcome: 'login_failed', metricId: null },
    ]);
    expect(counts).toEqual([
      { week: '2026-10-19', metric: '(no metric)', outcome: 'clarify', count: 1 },
      { week: '2026-10-19', metric: 'pipeline_coverage', outcome: 'answered', count: 2 },
      { week: '2026-10-26', metric: 'open_pipeline', outcome: 'refused_scope', count: 1 },
    ]);
    expect(unansweredTrends(counts).map((c) => c.outcome)).toEqual(['clarify', 'refused_scope']);
  });

  it('does not print a question fingerprint', () => {
    const row = {
      at: '2026-10-20T12:00:00Z',
      source: 'question',
      outcome: 'clarify',
      metricId: null,
      questionSha256: fingerprint,
    };
    const text = formatTrends(questionTrends([row]));
    expect(text).toContain('(no metric)');
    expect(text).toContain('clarify');
    expect(text).not.toContain(fingerprint);
  });

  it('finishes the query before closing the pool', async () => {
    let closed = false;
    const query = () => {
      // Drizzle's query is lazy: it does not run until something awaits it. A plain Promise would start immediately.
      const thenable = {
        // biome-ignore lint/suspicious/noThenProperty: this stands in for that lazy query, so the test can see a close that happens too early.
        then(onOk?: (rows: TrendCount[]) => unknown, onErr?: (err: unknown) => unknown) {
          const result = closed
            ? Promise.reject(new Error('Cannot use a pool after calling end on the pool'))
            : Promise.resolve([{ week: '2026-10-19', metric: 'pipeline_coverage', outcome: 'answered', count: 1 }]);
          return result.then(onOk, onErr);
        },
      };
      return thenable as Promise<TrendCount[]>;
    };
    const rows = await finishThenClose(query, async () => { closed = true; });
    expect(rows).toEqual([{ week: '2026-10-19', metric: 'pipeline_coverage', outcome: 'answered', count: 1 }]);
    expect(closed).toBe(true);
  });
});
