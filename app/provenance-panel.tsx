import type { Answer } from '@/semantic/answer';
import { coverageReceipt, coverageSpec } from '@/semantic/coverage-target';
import { dateRange, format, timestamp } from './format';
import { readingParts } from './reading';

/** Where an answer's number came from: definition, scope, applied filters, snapshot and audit row. Shown under every answer. */
export function ProvenancePanel({ a }: { a: Answer }) {
  const { provenance: p, parts } = a;
  const spec = coverageSpec(a.metric);
  const single = a.rows.length === 1 && 'numerator' in a.rows[0]! ? a.rows[0]! : null;
  const receipt = single && typeof single.value === 'number' && spec ? coverageReceipt(single.value, spec) : null;
  const applied = readingParts(a);

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

        {receipt && (
          <>
            <dt>Target</dt>
            <dd>{receipt}</dd>
          </>
        )}

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
      <p className="governed-note">The number, the sentence and any chart are built from the result rows of the approved metric. Your question was only used to choose the metric and filters; no model wrote any part of this answer.</p>
      <details>
        <summary>Structured intent</summary>
        <code>{JSON.stringify(a.intent)}</code>
      </details>
    </section>
  );
}
