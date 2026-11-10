import { activeDatasetLabel, AS_OF_DATE, demoUsers } from '@/db/seed';
import { answerIntent } from '@/semantic/answer';
import { capitalize, coverageSpec, coverageStanding, coverageTrackMax, type CoverageTarget } from '@/semantic/coverage-target';
import { resolvePeriod } from '@/semantic/periods';
import { resolvePrincipal } from '@/semantic/scope';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireUser } from '@/server/require-user';
import { logOutAction } from './auth-actions';
import { alertQuestion } from '@/server/prompts';
import { loginPath } from '@/server/return-to';
import { alertsLink } from '@/server/alerts-link';
import { getDatabase, getRegistry } from '@/server/runtime';
import { AppShell } from './app-shell';
import { AskPanel } from './ask-panel';
import { FactChips, scopeText } from './fact-chips';
import { format, dateRange } from './format';
import { Chart3D } from './chart3d';
import { coverageRegionCharts, kpiStageChart } from './chart-data';
import { ScopeMap } from './scope-map';
import { readTheme } from './theme';
import { readChartKinds, readView } from './view-mode';
import { ViewSwitch } from './view-switch';
import './overview.css';

export const dynamic = 'force-dynamic';

const USERS = demoUsers();

// Each example answers for every demo person: coverage needs a quarter, and a technical seller sees one region and one stage.
const EXAMPLES = ['What is our open pipeline?', 'open pipeline by owner', 'open opportunities by owner', 'pipeline coverage this quarter'];

type Governed = Awaited<ReturnType<typeof answerIntent>>;
type Registry = ReturnType<typeof getRegistry>;
type Kinds = Awaited<ReturnType<typeof readChartKinds>> | undefined;

/** Who is signed in, with Log out; or, with no session and ALLOW_TEST_IDENTITIES=true, the local-testing identity switch. */
function Who({ signedIn, user, name }: { signedIn: boolean; user: string; name: string }) {
  if (signedIn) {
    return (
      <form className="who" action={logOutAction}>
        <span>Signed in as {name}</span>
        <button type="submit">Log out</button>
      </form>
    );
  }
  return (
    <form className="who" method="get">
      <label htmlFor="user">Viewing as</label>
      <select id="user" name="user" defaultValue={user}>
        {USERS.map((u) => (
          <option key={u.id} value={u.id}>{u.displayName}</option>
        ))}
      </select>
      <button type="submit">Switch</button>
    </form>
  );
}

/** The map card: coverage for every region, lit where the person's access reaches (app/scope-map.tsx). */
function MapCard({ byRegion, allowed, period, goal, metricCount }: { byRegion: Governed; allowed: readonly string[]; period: string; goal: CoverageTarget | null; metricCount: number }) {
  return (
    <section className="card map-card" aria-labelledby="map-title">
      <h2 id="map-title">Coverage by region · {period}</h2>
      <p className="sub">Every number comes from the approved metrics at the centre. Regions in your access are lit; the others stay locked.</p>
      <ScopeMap rows={byRegion.rows} allowed={allowed} period={period} goal={goal} metricCount={metricCount} />
      <p className="bars-note">{goal ? `The line on each bar marks the ${goal.target.toFixed(2)}x target. Red is below ${goal.caution.toFixed(2)}x, amber is from ${goal.caution.toFixed(2)}x up to the target, and green is at or above the target. 1.00x still means pipeline equals quota.` : 'The line on each bar marks 1.00x. No coverage target is defined in the metric registry yet, so the dashboard does not label results as on or off target.'}</p>
    </section>
  );
}

/** The coverage tile: the total against the target, with the bar and the sum it comes from. */
function CoverageTile({ coverage, period, goal, children }: { coverage: Governed; period: string; goal: CoverageTarget | null; children?: ReactNode }) {
  // Coverage with no quota is NULL: shown as not available, never as 0.00x.
  const covRaw = coverage.rows[0]?.value;
  const cov = covRaw === null || covRaw === undefined ? null : Number(covRaw);
  const standing = goal && cov != null ? coverageStanding(cov, goal) : null;
  const tone = standing ? `tone-${standing.tone}` : '';
  const line = goal?.target ?? 1;
  const max = coverageTrackMax(line, [cov ?? 0]);
  const reading = standing ? `${capitalize(standing.standing)}, ${standing.words}. 1.00x means pipeline equals quota.` : '1.00x means pipeline equals quota.';
  return (
    <div className="kpi kpi-coverage">
      <span className="label">Pipeline coverage · {period}</span>
      <p className="kpi-reading">
        <span className={`value ${tone}`}>{format(cov, 'ratio')}</span>
        {standing && <span className={`kpi-standing ${tone}`}>{capitalize(standing.standing)}</span>}
      </p>
      <div className="track" aria-hidden="true">
        <div className={tone ? `fill ${tone}` : 'fill'} style={{ width: `${((cov ?? 0) / max) * 100}%` }} />
        <div className="target" style={{ left: `${(line / max) * 100}%` }} />
      </div>
      <p className="note">{format(coverage.rows[0]?.numerator, 'currency')} open pipeline closing in {period} ÷ {format(coverage.rows[0]?.denominator, 'currency')} quota for {period}. {cov === null ? 'There is no quota for this period, so coverage is not available.' : reading}</p>
      {children}
    </div>
  );
}

