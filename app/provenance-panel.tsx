import type { Answer } from '@/semantic/answer';
import { dateRange, format, timestamp } from './format';

const titleCase = (s: string) => s.replace(/^./, (c) => c.toUpperCase());
const list = (xs: string[]) => xs.join(', ').replace(/, ([^,]*)$/, ' and $1');

/** Where an answer's number came from: definition, scope, applied filters, snapshot and audit row. Shown under every answer. */
export function ProvenancePanel({ a }: { a: Answer }) {
  const { filters: f, provenance: p, parts } = a;
  const single = a.rows.length === 1 && 'numerator' in a.rows[0]! ? a.rows[0]! : null;
  const applied = [
    f.period ? `${f.period.label} (${dateRange(f.period.start, f.period.end)})` : 'Any expected close date',
    `${list(f.regions.map(titleCase))} region${f.regions.length > 1 ? 's' : ''}`,
    f.stages ? `stage ${list(f.stages)}` : null,
    f.groupBy.length ? `by ${list(f.groupBy)}` : null,
  ].filter(Boolean);

  return (
    <section className="provenance" aria-label={`Where this ${a.metric.name.toLowerCase()} number came from`}>
      <h4>Where this number came from</h4>
      <dl>
        <dt>Metric</dt>
        <dd>
          <b>{a.metric.name}</b> <span className="ver">v{a.metric.version}</span> · {a.metric.definition}
          {a.metric.notes && <span className="note"> {a.metric.notes}</span>}
        </dd>

        <dt>Scope</dt>
        <dd>{a.scope.replace(/^Scope: /, '')}</dd>

        <dt>Filters</dt>
        <dd>{applied.join(' · ')}</dd>

        {parts && (
          <>
            <dt>Numerator</dt>
            <dd>
              <b>{parts.numerator.label}</b>{single && <> = {format(single.numerator, 'currency')}</>} · {parts.numerator.definition}
              <span className="part-scope">Scope: {parts.numerator.scope}</span>
            </dd>
            <dt>Denominator</dt>
            <dd>
              <b>{parts.denominator.label}</b>{single && <> = {format(single.denominator, 'currency')}</>} · {parts.denominator.definition}
              <span className="part-scope">Scope: {parts.denominator.scope}</span>
              {!single && <span className="part-scope">Values for each row are in the numerator and denominator columns above.</span>}
            </dd>
          </>
        )}

        <dt>Data</dt>
        <dd>
          Snapshot <code>{p.snapshotId}</code>, as of {dateRange(p.asOfDate)}, loaded {timestamp(p.loadedAt)}
          {p.dataNote && <span className="part-scope">{p.dataNote}</span>}
        </dd>

        <dt>Receipt</dt>
        <dd className="ids">
          <span>Result <code>{p.resultHash}</code></span>
          <span>Audit <code>{p.auditId || 'pending'}</code></span>
        </dd>
      </dl>
      <details>
        <summary>Structured intent</summary>
        <code>{JSON.stringify(a.intent)}</code>
      </details>
    </section>
  );
}
