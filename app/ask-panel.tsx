'use client';

import { useRef, useState, useTransition } from 'react';
import { askCopilot, type AskResult } from './actions';
import { cell } from './format';
import type { Answer } from '@/semantic/answer';

interface Turn {
  id: number;
  question: string;
  result: AskResult;
}

// The browser keeps only what it displays plus the last answer's structured intent. The server re-validates
// that intent and re-checks scope on every turn, so editing it can't widen access.
const MAX_TURNS_SHOWN = 20;

export function AskPanel({ user, name, examples, initialQuestion = '' }: { user: string; name: string; examples: string[]; initialQuestion?: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [previous, setPrevious] = useState<unknown>(null);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function send(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    const fd = new FormData();
    fd.set('user', user);
    fd.set('q', q);
    fd.set('turn', String(turns.length + 1));
    if (previous) fd.set('previous', JSON.stringify(previous));
    setFailed(false);
    startTransition(async () => {
      try {
        const result = await askCopilot(null, fd);
        setTurns((t) => [...t, { id: Date.now(), question: q, result }].slice(-MAX_TURNS_SHOWN));
        if (result?.kind === 'answer') setPrevious(result.intent);
        if (inputRef.current) inputRef.current.value = '';
      } catch {
        setFailed(true);
      }
    });
  }

  return (
    <section className="card" aria-labelledby="ask-title">
      <div className="chat-head">
        <div>
          <h2 id="ask-title">Ask the copilot</h2>
          <p className="sub">Answers come only from the governed metrics below, scoped to {name}. Ask follow-ups like “what about by stage?”.</p>
        </div>
        {turns.length > 0 && (
          <button type="button" className="link-button" onClick={() => { setTurns([]); setPrevious(null); }} disabled={pending}>
            New conversation
          </button>
        )}
      </div>

      <ol className="turns" aria-live="polite">
        {turns.map((t) => (
          <li key={t.id} className="turn">
            <p className="you"><span>You</span>{t.question}</p>
            <TurnResult result={t.result} />
          </li>
        ))}
        {pending && <li className="turn thinking" role="status">Working out the governed query…</li>}
      </ol>
      {failed && <div className="answer refused" role="alert">The copilot could not be reached. Check your connection and try again.</div>}

      <form className="ask" onSubmit={(e) => { e.preventDefault(); send(inputRef.current?.value ?? ''); }}>
        <input ref={inputRef} id="q" name="q" defaultValue={initialQuestion} placeholder={turns.length ? 'Ask a follow-up' : 'Ask about open pipeline, pipeline coverage or open opportunities'} maxLength={300} aria-label="Question" autoComplete="off" />
        <button type="submit" disabled={pending}>{pending ? 'Asking…' : 'Ask'}</button>
      </form>
      <div className="chips">
        {examples.map((e) => (
          <button key={e} type="button" onClick={() => send(e)} disabled={pending}>{e}</button>
        ))}
      </div>
    </section>
  );
}

function TurnResult({ result }: { result: AskResult }) {
  if (!result) return null;
  if (result.kind === 'answer') return <AnswerView a={result} />;
  return <div className="answer refused" role="status">{result.kind === 'clarify' ? result.question : result.message}</div>;
}

function AnswerView({ a }: { a: Answer }) {
  const cols = Object.keys(a.rows[0] ?? { value: '' });
  return (
    <div className="answer">
      <h3>{a.metric.name}</h3>
      <p className="narrative">{a.narrative}</p>
      {a.chart && <BarChart values={a.chart.data.values as { [k: string]: string | number }[]} dim={a.chart.encoding.y.field} unit={a.metric.unit} />}
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

/** Deterministic horizontal bars drawn from the same rows as the table (the Vega-Lite spec travels with the answer). */
function BarChart({ values, dim, unit }: { values: { [k: string]: string | number }[]; dim: string; unit: string }) {
  const max = Math.max(...values.map((v) => Number(v.value)), 0) || 1;
  const rowH = 28;
  const labelW = 120;
  const width = 520;
  const barW = width - labelW - 90;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${width} ${values.length * rowH + 8}`} role="img" aria-label={`Bar chart by ${dim}`}>
        {values.map((v, i) => {
          const w = (Number(v.value) / max) * barW;
          const y = i * rowH + 4;
          return (
            <g key={String(v[dim])}>
              <text x={labelW - 8} y={y + 15} textAnchor="end" className="chart-label">{String(v[dim])}</text>
              <rect x={labelW} y={y} width={Math.max(w, 1)} height={rowH - 10} rx={3} className="chart-bar" />
              <text x={labelW + w + 6} y={y + 15} className="chart-value">{cell('value', Number(v.value), unit)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
