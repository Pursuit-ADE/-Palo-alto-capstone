import { AS_OF_DATE, USERS } from '@/db/seed';
import { answerIntent, ask, type Answer, type Reply } from '@/semantic/answer';
import { IntentError } from '@/semantic/compile';
import { resolvePeriod } from '@/semantic/periods';
import { ScopeViolation } from '@/semantic/scope';
import { getDatabase, getRegistry } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const EXAMPLES = ['What is our open pipeline?', 'coverage by region for this quarter', 'open opportunities by stage', 'pipeline coverage'];
// Common sales rule of thumb, used only to color the coverage tiles (assumption, not a governed metric).
const COVERAGE_TARGET = 3;

function format(value: unknown, unit: string): string {
  if (typeof value !== 'number') return String(value ?? '');
  if (unit === 'currency') return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  if (unit === 'ratio') return `${value.toFixed(2)}x`;
  return value.toLocaleString('en-US');
}

function compactUsd(value: number): string {
  return value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}M` : `$${Math.round(value / 1000)}K`;
}

function coverageHealth(v: number) {
  if (v >= COVERAGE_TARGET) return { cls: 'ok', text: 'On target' };
  if (v >= 2) return { cls: 'warn', text: 'Below target' };
  return { cls: 'bad', text: 'At risk' };
}

function cell(k: string, v: unknown, unit: string): string {
  if (k === 'value') return format(v, unit);
  if (k === 'numerator' || k === 'denominator') return format(v, 'currency');
  if (k === 'region') return String(v).replace(/^./, (c) => c.toUpperCase());
  return String(v);
}

export default async function Home({ searchParams }: { searchParams: Promise<{ user?: string; q?: string }> }) {
  const params = await searchParams;
  const user = USERS.some((u) => u.id === params.user) ? params.user! : 'u_ts_east';
  const q = params.q ?? '';
  const registry = getRegistry();
  const database = await getDatabase();
  const me = USERS.find((u) => u.id === user)!;
  const period = resolvePeriod('current', AS_OF_DATE)!;

  // Dashboard tiles: the same governed path as any typed question, so they obey the same scope.
  const [pipeline, coverage, count, byRegion] = await Promise.all([
    answerIntent(database, registry, user, { metric: 'open_pipeline', filters: {}, groupBy: [] }),
    answerIntent(database, registry, user, { metric: 'pipeline_coverage', filters: { period }, groupBy: [] }),
    answerIntent(database, registry, user, { metric: 'open_opportunity_count', filters: {}, groupBy: [] }),
    answerIntent(database, registry, user, { metric: 'pipeline_coverage', filters: { period }, groupBy: ['region'] }),
  ]);
  const cov = Number(coverage.rows[0]?.value ?? 0);
  const health = coverageHealth(cov);

  let reply: Reply | { kind: 'refused'; message: string } | null = null;
  if (q.trim()) {
    try {
      reply = await ask(database, registry, user, q.slice(0, 300));
    } catch (e) {
      if (e instanceof ScopeViolation || e instanceof IntentError) reply = { kind: 'refused', message: e.message };
      else throw e;
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="mark" aria-hidden="true" />
            <div>
              <strong>Governed Analytics Copilot</strong>
              <span>Customer Analytics · Team ALTO PALS</span>
            </div>
          </div>
          <span className="badge">Synthetic data</span>
          <form className="who" method="get">
            <label htmlFor="user">Viewing as</label>
            <select id="user" name="user" defaultValue={user}>
              {USERS.map((u) => (
                <option key={u.id} value={u.id}>{u.displayName}</option>
              ))}
            </select>
            <button type="submit" className="badge" style={{ background: 'transparent', cursor: 'pointer' }}>Switch</button>
          </form>
        </div>
      </header>

      <main>
        <div className="page-head">
          <h1>Pipeline overview</h1>
          <p>{pipeline.scope} Fiscal quarter {period} (Aug 1 to Oct 31, 2026). Demo identity switch, not a login.</p>
        </div>

        <section className="kpis" aria-label="Key metrics">
          <div className="kpi">
            <span className="label">Open pipeline</span>
            <span className="value">{compactUsd(Number(pipeline.rows[0]?.value ?? 0))}</span>
            <span className="note">{format(pipeline.rows[0]?.value, 'currency')} across all open deals</span>
          </div>
          <div className="kpi">
            <span className="label">Pipeline coverage · {period}</span>
            <span className="value">{format(cov, 'ratio')}</span>
            <span className="note"><span className={`pill ${health.cls}`}>{health.text}</span> target {COVERAGE_TARGET.toFixed(1)}x</span>
          </div>
          <div className="kpi">
            <span className="label">Open opportunities</span>
            <span className="value">{format(count.rows[0]?.value, 'count')}</span>
            <span className="note">deals not yet won or lost</span>
          </div>
        </section>

        <div className="grid2">
          <section className="card" aria-labelledby="ask-title">
            <h2 id="ask-title">Ask the copilot</h2>
            <p className="sub">Answers come only from the governed metrics below, scoped to {me.displayName.split(' (')[0]}.</p>
            <form className="ask" method="get">
              <input type="hidden" name="user" value={user} />
              <input id="q" name="q" defaultValue={q} placeholder="Ask about open pipeline, pipeline coverage or open opportunities" maxLength={300} aria-label="Question" />
              <button type="submit">Ask</button>
            </form>
            <div className="chips">
              {EXAMPLES.map((e) => (
                <a key={e} href={`/?user=${user}&q=${encodeURIComponent(e)}`}>{e}</a>
              ))}
            </div>

            {reply?.kind === 'answer' && <AnswerView a={reply} />}
            {reply && reply.kind !== 'answer' && (
              <div className="answer refused" role="status">
                {reply.kind === 'clarify' ? reply.question : reply.message}
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="cov-title">
            <h2 id="cov-title">Coverage by region</h2>
            <p className="sub">Open pipeline closing in {period} ÷ quota. Line marks the {COVERAGE_TARGET.toFixed(1)}x target.</p>
            <div className="bars">
              {byRegion.rows.map((r) => {
                const v = Number(r.value ?? 0);
                const max = Math.max(COVERAGE_TARGET * 1.25, ...byRegion.rows.map((x) => Number(x.value ?? 0)));
                return (
                  <div className="bar-row" key={String(r.region)}>
                    <div className="bar-head">
                      <span>{cell('region', r.region, '')} <span className={`pill ${coverageHealth(v).cls}`}>{coverageHealth(v).text}</span></span>
                      <b>{format(v, 'ratio')}</b>
                    </div>
                    <div className="track">
                      <div className="fill" style={{ width: `${(v / max) * 100}%` }} />
                      <div className="target" style={{ left: `${(COVERAGE_TARGET / max) * 100}%` }} />
                    </div>
                    <span className="legend">{format(r.numerator, 'currency')} pipeline vs {format(r.denominator, 'currency')} quota</span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <section className="card" aria-labelledby="metrics-title">
          <h2 id="metrics-title">Governed metrics</h2>
          <p className="sub">Definitions live in the version-controlled registry. Changes go through a reviewed pull request.</p>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Metric</th><th>Definition</th><th>Breakdowns</th><th>Version</th></tr></thead>
              <tbody>
                {[...registry.metrics.values()].map((m) => (
                  <tr key={m.id}><td><b>{m.name}</b></td><td>{m.description}</td><td>{m.dimensions.join(', ')}</td><td>v{m.version}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}

function AnswerView({ a }: { a: Answer }) {
  const cols = Object.keys(a.rows[0] ?? { value: '' });
  return (
    <div className="answer">
      <h3>{a.metric.name}</h3>
      <div className="tablewrap">
        <table>
          <thead><tr>{cols.map((k) => (<th key={k}>{k}</th>))}</tr></thead>
          <tbody>
            {a.rows.map((r, i) => (
              <tr key={i}>{cols.map((k) => (<td key={k}>{cell(k, r[k], a.metric.unit)}</td>))}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="receipt">
        <span><b>Scope</b> · {a.scope.replace(/^Scope: /, '')}</span>
        <span><b>Source</b> · {a.metric.id} v{a.metric.version} · snapshot {a.provenance.snapshotId} (as of {a.provenance.asOfDate}) · result {a.provenance.resultHash}</span>
        <span><b>Intent</b> · <code>{JSON.stringify(a.intent)}</code></span>
      </div>
    </div>
  );
}
