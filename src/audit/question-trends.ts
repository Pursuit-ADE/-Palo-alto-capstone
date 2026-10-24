// Question trends from the audit log (plan item 16). Counts only. The question text is never an input
// and never an output: the log stores a fingerprint, and this report does not read it.
export type AuditCountInput = {
  at: Date | string;
  source: string;
  outcome: string;
  metricId: string | null;
};

export type TrendCount = {
  week: string;
  metric: string;
  outcome: string;
  count: number;
};

const NO_METRIC = '(no metric)';

/** Monday of the UTC week containing `at`, as YYYY-MM-DD. Weeks follow the database clock, which is UTC. */
export function weekOf(at: Date | string): string {
  const src = typeof at === 'string' ? new Date(at) : at;
  const day = new Date(Date.UTC(src.getUTCFullYear(), src.getUTCMonth(), src.getUTCDate()));
  const weekday = day.getUTCDay();
  day.setUTCDate(day.getUTCDate() + (weekday === 0 ? -6 : 1 - weekday));
  return day.toISOString().slice(0, 10);
}

/**
 * Questions only (`source` question), counted by week, metric and outcome. A question that never became a
 * metric is counted as "(no metric)". Dashboard, sign-in and other rows are left out.
 */
export function questionTrends(rows: AuditCountInput[]): TrendCount[] {
  const counts = new Map<string, TrendCount>();
  for (const row of rows) {
    if (row.source !== 'question') continue;
    const week = weekOf(row.at);
    const metric = row.metricId && row.metricId.length > 0 ? row.metricId : NO_METRIC;
    const key = `${week}\t${metric}\t${row.outcome}`;
    const found = counts.get(key);
    if (found) found.count += 1;
    else counts.set(key, { week, metric, outcome: row.outcome, count: 1 });
  }
  return [...counts.values()].sort((a, b) => a.week.localeCompare(b.week) || a.metric.localeCompare(b.metric) || a.outcome.localeCompare(b.outcome));
}

/** Questions that did not become an answer. This is as close as the log can come to "what we can't answer yet". */
export function unansweredTrends(counts: TrendCount[]): TrendCount[] {
  return counts.filter((c) => c.outcome !== 'answered');
}

/** Plain-text report. The only fields printed are week, metric, outcome and count. */
export function formatTrends(counts: TrendCount[]): string {
  const lines = ['Question trends. No question text is stored or shown.', ''];
  if (counts.length === 0) {
    lines.push('No questions in this database yet.');
    return lines.join('\n');
  }
  lines.push('week        metric                     outcome             count');
  for (const c of counts) lines.push(`${c.week.padEnd(12)}${c.metric.padEnd(27)}${c.outcome.padEnd(20)}${c.count}`);
  const missed = unansweredTrends(counts);
  lines.push('', 'Not answered');
  if (missed.length === 0) lines.push('Every counted question was answered.');
  else for (const c of missed) lines.push(`${c.week}  ${c.metric}  ${c.outcome}  ${c.count}`);
  return lines.join('\n');
}
