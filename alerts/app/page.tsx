import { eq } from 'drizzle-orm';
import { demoUsers } from '@/db/seed';
import { alertSubscriptions } from '@/db/schema';
import { inbox, statusCounts } from '@/alerts/engine';
import { DEMO_NOW } from '@/alerts/demo';
import { redirect } from 'next/navigation';
import { requireUser } from '@/server/require-user';
import { logOutAction } from './auth-actions';
import { PreferencesForm } from './preferences-form';
import { getAlertsRuntime } from '@/server/runtime';
import { SyntheticBadge } from './synthetic-badge';
import { alertKpis } from './alert-kpis';
import { Chart3D } from './chart3d';
import { readChartKinds, readView } from './view-mode';
import { ViewSwitch } from './view-switch';

export const dynamic = 'force-dynamic';

const USERS = demoUsers();

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ user?: string }> }) {
  // The signed-in person comes only from the session. The "Viewing as" switch is a local-testing fallback,
  // shown only when nobody is signed in and ALLOW_TEST_IDENTITIES=true.
  const params = await searchParams;
  const actor = await requireUser(params.user, 'u_ts_east');
  if (!actor) redirect('/login');
  const user = actor.userId;
  const signedIn = actor.username ? user : undefined;
  const me = USERS.find((u) => u.id === user)!;
  const { database, rules } = await getAlertsRuntime();
  // Only delivered alerts are readable. Held, blocked or failed alerts are counted, never shown.
  const mine = await inbox(database.db, user);
  const counts = await statusCounts(database.db, user);
  const kpis = alertKpis(counts);
  const view = await readView();
  const graphs = view === 'graphs';
  const kinds = graphs ? await readChartKinds() : undefined;
  // In the Graphs view, a mouse drag on the page around the graph turns it too.
  const surface = graphs ? { 'data-c3d-surface': '' } : {};
  const myRules = [...rules.values()].filter((r) => (r.audience as string[]).includes(me.role));
  const subs = await database.db.select().from(alertSubscriptions).where(eq(alertSubscriptions.userId, user));

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div>
              <strong>Actionable Alerts</strong>
              <span>Customer Analytics · Team ALTO PALS</span>
            </div>
          </div>
          <SyntheticBadge />
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
          <h1>Your alerts</h1>
          <p><strong>Private to {me.displayName.split(' (')[0]}.</strong> Alerts only cover accounts on your account team, and access is checked again right before each one is sent. Data as of {DEMO_NOW.toISOString().slice(0, 16).replace('T', ' ')} UTC. {signedIn ? 'Your access comes from your account.' : 'Identity switch for local testing only.'}</p>
          <ViewSwitch view={view} />
        </div>

        {graphs ? (
          <section className="card" aria-label="Alert summary">
            <Chart3D
              charts={[
                {
                  id: 'alert-summary',
                  title: 'Your alerts by status',
                  unit: 'count',
                  size: 'card',
                  form: 'columns',
                  categoryName: 'Status',
                  categories: kpis.map((k) => ({ key: k.key, label: k.label })),
                  series: ['Alerts'],
                  data: kpis.map((k) => ({ category: k.key, series: 0, value: k.value, display: k.value.toLocaleString('en-US'), detail: k.detail ?? k.note })),
                  summary: `Your alerts by status: ${kpis.map((k) => `${k.label} ${k.value}`).join(', ')}.`,
                  parts: true, // the three statuses don't overlap, so a donut of them is honest
                },
              ]}
              kinds={kinds}
            />
          </section>
        ) : (
          <section className="kpis" aria-label="Alert summary">
            {kpis.map((k) => (
              <div className="kpi" key={k.key}><span className="label">{k.label}</span><span className="value">{k.value}</span><span className="note">{k.note}</span></div>
            ))}
          </section>
        )}

        <section className="card" aria-labelledby="inbox-title">
          <h2 id="inbox-title">Inbox</h2>
          <p className="sub">Each alert says why it fired and which rule version fired it.</p>
          {mine.length === 0 ? (
            <p className="empty">No alerts for you right now. You get alerts only for rules you subscribe to, on accounts you work on.</p>
          ) : (
            <ul className="alerts">
              {mine.map((a) => (
                <li key={a.id} className={`alert sev-${a.severity.toLowerCase()}`}>
                  <div className="alert-head">
                    <span className={`pill sev sev-${a.severity.toLowerCase()}`}>{a.severity === 'info' ? 'Info' : a.severity}</span>
                    <b>{a.title}</b>
                  </div>
                  <p>{a.explanation}</p>
                  {/* A new tab, so the inbox stays open behind the copilot (Nov 1 demo test). noopener: the copilot page gets no handle back to this one. */}
                  <a href={a.link} target="_blank" rel="noopener noreferrer">Ask the copilot about this (opens in a new tab)</a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid2">
          <section className="card" aria-labelledby="subs-title">
            <h2 id="subs-title">Your subscriptions</h2>
            <p className="sub">Choose the alerts you want, how often, where, and your quiet hours. Only alerts meant for your role are listed. Changes apply to new alerts; ones already waiting keep their channel.</p>
            {myRules.length === 0 ? (
              <p className="empty">No alerts are available for your role yet.</p>
            ) : (
              <div className="prefs">
                {myRules.map((r) => {
                  const s = subs.find((x) => x.ruleId === r.id) ?? null;
                  return (
                    <PreferencesForm
                      key={`${user}-${r.id}`}
                      user={user}
                      ruleId={r.id}
                      ruleName={r.name}
                      critical={r.criticalSeverities.length > 0}
                      sub={s ? { frequency: s.frequency, quietStartHour: s.quietStartHour, quietEndHour: s.quietEndHour, criticalBypass: s.criticalBypass, channel: s.channel } : null}
                    />
                  );
                })}
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="rules-title">
            <h2 id="rules-title">Rule catalog</h2>
            <p className="sub">Versioned rule files, changed only through a reviewed pull request.</p>
            <ul className="rules">
              {[...rules.values()].map((r) => (
                <li key={r.id}>
                  <b>{r.name}</b> <span className="muted">v{r.version} · for {r.audience.map((a) => a.replace('_', ' ')).join(', ')}</span>
                  <p>{r.description}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </>
  );
}

