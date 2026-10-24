import type { Answer } from '@/semantic/answer';
import { coverageSpec, coverageStanding } from '@/semantic/coverage-target';
import { dateRange, format, timestamp } from './format';

const titleCase = (s: string) => s.replace(/^./, (c) => c.toUpperCase());
const list = (xs: string[]) => xs.join(', ').replace(/, ([^,]*)$/, ' and $1');
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function amountText(amount: NonNullable<Answer['filters']['amount']>): string {
  if (amount.min != null && amount.max != null && amount.min === amount.max && amount.minInclusive !== false && amount.maxInclusive !== false) return `amount ${money(amount.min)}`;
  const bits: string[] = [];
  if (amount.min != null) bits.push(`${amount.minInclusive === false ? 'over' : 'at least'} ${money(amount.min)}`);
  if (amount.max != null) bits.push(`${amount.maxInclusive === false ? 'under' : 'at most'} ${money(amount.max)}`);
  return bits.join(' and ');
}

/** Where an answer's number came from: definition, scope, applied filters, snapshot and audit row. Shown under every answer. */
export function ProvenancePanel({ a }: { a: Answer }) {
  const { filters: f, provenance: p, parts } = a;
  const single = a.rows.length === 1 && 'numerator' in a.rows[0]! ? a.rows[0]! : null;
  const applied = [
    f.period ? `${f.period.label} (${dateRange(f.period.start, f.period.end)})` : 'Any expected close date',
    `${list(f.regions.map(titleCase))} region${f.regions.length > 1 ? 's' : ''}`,
    f.stages ? `stage ${list(f.stages)}` : null,
    f.amount ? amountText(f.amount) : null,
    f.products?.length ? `product ${list(f.products)}` : null,
    f.accounts?.length ? `account ${list(f.accounts)}` : null,
    f.sectors?.length ? `sector ${list(f.sectors)}` : null,
    f.people?.length ? `rep ${list(f.people)}` : null,
    f.teams?.length ? list(f.teams.map((name) => `${name}'s team`)) : null,
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

        {(() => {
          const spec = coverageSpec(a.metric);
          const value = single?.value;
          if (!spec || value == null || typeof value !== 'number') return null;
          const standing = coverageStanding(value, spec);
          return (
            <>
              <dt>Target</dt>
              <dd>{standing.standing}, {standing.words}. The target is {spec.target.toFixed(2)}x.</dd>
            </>
          );
        })()}

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
