// Question trends for the signed-in analyst (plan item 16). Counts from the question_trends view.
// The view has no question text. Anyone else gets a 404, so the page does not announce itself.
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { unansweredTrends, type TrendCount } from '@/audit/question-trends';
import { appUsers, questionTrendsView } from '@/db/schema';
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
  if (person?.role !== 'analyst') notFound();
  return (
    <main>
      <div className="page-head">
        <h1>Question trends</h1>
        <p>Counts of questions by week, metric and outcome. Question text is not stored and is not shown.</p>
        <p><Link href="/">Back to the overview</Link></p>
      </div>
      <Trends database={database} />
    </main>
  );
}

async function Trends({ database }: { database: Awaited<ReturnType<typeof getDatabase>> }) {
  const counts = await database.db.select().from(questionTrendsView);
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
