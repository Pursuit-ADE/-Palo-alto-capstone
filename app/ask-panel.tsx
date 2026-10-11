'use client';

import { useActionState } from 'react';
import { askCopilot, type AskResult } from './actions';
import { cell } from './format';
import type { Answer } from '@/semantic/answer';

export function AskPanel({ user, name, examples, initialQuestion = '' }: { user: string; name: string; examples: string[]; initialQuestion?: string }) {
  const [result, action, pending] = useActionState<AskResult, FormData>(askCopilot, null);
  return (
    <section className="card" aria-labelledby="ask-title">
      <h2 id="ask-title">Ask the copilot</h2>
      <p className="sub">Answers come only from the governed metrics below, scoped to {name}.</p>
      <form className="ask" action={action}>
        <input type="hidden" name="user" value={user} />
        <input id="q" name="q" defaultValue={initialQuestion} placeholder="Ask about open pipeline, pipeline coverage or open opportunities" maxLength={300} aria-label="Question" />
        <button type="submit" disabled={pending}>{pending ? 'Asking…' : 'Ask'}</button>
      </form>
      <form className="chips" action={action}>
        <input type="hidden" name="user" value={user} />
        {examples.map((e) => (
          <button key={e} type="submit" name="example" value={e} disabled={pending}>{e}</button>
        ))}
      </form>
      {result?.kind === 'answer' && <AnswerView a={result} />}
      {result && result.kind !== 'answer' && (
        <div className="answer refused" role="status">
          {result.kind === 'clarify' ? result.question : result.message}
        </div>
      )}
    </section>
  );
}

function AnswerView({ a }: { a: Answer }) {
  const cols = Object.keys(a.rows[0] ?? { value: '' });
  return (
    <div className="answer">
      <h3>{a.metric.name}</h3>
      <div className="tablewrap">
        <table>
          <thead><tr>{cols.map((k) => (<th key={k}>{k}</th>))}</tr></thead>
          <tbody>
            {a.rows.map((r, i) => (
              <tr key={i}>{cols.map((k) => (<td key={k}>{cell(k, r[k], a.metric.unit)}</td>))}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="receipt">
        <span><b>Scope</b> · {a.scope.replace(/^Scope: /, '')}</span>
        <span><b>Source</b> · {a.metric.id} v{a.metric.version} · snapshot {a.provenance.snapshotId} (as of {a.provenance.asOfDate}) · result {a.provenance.resultHash}</span>
        <span><b>Intent</b> · <code>{JSON.stringify(a.intent)}</code></span>
      </div>
    </div>
  );
}
