// "Why is my number different?": the fixed explanation, a side-by-side when both figures are the asker's, and the
// arithmetic checks. Every value comes from the governed answers; the question's own numbers are never shown.
import type { Explanation } from '@/semantic/explain';
import type { Answer } from '@/semantic/answer';
import { FactChips, scopeText } from './fact-chips';
import { dateRange, format } from './format';
import { ProvenancePanel } from './provenance-panel';

const part = (a: Answer, key: 'numerator' | 'denominator' | 'value') => a.rows[0]?.[key] ?? null;

function SideBySide({ a, b }: { a: Answer; b: Answer }) {
  const rows: [string, (x: Answer) => string][] = [
    ['Metric', (x) => `${x.metric.name} v${x.metric.version}`],
    ['Quarter', (x) => x.filters.period?.label ?? '—'],
    ['Scope', (x) => scopeText(x.scope)],
    ['Filtered to', (x) => [...(x.filters.teams ?? []).map((t) => `${t}'s team`), ...(x.filters.people ?? [])].join(', ') || 'none'],
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

export function ExplanationView({ e }: { e: Explanation }) {
  const a = e.answer;
  return (
    <div className="answer explanation">
      <h3>Why a coverage number can differ</h3>
      {!e.other && <p className="answer-value">{format(part(a, 'value'), 'ratio')}</p>}
      <FactChips label="Scope and data date" items={[['Scope', scopeText(a.scope)], ['Data as of', dateRange(a.provenance.asOfDate)]]} />
      <p className="narrative">{e.summary}</p>
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
      <ProvenancePanel a={a} />
    </div>
  );
}
