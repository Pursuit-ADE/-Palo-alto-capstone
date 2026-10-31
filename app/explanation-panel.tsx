// "Why is my number different?": the fixed explanation, a side-by-side when both figures are the asker's, and the
// arithmetic checks. Every value comes from the governed answers; the question's own numbers are never shown.
import type { Explanation } from '@/semantic/explain';
import type { Answer } from '@/semantic/answer';
import { FactChips, scopeText } from './fact-chips';
import { dateRange, format } from './format';
import { ProvenancePanel } from './provenance-panel';

const part = (a: Answer, key: 'numerator' | 'denominator' | 'value') => a.rows[0]?.[key] ?? null;
const title = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** What the question itself narrowed the figure to: named regions, teams and reps. The asker's access is the Scope row. */
function filteredTo(a: Answer): string {
  const regions = (a.intent as { filters?: { regions?: string[] } }).filters?.regions ?? [];
  const named = [
    ...(regions.length ? [`${regions.map(title).join(' and ')} region${regions.length > 1 ? 's' : ''}`] : []),
    ...(a.filters.teams ?? []).map((t) => `${t}'s team`),
    ...(a.filters.people ?? []),
  ];
  return named.join(', ') || 'none';
}

function SideBySide({ a, b }: { a: Answer; b: Answer }) {
  const rows: [string, (x: Answer) => string][] = [
    ['Metric', (x) => `${x.metric.name} v${x.metric.version}`],
    ['Quarter', (x) => x.filters.period?.label ?? '—'],
    ['Scope', (x) => scopeText(x.scope)],
    ['Filtered to', filteredTo],
    ['Open pipeline', (x) => format(part(x, 'numerator'), 'currency')],
    ['Quota', (x) => format(part(x, 'denominator'), 'currency')],
    ['Coverage', (x) => format(part(x, 'value'), 'ratio')],
    ['Snapshot', (x) => x.provenance.snapshotId],
  ];
  return (
    <div className="tablewrap">
      <table className="side-by-side">
        <thead><tr><th scope="col">Input</th><th scope="col">First figure</th><th scope="col">Second figure</th></tr></thead>
        <tbody>
          {rows.map(([label, value]) => {
            const [va, vb] = [value(a), value(b)];
            return (
              <tr key={label} className={va === vb ? undefined : 'differs'}>
                <th scope="row">{label}</th><td>{va}</td><td>{vb}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The heading says what the summary says: two figures that differ, two that are the same, or the asker's own one. */
function heading(e: Explanation): string {
  if (!e.other) return 'Your coverage, and what can make another figure differ';
  const same = e.verdict === 'same_inputs' || JSON.stringify(e.answer.rows) === JSON.stringify(e.other.rows);
  return same ? 'These two coverage figures are the same' : 'Why these two coverage figures differ';
}

export function ExplanationView({ e }: { e: Explanation }) {
  const a = e.answer;
  return (
    <div className="answer explanation">
      {/* One figure means the other number is outside the asker's scope or wasn't named: say so, don't promise a reason. */}
      <h3>{heading(e)}</h3>
      {/* The client asked for the one-sentence answer first; with one figure it also says the other wasn't checked. */}
      <p className="narrative">{e.summary}</p>
      {!e.other && <p className="answer-value">{format(part(a, 'value'), 'ratio')}</p>}
      <FactChips label="Scope and data date" items={[['Scope', scopeText(a.scope)], ['Data as of', dateRange(a.provenance.asOfDate)]]} />
      {e.reasons.length > 0 && (
        <ul className="reasons">
          {e.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
      {e.other && <SideBySide a={a} b={e.other} />}
      <ul className="checks" aria-label="Arithmetic checks">
        {e.checks.map((c) => (
          <li key={c.label} className={c.ok ? 'ok' : 'bad'}>
            <span className="check-tag">{c.ok ? 'Checked' : 'Failed'}</span> {c.label}
          </li>
        ))}
      </ul>
      {e.other ? (
        // Each figure has its own audit row (source "comparison_side" for the second), so each gets its own panel.
        <div className="provenance-pair">
          <div><h4 className="figure-label">First figure</h4><ProvenancePanel a={a} /></div>
          <div><h4 className="figure-label">Second figure</h4><ProvenancePanel a={e.other} /></div>
        </div>
      ) : (
        <ProvenancePanel a={a} />
      )}
    </div>
  );
}
