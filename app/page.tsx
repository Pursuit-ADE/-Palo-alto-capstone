import { USERS } from '@/db/seed';
import { ask, type Reply } from '@/semantic/answer';
import { IntentError } from '@/semantic/compile';
import { ScopeViolation } from '@/semantic/scope';
import { getDatabase, getRegistry } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const EXAMPLES = ['What is our open pipeline?', 'coverage by region for this quarter', 'open opportunities by stage', 'pipeline coverage'];

function format(value: unknown, unit: string): string {
  if (typeof value !== 'number') return String(value ?? '');
  if (unit === 'currency') return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  if (unit === 'ratio') return `${value.toFixed(2)}x`;
  return value.toLocaleString('en-US');
}

export default async function Home({ searchParams }: { searchParams: Promise<{ user?: string; q?: string }> }) {
  const { user = 'u_ts_east', q = '' } = await searchParams;
  const registry = getRegistry();
  let reply: Reply | { kind: 'refused'; message: string } | null = null;
  if (q.trim()) {
    const database = await getDatabase();
    try {
      reply = await ask(database, registry, user, q.slice(0, 300));
    } catch (e) {
      if (e instanceof ScopeViolation || e instanceof IntentError) reply = { kind: 'refused', message: e.message };
      else throw e;
    }
  }

  return (
    <main>
      <h1>Governed Analytics Copilot</h1>
      <p className="sub">Week 1 preview · synthetic data only · answers come from the governed metric registry, scoped to the signed-in role.</p>

      <form method="get">
        <select name="user" defaultValue={user} aria-label="Mock identity">
          {USERS.map((u) => (
            <option key={u.id} value={u.id}>{u.displayName}</option>
          ))}
        </select>
        <input name="q" defaultValue={q} placeholder="Ask about open pipeline, pipeline coverage or open opportunities" maxLength={300} />
        <button type="submit">Ask</button>
      </form>
      <p className="meta">Try: {EXAMPLES.map((e, i) => (<span key={e}>{i > 0 && ' · '}<a href={`/?user=${user}&q=${encodeURIComponent(e)}`}>{e}</a></span>))}</p>

      {reply?.kind === 'answer' && (
        <div className="panel">
          <strong>{reply.metric.name}</strong>
          <table>
            <thead>
              <tr>
                {Object.keys(reply.rows[0] ?? { value: '' }).map((k) => (<th key={k}>{k}</th>))}
              </tr>
            </thead>
            <tbody>
              {reply.rows.map((r, i) => (
                <tr key={i}>
                  {Object.entries(r).map(([k, v]) => (
                    <td key={k}>{k === 'value' ? format(v, reply.metric.unit) : k === 'numerator' || k === 'denominator' ? format(v, 'currency') : String(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="meta">{reply.scope}</p>
          <p className="meta">
            Metric {reply.metric.id} v{reply.metric.version} · snapshot {reply.provenance.snapshotId} (as of {reply.provenance.asOfDate}) · result {reply.provenance.resultHash}
          </p>
          <p className="meta">Intent: <code>{JSON.stringify(reply.intent)}</code></p>
        </div>
      )}
      {reply && reply.kind !== 'answer' && (
        <div className="panel warn">
          {reply.kind === 'clarify' ? reply.question : reply.message}
        </div>
      )}

      <h2>Governed metrics</h2>
      <table>
        <thead><tr><th>Metric</th><th>Definition</th><th>Breakdowns</th></tr></thead>
        <tbody>
          {[...registry.metrics.values()].map((m) => (
            <tr key={m.id}><td>{m.name} <span className="meta">v{m.version}</span></td><td>{m.description}</td><td>{m.dimensions.join(', ')}</td></tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
