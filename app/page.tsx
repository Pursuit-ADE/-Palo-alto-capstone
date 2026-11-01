import { activeDatasetLabel, AS_OF_DATE, demoUsers } from '@/db/seed';
import { answerIntent } from '@/semantic/answer';
import { capitalize, coverageSpec, coverageStanding, coverageTrackMax, type CoverageTarget } from '@/semantic/coverage-target';
import type { Answer } from '@/semantic/answer';
import { resolvePeriod } from '@/semantic/periods';
import { redirect } from 'next/navigation';
import { requireUser } from '@/server/require-user';
import { logOutAction } from './auth-actions';
import { SyntheticBadge } from './synthetic-badge';
import { promptFor } from '@/server/prompts';
import { alertsLink } from '@/server/alerts-link';
import { getDatabase, getRegistry } from '@/server/runtime';
import { AskPanel } from './ask-panel';
import { FactChips, scopeText } from './fact-chips';
import { format, cell, dateRange } from './format';
import { Chart3D } from './chart3d';
import { coverageRegionCharts, kpiStageChart } from './chart-data';
import { readChartKinds, readView } from './view-mode';
import { ViewSwitch } from './view-switch';

export const dynamic = 'force-dynamic';

function CoverageBars({ rows, period, goal }: { rows: Answer['rows']; period: string; goal: CoverageTarget | null }) {
  const line = goal?.target ?? 1;
  const max = coverageTrackMax(line, rows.map((x) => Number(x.value ?? 0)));
  return (
    <div className="bars">
      {rows.map((r) => (
        <CoverageBar key={String(r.region)} row={r} period={period} goal={goal} max={max} line={line} />
      ))}
    </div>
  );
}

function CoverageBar({ row, period, goal, max, line }: { row: Answer['rows'][number]; period: string; goal: CoverageTarget | null; max: number; line: number }) {
  const v = row.value === null || row.value === undefined ? null : Number(row.value);
  const regionStanding = goal && v != null ? coverageStanding(v, goal) : null;
  const tone = regionStanding ? `tone-${regionStanding.tone}` : undefined;
  const legend = v === null ? ' (no quota, so not available)' : regionStanding ? ` · ${regionStanding.standing}, ${regionStanding.words}.` : '';
  return (
    <div className="bar-row">
      <div className="bar-head">
        <span>{cell('region', row.region, '')}</span>
        <b className={tone}>{format(v, 'ratio')}</b>
      </div>
      <div className="track">
        <div className={tone ? `fill ${tone}` : 'fill'} style={{ width: `${((v ?? 0) / max) * 100}%` }} />
        <div className="target" style={{ left: `${(line / max) * 100}%` }} title={goal ? `${goal.target.toFixed(2)}x target` : '1.00x: pipeline equals quota'} />
      </div>
      <span className="legend">{format(row.numerator, 'currency')} closing in {period} vs {format(row.denominator, 'currency')} quota{legend}</span>
    </div>
  );
}

/** A link to the alerts app. It has its own accounts, so the person signs in there separately. */
function AlertsLink({ href }: { href: string | null }) {
  if (!href) return null;
  return <p><a href={href}>My alerts</a> (opens the alerts app, where you sign in separately)</p>;
}

const USERS = demoUsers();

// Each example answers for every demo person: coverage needs a quarter, and a technical seller sees one region and one stage.
const EXAMPLES = ['What is our open pipeline?', 'open pipeline by owner', 'open opportunities by owner', 'pipeline coverage this quarter'];

