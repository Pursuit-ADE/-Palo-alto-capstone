// Question trends for the signed-in analyst (plan item 16). Counts from the question_trends view.
// The view has no question text. Anyone else gets a 404, so the page does not announce itself.
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { unansweredTrends, type TrendCount } from '@/audit/question-trends';
import { topicName } from '@/audit/topics';
import { plainSummary, trendFacts, type TopicCount } from '@/audit/trends-agent';
import { appUsers, questionTopicsView, questionTrendsView } from '@/db/schema';
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

function TopicTable({ rows }: { rows: TopicCount[] }) {
  if (rows.length === 0) return <p className="sub">None.</p>;
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr><th>Week of</th><th>Topic</th><th>Outcome</th><th>Count</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.week}|${r.topic}|${r.outcome}`}>
              <td>{r.week}</td>
              <td>{topicName(r.topic)}</td>
              <td>{r.outcome}</td>
              <td>{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Trends({ database }: { database: Awaited<ReturnType<typeof getDatabase>> }) {
  const [counts, topics] = await Promise.all([database.db.select().from(questionTrendsView), database.db.select().from(questionTopicsView)]);
  const missed = unansweredTrends(counts);
  // The same facts the weekly trends agent reads (scripts/trends-agent.ts), summarized by code on the page.
  const summary = plainSummary(trendFacts(counts, topics));
  return (
    <>
      <h2>This week</h2>
      <pre className="trends-summary">{summary}</pre>
      <h2>All questions</h2>
      {counts.length === 0 ? <p className="sub">No questions yet. Ask one, then come back.</p> : <Table rows={counts} />}
      <h2>Not answered</h2>
      <p className="sub">These never became an answer. A row with no metric is a question the copilot could not place on a governed metric.</p>
      <Table rows={missed} />
      <h2>Not answered, by topic</h2>
      <p className="sub">A label from a fixed list (support cases, product usage, renewals and others), never the question's words.</p>
      <TopicTable rows={[...topics].sort((a, b) => b.week.localeCompare(a.week) || b.count - a.count)} />
    </>
  );
}
