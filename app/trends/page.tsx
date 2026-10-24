// Question trends for the signed-in analyst (plan item 16). Counts from this server's audit log.
// The laptop demo's log is in memory, so this page is how that demo reads it. Postgres keeps the log
// where the app login cannot read it; the runbook's `npm run trends` uses the owner login there.
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { questionTrends, unansweredTrends, type TrendCount } from '@/audit/question-trends';
import { appUsers, queryAudit } from '@/db/schema';
import { requireUser } from '@/server/require-user';
import { getDatabase } from '@/server/runtime';

export const dynamic = 'force-dynamic';

function Table({ rows }: { rows: TrendCount[] }) {
  if (rows.length === 0) return <p className="sub">None.</p>;
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr><th>Week of</th><th>Metric</th><th>Outcome</th><th>Count</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.week}|${r.metric}|${r.outcome}`}>
              <td>{r.week}</td>
              <td>{r.metric}</td>
              <td>{r.outcome}</td>
              <td>{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function TrendsPage() {
  const actor = await requireUser();
  if (!actor) redirect('/login');
  const database = await getDatabase();
  const [person] = await database.db.select({ role: appUsers.role }).from(appUsers).where(eq(appUsers.id, actor.userId));
  return (
    <main>
      <div className="page-head">
        <h1>Question trends</h1>
        <p>Counts of questions by week, metric and outcome. Question text is not stored and is not shown.</p>
        <p><Link href="/">Back to the overview</Link></p>
      </div>
      {person?.role !== 'analyst' ? (
        <p className="sub">This report is for the analyst.</p>
      ) : database.mode === 'postgres' ? (
        <p className="sub">This server&apos;s login cannot read the audit log. Run <code>npm run trends</code> with <code>MIGRATION_DATABASE_URL</code> set, as the runbook says.</p>
      ) : (
        <Trends database={database} />
      )}
    </main>
  );
}

async function Trends({ database }: { database: Awaited<ReturnType<typeof getDatabase>> }) {
  const rows = await database.db.select({
    at: queryAudit.at,
    source: queryAudit.source,
    outcome: queryAudit.outcome,
    metricId: queryAudit.metricId,
  }).from(queryAudit);
  const counts = questionTrends(rows);
  const missed = unansweredTrends(counts);
  return (
    <>
      <h2>All questions</h2>
      {counts.length === 0 ? <p className="sub">No questions yet. Ask one, then come back.</p> : <Table rows={counts} />}
      <h2>Not answered</h2>
      <p className="sub">These never became an answer. A row with no metric is a question the copilot could not place on a governed metric.</p>
      <Table rows={missed} />
    </>
  );
}