export default async function Home({ searchParams }: { searchParams: Promise<{ user?: string; prompt?: string }> }) {
  // The signed-in person comes only from the session. The "Viewing as" switch is a local-testing fallback,
  // shown only when there is no session and ALLOW_TEST_IDENTITIES=true.
  const params = await searchParams;
  const actor = await requireUser(params.user, 'u_ts_east');
  if (!actor) redirect('/login');
  const user = actor.userId;
  const signedIn = actor.username ? user : undefined;
  const registry = getRegistry();
  const database = await getDatabase();
  const me = USERS.find((u) => u.id === user)!;
  const period = resolvePeriod('current', AS_OF_DATE)!;
  const view = await readView();
  const graphs = view === 'graphs';
  const kinds = graphs ? await readChartKinds() : undefined;

  // Dashboard tiles: the same governed path as any typed question, so they obey the same scope.
  // The Graphs view also splits the two tiles by stage: two more governed (scoped, audited) calls, made only then.
  // A split that fails or doesn't add up never breaks the page; the graph shows the tile's total instead.
  const split = (metric: string) =>
    graphs ? answerIntent(database, registry, user, { metric, filters: {}, groupBy: ['stage'] }, 'dashboard_graph', actor).catch(() => null) : Promise.resolve(null);
  const [pipeline, coverage, count, byRegion, pipelineByStage, countByStage] = await Promise.all([
    answerIntent(database, registry, user, { metric: 'open_pipeline', filters: {}, groupBy: [] }, 'dashboard', actor),
    answerIntent(database, registry, user, { metric: 'pipeline_coverage', filters: { period }, groupBy: [] }, 'dashboard', actor),
    answerIntent(database, registry, user, { metric: 'open_opportunity_count', filters: {}, groupBy: [] }, 'dashboard', actor),
    answerIntent(database, registry, user, { metric: 'pipeline_coverage', filters: { period }, groupBy: ['region'] }, 'dashboard', actor),
    split('open_pipeline'),
    split('open_opportunity_count'),
  ]);
  // Coverage with no quota is NULL: shown as not available, never as 0.00x.
  const covRaw = coverage.rows[0]?.value;
  const cov = covRaw === null || covRaw === undefined ? null : Number(covRaw);
  const coverageGoal = coverageSpec(coverage.metric);
  const standing = coverageGoal && cov != null ? coverageStanding(cov, coverageGoal) : null;
  // In the Graphs view, a mouse drag on the page around the graphs turns them too.
  const surface = graphs ? { 'data-c3d-surface': '' } : {};
  const quarter = coverage.filters.period ? `${period} (${dateRange(coverage.filters.period.start, coverage.filters.period.end)})` : period;
  const alerts = alertsLink(process.env.ALERTS_URL);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="mark" aria-hidden="true" />
            <div>
              <strong>Governed Analytics Copilot</strong>
              <span>Customer Analytics · Team ALTO PALS</span>
            </div>
          </div>
          <SyntheticBadge dataset={activeDatasetLabel()} />
          {signedIn ? (
            <form className="who" action={logOutAction}>
              <span>Signed in as {me.displayName}</span>
              <button type="submit" className="badge" style={{ background: 'transparent', cursor: 'pointer' }}>Log out</button>
            </form>
          ) : (
            <form className="who" method="get">
              <label htmlFor="user">Viewing as</label>
              <select id="user" name="user" defaultValue={user}>
                {USERS.map((u) => (
                  <option key={u.id} value={u.id}>{u.displayName}</option>
                ))}
              </select>
              <button type="submit" className="badge" style={{ background: 'transparent', cursor: 'pointer' }}>Switch</button>
            </form>
          )}
        </div>
      </header>

      <main {...surface}>
        <div className="page-head">
          <h1>Pipeline overview</h1>
          <FactChips
            label="Scope, quarter and data date"
            items={[['Scope', scopeText(pipeline.scope)], ['Fiscal quarter', quarter], ['Data as of', dateRange(pipeline.provenance.asOfDate)]]}
          />
          <p>{signedIn ? 'Your access comes from your account.' : 'Identity switch for local testing only.'}</p>
          {me.role === 'analyst' && <p><a href="/trends">Question trends</a></p>}
          <AlertsLink href={alerts} />
          <ViewSwitch view={view} />
        </div>

        <div className="overview" {...surface}>
          <section className="kpis stack" aria-label="All open deals" {...surface}>
            <div className="kpi">
              <span className="label">Open pipeline · all open deals</span>
              <span className="value">{format(pipeline.rows[0]?.value, 'currency')}</span>
              <span className="note">Any expected close date (not limited to {period})</span>
              {graphs && <Chart3D charts={[kpiStageChart(pipeline, pipelineByStage, 'kpi-pipeline', 'Open pipeline by stage')]} kinds={kinds} />}
            </div>
            <div className="kpi">
              <span className="label">Open opportunities · all open deals</span>
              <span className="value">{format(count.rows[0]?.value, 'count')}</span>
              <span className="note">deals not yet won or lost</span>
              {graphs && <Chart3D charts={[kpiStageChart(count, countByStage, 'kpi-count', 'Open opportunities by stage')]} kinds={kinds} />}
            </div>
          </section>

          <section className="card coverage" aria-labelledby="cov-title">
            <span className="label" id="cov-title">Pipeline coverage · {period}</span>
            <span className={standing ? `cov-value tone-${standing.tone}` : 'cov-value'}>{format(cov, 'ratio')}</span>
            <p className="sub">{format(coverage.rows[0]?.numerator, 'currency')} open pipeline closing in {period} ÷ {format(coverage.rows[0]?.denominator, 'currency')} quota for {period}. {cov === null ? 'There is no quota for this period, so coverage is not available.' : standing ? `${capitalize(standing.standing)}, ${standing.words}. 1.00x means pipeline equals quota.` : '1.00x means pipeline equals quota.'}</p>
            {graphs ? (
              <Chart3D charts={coverageRegionCharts(byRegion, period, 'coverage-region')} kinds={kinds} />
            ) : (
            <>
            <h2>By region</h2>
            <CoverageBars rows={byRegion.rows} period={period} goal={coverageGoal} />
            </>
            )}
            <p className="bars-note">{coverageGoal ? `The line marks the ${coverageGoal.target.toFixed(2)}x target. Red is below ${coverageGoal.caution.toFixed(2)}x, amber is from ${coverageGoal.caution.toFixed(2)}x up to the target, and green is at or above the target. 1.00x still means pipeline equals quota.` : 'The line marks 1.00x. No coverage target is defined in the metric registry yet, so the dashboard does not label results as on or off target.'}</p>
          </section>
        </div>

        <AskPanel
          user={user}
          name={me.displayName.split(' (')[0]!}
          examples={EXAMPLES}
          initialQuestion={promptFor(params.prompt)}
          view={view}
          metricDims={Object.fromEntries([...registry.metrics.values()].map((m) => [m.id, m.dimensions]))}
        />

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
          <h3>Business rules</h3>
          <p className="sub">How the numbers are defined. Same registry, same review.</p>
          <div className="tablewrap">
            <table>
              <tbody>
                {registry.glossary.businessRules.map((r) => (
                  <tr key={r.id}><td><b>{r.id.replace(/_/g, ' ')}</b></td><td>{r.rule}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}

