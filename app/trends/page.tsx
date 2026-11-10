// Question trends for the signed-in analyst (plan item 16). Counts from the question_trends view.
// The view has no question text. Anyone else gets a 404, so the page does not announce itself.
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { unansweredTrends, type TrendCount } from '@/audit/question-trends';
import { topicName } from '@/audit/topics';
import { trendFacts, type TopicCount } from '@/audit/trends-agent';
import { appUsers, questionTopicsView, questionTrendsView } from '@/db/schema';
import { activeDatasetLabel, AS_OF_DATE } from '@/db/seed';
import { loadRegistry } from '@/registry/load';
import { alertsLink } from '@/server/alerts-link';
import { requireUser } from '@/server/require-user';
import { getDatabase } from '@/server/runtime';
import { AppShell } from '../app-shell';
import { logOutAction } from '../auth-actions';
import { dateRange } from '../format';
import { readTheme } from '../theme';
import { metricWords, outcomeWords, readableFact, splitUnanswered, weekWords } from './words';

export const dynamic = 'force-dynamic';

const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// Metric ids to the registry's names, as the dashboard shows them.
const metricNames = () => new Map([...loadRegistry().metrics.values()].map((m) => [m.id, m.name]));

function Table({ rows, names }: { rows: TrendCount[]; names: ReadonlyMap<string, string> }) {
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
              <td>{weekWords(r.week)}</td>
              <td>{metricWords(r.metric, names)}</td>
              <td>{outcomeWords(r.outcome)}</td>
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
  const [person] = await database.db.select({ role: appUsers.role, name: appUsers.displayName }).from(appUsers).where(eq(appUsers.id, actor.userId));
  if (person?.role !== 'analyst') notFound();
  return (
    <AppShell
      current="trends"
      analyst
      alertsHref={alertsLink(process.env.ALERTS_URL)}
      theme={await readTheme()}
      dataset={activeDatasetLabel()}
      asOf={dateRange(AS_OF_DATE)}
      metricCount={loadRegistry().metrics.size}
      who={
        <form className="who" action={logOutAction}>
          <span>Signed in as {person.name}</span>
          <button type="submit">Log out</button>
        </form>
      }
    >
      <main>
        <div className="page-head">
          <h1>Question trends</h1>
          <p>Counts of questions by week, metric and outcome. Question text is not stored and is not shown.</p>
          <p><Link href="/">Back to the overview</Link></p>
        </div>
        <section className="card trends" aria-label="Question trends">
          <Trends database={database} />
        </section>
      </main>
    </AppShell>
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
              <td>{weekWords(r.week)}</td>
              <td>{sentenceCase(topicName(r.topic))}</td>
              <td>{outcomeWords(r.outcome)}</td>
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
  const names = metricNames();
  const { askedBack, notAnswered } = splitUnanswered(unansweredTrends(counts));
  // The same facts the weekly trends agent reads (scripts/trends-agent.ts), in the page's words.
  const facts = trendFacts(counts, topics);
  const askedBackThisWeek = askedBack.filter((c) => c.week === facts.week).reduce((n, c) => n + c.count, 0);
  return (
    <>
      <h2>This week</h2>
      {facts.week === null ? (
        <p className="sub">No questions yet. Ask one, then come back.</p>
      ) : (
        <>
          <ul className="trends-summary">
            {facts.facts.map((f) => <li key={f.id}>{readableFact(f.text, names)}</li>)}
            {askedBackThisWeek > 0 ? <li>Of this week's questions, {askedBackThisWeek} {askedBackThisWeek === 1 ? 'was' : 'were'} asked back for more detail. The copilot asks rather than guesses, so these are not failures.</li> : null}
          </ul>
        </>
      )}
      <h2>All questions</h2>
      {counts.length === 0 ? <p className="sub">No questions yet. Ask one, then come back.</p> : <Table rows={counts} names={names} />}
      <h2>Asked back</h2>
      <p className="sub">The copilot asked for a missing detail, such as the quarter, instead of guessing.</p>
      <Table rows={askedBack} names={names} />
      <h2>Not answered</h2>
      <p className="sub">These never became an answer: refused by a guardrail, or not a governed metric yet. A row with no metric is a question the copilot could not place on one.</p>
      <Table rows={notAnswered} names={names} />
      <h2>Asked back or not answered, by topic</h2>
      <p className="sub">A label from a fixed list (support cases, product usage, renewals and others), never the question's words.</p>
      <TopicTable rows={[...topics].sort((a, b) => b.week.localeCompare(a.week) || b.count - a.count)} />
    </>
  );
}