/** The headline tiles. In the Graphs view each one also carries its graph. */
function Tiles({ answers, period, goal, graphs, kinds }: {
  answers: { coverage: Governed; byRegion: Governed; pipeline: Governed; count: Governed; pipelineByStage: Governed | null; countByStage: Governed | null };
  period: string;
  goal: CoverageTarget | null;
  graphs: boolean;
  kinds: Kinds;
}) {
  const { coverage, byRegion, pipeline, count, pipelineByStage, countByStage } = answers;
  // In the Graphs view, a mouse drag on the page around the graphs turns them too.
  const surface = graphs ? { 'data-c3d-surface': '' } : {};
  return (
    <section className={graphs ? 'tiles graphs' : 'tiles'} aria-label="Headline numbers" {...surface}>
      <CoverageTile coverage={coverage} period={period} goal={goal}>
        {graphs && <Chart3D charts={coverageRegionCharts(byRegion, period, 'coverage-region')} kinds={kinds} />}
      </CoverageTile>
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
  );
}

/** The governed metrics and business rules, from the version-controlled registry. */
function Rulebook({ registry }: { registry: Registry }) {
  return (
    <section className="card" id="rulebook" aria-labelledby="metrics-title">
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
  );
}

export default async function Home({ searchParams }: { searchParams: Promise<{ user?: string; prompt?: string; account?: string }> }) {
  // The signed-in person comes only from the session. The "Viewing as" switch is a local-testing fallback,
  // shown only when there is no session and ALLOW_TEST_IDENTITIES=true.
  const params = await searchParams;
  const actor = await requireUser(params.user, 'u_ts_east');
  // Signed out from an alert's link: sign-in keeps its question and account (checked ids only, see return-to.ts).
  if (!actor) redirect(loginPath(params));
  const user = actor.userId;
  const signedIn = Boolean(actor.username);
  const registry = getRegistry();
  const database = await getDatabase();
  // From an alert: its account's name, read from the data by id, never text from the URL (UX review, Nov 2).
  const initialQuestion = await alertQuestion(database.db, params.prompt, params.account);
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
  const [pipeline, coverage, count, byRegion, pipelineByStage, countByStage, principal, theme] = await Promise.all([
    answerIntent(database, registry, user, { metric: 'open_pipeline', filters: {}, groupBy: [] }, 'dashboard', actor),
    answerIntent(database, registry, user, { metric: 'pipeline_coverage', filters: { period }, groupBy: [] }, 'dashboard', actor),
    answerIntent(database, registry, user, { metric: 'open_opportunity_count', filters: {}, groupBy: [] }, 'dashboard', actor),
    answerIntent(database, registry, user, { metric: 'pipeline_coverage', filters: { period }, groupBy: ['region'] }, 'dashboard', actor),
    split('open_pipeline'),
    split('open_opportunity_count'),
    // Which regions the map lights: the person's own row, as every query reads it (src/semantic/scope.ts).
    resolvePrincipal(database.db, user),
    readTheme(),
  ]);
  const goal = coverageSpec(coverage.metric);
  const range = coverage.filters.period;
  const quarter = range ? `${period} (${dateRange(range.start, range.end)})` : period;
  const asOf = dateRange(pipeline.provenance.asOfDate);

  return (
    <AppShell
      current="overview"
      analyst={me.role === 'analyst'}
      alertsHref={alertsLink(process.env.ALERTS_URL)}
      theme={theme}
      dataset={activeDatasetLabel()}
      asOf={asOf}
      metricCount={registry.metrics.size}
      who={<Who signedIn={signedIn} user={user} name={me.displayName} />}
    >
      <main {...(graphs ? { 'data-c3d-surface': '' } : {})}>
        <div className="page-head" id="overview">
          <h1>Pipeline overview</h1>
          <FactChips label="Scope, quarter and data date" items={[['Scope', scopeText(pipeline.scope)], ['Fiscal quarter', quarter], ['Data as of', asOf]]} />
          <p>{signedIn ? 'Your access comes from your account.' : 'Identity switch for local testing only.'}</p>
          <ViewSwitch view={view} />
        </div>
        <MapCard byRegion={byRegion} allowed={principal.regions} period={period} goal={goal} metricCount={registry.metrics.size} />
        <Tiles answers={{ coverage, byRegion, pipeline, count, pipelineByStage, countByStage }} period={period} goal={goal} graphs={graphs} kinds={kinds} />
        <div id="ask">
          <AskPanel
            user={user}
            name={me.displayName.split(' (')[0]!}
            examples={EXAMPLES}
            initialQuestion={initialQuestion}
            view={view}
            metricDims={Object.fromEntries([...registry.metrics.values()].map((m) => [m.id, m.dimensions]))}
            scope={pipeline.scope}
          />
        </div>
        <Rulebook registry={registry} />
      </main>
    </AppShell>
  );
}
