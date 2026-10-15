import { AS_OF_DATE, demoUsers } from '@/db/seed';
import { answerIntent } from '@/semantic/answer';
import { resolvePeriod } from '@/semantic/periods';
import { redirect } from 'next/navigation';
import { testIdentitiesEnabled } from '@/server/identity';
import { currentUserId } from '@/server/session';
import { logOutAction } from './auth-actions';
import { promptFor } from '@/server/prompts';
import { getDatabase, getRegistry } from '@/server/runtime';
import { AskPanel } from './ask-panel';
import { format, cell } from './format';

export const dynamic = 'force-dynamic';

const USERS = demoUsers();

const EXAMPLES = ['What is our open pipeline?', 'coverage by region for this quarter', 'open opportunities by stage', 'pipeline coverage'];

function compactUsd(value: number): string {
  return value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}M` : `$${Math.round(value / 1000)}K`;
}

export default async function Home({ searchParams }: { searchParams: Promise<{ user?: string; prompt?: string }> }) {
  // The signed-in person comes only from the session. The "Viewing as" switch is a local-testing fallback,
  // shown only when there is no session and ALLOW_TEST_IDENTITIES=true.
  const signedIn = await currentUserId();
  if (!signedIn && !testIdentitiesEnabled()) redirect('/login');
  const params = await searchParams;
  const user = signedIn ?? (USERS.some((u) => u.id === params.user) ? params.user! : 'u_ts_east');
  const registry = getRegistry();
  const database = await getDatabase();
  const me = USERS.find((u) => u.id === user)!;
  const period = resolvePeriod('current', AS_OF_DATE)!;

  // Dashboard tiles: the same governed path as any typed question, so they obey the same scope.
  const [pipeline, coverage, count, byRegion] = await Promise.all([
    answerIntent(database, registry, user, { metric: 'open_pipeline', filters: {}, groupBy: [] }, 'dashboard'),
    answerIntent(database, registry, user, { metric: 'pipeline_coverage', filters: { period }, groupBy: [] }, 'dashboard'),
    answerIntent(database, registry, user, { metric: 'open_opportunity_count', filters: {}, groupBy: [] }, 'dashboard'),
    answerIntent(database, registry, user, { metric: 'pipeline_coverage', filters: { period }, groupBy: ['region'] }, 'dashboard'),
  ]);
  const cov = Number(coverage.rows[0]?.value ?? 0);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div>
              <strong>Governed Analytics Copilot</strong>
              <span>Customer Analytics · Team ALTO PALS</span>
            </div>
          </div>
          <span className="badge">Maven CRM data</span>
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

      <main>
        <div className="page-head">
          <h1>Pipeline overview</h1>
          <p>{pipeline.scope} Fiscal quarter {period} (Aug 1 to Oct 31, 2026). {signedIn ? 'Your access comes from your account.' : 'Identity switch for local testing only.'}</p>
        </div>

        <div className="overview">
          <section className="kpis stack" aria-label="All open deals">
            <div className="kpi">
              <span className="label">Open pipeline · all open deals</span>
              <span className="value">{compactUsd(Number(pipeline.rows[0]?.value ?? 0))}</span>
              <span className="note">{format(pipeline.rows[0]?.value, 'currency')}, any expected close date (not limited to {period})</span>
            </div>
            <div className="kpi">
              <span className="label">Open opportunities · all open deals</span>
              <span className="value">{format(count.rows[0]?.value, 'count')}</span>
              <span className="note">deals not yet won or lost</span>
            </div>
          </section>

          <section className="card coverage" aria-labelledby="cov-title">
            <span className="label" id="cov-title">Pipeline coverage · {period}</span>
            <span className="cov-value">{format(cov, 'ratio')}</span>
            <p className="sub">{format(coverage.rows[0]?.numerator, 'currency')} open pipeline closing in {period} ÷ {format(coverage.rows[0]?.denominator, 'currency')} quota for {period}. 1.00x means pipeline equals quota.</p>
            <h2>By region</h2>
            <div className="bars">
              {byRegion.rows.map((r) => {
                const v = Number(r.value ?? 0);
                const max = Math.max(1.25, ...byRegion.rows.map((x) => Number(x.value ?? 0)));
                return (
                  <div className="bar-row" key={String(r.region)}>
                    <div className="bar-head">
                      <span>{cell('region', r.region, '')}</span>
                      <b>{format(v, 'ratio')}</b>
                    </div>
                    <div className="track">
                      <div className="fill" style={{ width: `${(v / max) * 100}%` }} />
                      <div className="target" style={{ left: `${(1 / max) * 100}%` }} title="1.00x: pipeline equals quota" />
                    </div>
                    <span className="legend">{format(r.numerator, 'currency')} closing in {period} vs {format(r.denominator, 'currency')} quota</span>
                  </div>
                );
              })}
            </div>
            <p className="bars-note">The line marks 1.00x. No coverage target is defined in the metric registry yet, so the dashboard does not label results as on or off target.</p>
          </section>
        </div>

        <AskPanel user={user} name={me.displayName.split(' (')[0]!} examples={EXAMPLES} initialQuestion={promptFor(params.prompt)} />

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

