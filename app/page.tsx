import { eq } from 'drizzle-orm';
import { demoUsers } from '@/db/seed';
import { alertDeliveries, alertSubscriptions } from '@/db/schema';
import { DEMO_NOW } from '@/alerts/demo';
import { getAlertsRuntime } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const USERS = demoUsers();

const STATUS_TEXT: Record<string, string> = {
  delivered: 'Delivered',
  queued_digest: 'Waiting for digest',
  suppressed_no_access: 'Not sent: no access',
  failed: 'Not sent: channel failed',
  pending: 'Pending',
};

function hours(s: number | null, e: number | null): string {
  if (s === null || e === null) return 'None';
  return `${String(s).padStart(2, '0')}:00 to ${String(e).padStart(2, '0')}:00 UTC`;
}

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ user?: string }> }) {
  const params = await searchParams;
  const user = USERS.some((u) => u.id === params.user) ? params.user! : 'u_ts_east';
  const me = USERS.find((u) => u.id === user)!;
  const { database, rules } = await getAlertsRuntime();
  const rank: Record<string, number> = { P1: 0, P2: 1, info: 2 };
  const mine = (await database.db.select().from(alertDeliveries).where(eq(alertDeliveries.userId, user))).sort(
    (a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || a.title.localeCompare(b.title),
  );
  const subs = await database.db.select().from(alertSubscriptions).where(eq(alertSubscriptions.userId, user));
  const count = (s: string) => mine.filter((m) => m.status === s).length;

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
          <span className="badge">Public sample data</span>
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
          <h1>Your alerts</h1>
          <p>Private to {me.displayName.split(' (')[0]}: alerts only cover accounts on your account team, and access is checked again right before each one is sent. Demo time {DEMO_NOW.toISOString().slice(0, 16).replace('T', ' ')} UTC. Demo identity switch, not a login.</p>
        </div>

        <section className="kpis" aria-label="Alert summary">
          <div className="kpi"><span className="label">Delivered</span><span className="value">{count('delivered')}</span><span className="note">sent to your inbox</span></div>
          <div className="kpi"><span className="label">Waiting for digest</span><span className="value">{count('queued_digest')}</span><span className="note">held by your digest or quiet-hours setting</span></div>
          <div className="kpi"><span className="label">Not sent</span><span className="value">{count('suppressed_no_access') + count('failed')}</span><span className="note">access removed or channel unavailable</span></div>
        </section>

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
                    <span className="status">{STATUS_TEXT[a.status] ?? a.status}</span>
                  </div>
                  <p>{a.explanation}</p>
                  <a href={a.link}>Ask the copilot about this</a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid2">
          <section className="card" aria-labelledby="subs-title">
            <h2 id="subs-title">Your subscriptions</h2>
            <p className="sub">You choose the rules, how often, quiet hours and channel.</p>
            {subs.length === 0 ? (
              <p className="empty">Not subscribed to any rule.</p>
            ) : (
              <div className="tablewrap">
                <table>
                  <thead><tr><th>Rule</th><th>Frequency</th><th>Quiet hours</th><th>P1 bypass</th><th>Channel</th></tr></thead>
                  <tbody>
                    {subs.map((s) => (
                      <tr key={s.ruleId}>
                        <td>{rules.get(s.ruleId)?.name ?? s.ruleId}{rules.get(s.ruleId) && !(rules.get(s.ruleId)!.audience as string[]).includes(me.role) && <span className="muted"> (not for your role, so it never fires)</span>}</td>
                        <td>{s.frequency === 'realtime' ? 'Right away' : 'Daily digest'}</td>
                        <td>{hours(s.quietStartHour, s.quietEndHour)}</td>
                        <td>{s.criticalBypass ? 'Yes' : 'No'}</td>
                        <td>{s.channel === 'inbox' ? 'In-app inbox' : 'Slack'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
