import { desc, eq } from 'drizzle-orm';
import { demoUsers } from '@/db/seed';
import { alertSubscriptions, dataSnapshots } from '@/db/schema';
import { inbox, statusCounts } from '@/alerts/engine';
import { easternHour, snapshotDay } from '@/alerts/time';
import { destinationsFor } from '@/alerts/channels';
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

// The tag on a non-case alert names what kind of signal it is. "Info" read as low priority, but a CXO engagement is
// the rep's actionable signal (UX review Nov 2, OPT 7). Case alerts keep their P1/P2 severity.
const TAG_BY_EVENT: Record<string, string> = { engagement: 'CXO', low_usage: 'Usage' };

/**
 * Alerts with the same headline (the same rule, severity and account) as one card, with each one's reason listed in it.
 * Darcel had three "CXO engagement at Donquadtech" cards that differed only in the asset and the date (UX review Nov 2,
 * BH r2 7). The inbox is already sorted by severity, then title, so equal titles sit together. One copilot link per card:
 * every alert in it names the same account.
 */
function groupByTitle<T extends { title: string }>(rows: T[]): [T, ...T[]][] {
  const groups: [T, ...T[]][] = [];
  for (const r of rows) {
    const last = groups.at(-1);
    if (last && last[0].title === r.title) last.push(r);
    else groups.push([r]);
  }
  return groups;
}

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
  const noRules = myRules.length === 0;
  const audiences = [...new Set([...rules.values()].flatMap((r) => r.audience))].map((a) => `${a.replace('_', ' ')}s`).join(' and ');
  // The same snapshot the copilot answers from, written the same way ("Oct 8, 2026"). Before, this line showed the demo
  // run's clock, 15:00 UTC, beside the copilot's 6:00 AM load time for the same data (UX review Nov 2, BH r2 5).
  const [snapshot] = await database.db.select().from(dataSnapshots).orderBy(desc(dataSnapshots.loadedAt)).limit(1);
  const now = new Date();
  const has = destinationsFor(user);
  const etHours = Array.from({ length: 24 }, (_, h) => easternHour(h, now));
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
          <p><strong>Private to {me.displayName.split(' (')[0]}.</strong> Alerts only cover accounts on your account team, and access is checked again right before each one is sent. {snapshot ? <>Data as of {snapshotDay(snapshot.asOfDate)}, snapshot <code>{snapshot.id}</code>, the same as the copilot&apos;s. Times are UTC, with Eastern beside them. </> : null}{signedIn ? 'Your access comes from your account.' : 'Identity switch for local testing only.'}</p>
          {/* Nothing to show as numbers or graphs when no rule covers the role (UX sustained hour R1). */}
          {noRules ? null : <ViewSwitch view={view} />}
        </div>

        {noRules ? (
          // A role with no rules gets one honest line. Before, three tiles of 0 sat over an inbox that suggested
          // subscribing and a settings card that said you can't (UX review Nov 2, OPT 4).
          <section className="card" aria-labelledby="inbox-title">
            <h2 id="inbox-title">No alerts for your role yet</h2>
            <p className="empty">No alert rules cover your role yet, so there is nothing to subscribe to and no alerts to show. Today&apos;s rules are for {audiences}. The rule catalog below lists them.</p>
          </section>
        ) : (
        <>
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
              {groupByTitle(mine).map(([a, ...more]) => (
                <li key={a.id} className={`alert sev-${a.severity.toLowerCase()}`}>
                  <div className="alert-head">
                    <span className={`pill sev sev-${a.severity.toLowerCase()}`}>{a.severity === 'info' ? (TAG_BY_EVENT[rules.get(a.ruleId)?.event ?? ''] ?? 'Info') : a.severity}</span>
                    <b>{a.title}</b>
                    {more.length ? <span className="muted">{more.length + 1} alerts</span> : null}
                  </div>
                  {/* A new tab, so the inbox stays open behind the copilot (Nov 1 demo test). noopener: the copilot page gets no handle back to this one.
                      The link pre-fills a fixed question about this alert's account (src/server/prompts.ts), so the label can say "about this
                      account" again. It only pre-fills: the reader still presses Ask (UX review, Nov 2). */}
                  {more.length ? (
                    <ul className="alerts">
                      {[a, ...more].map((x) => <li key={x.id}><p>{x.explanation}</p></li>)}
                    </ul>
                  ) : (
                    <p>{a.explanation}</p>
                  )}
                  <a href={a.link} target="_blank" rel="noopener noreferrer">Ask the copilot about this account (opens in a new tab)</a>
                </li>
              ))}
            </ul>
          )}
        </section>
        </>
        )}

        <div className={noRules ? undefined : 'grid2'}>
          {noRules ? null : (
          <section className="card" aria-labelledby="subs-title">
            <h2 id="subs-title">Your subscriptions</h2>
            <p className="sub">Choose the alerts you want, how often, where, and your quiet hours. Only alerts meant for your role are listed. Changes apply to new alerts; ones already waiting keep their channel.</p>
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
                    etHours={etHours}
                    has={has}
                    sub={s ? { frequency: s.frequency, quietStartHour: s.quietStartHour, quietEndHour: s.quietEndHour, criticalBypass: s.criticalBypass, channel: s.channel } : null}
                  />
                );
              })}
            </div>
          </section>
          )}

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

