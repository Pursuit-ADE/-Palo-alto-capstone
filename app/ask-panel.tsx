'use client';

import { useRef, useState, useTransition } from 'react';
import { askCopilot, type AskResult } from './actions';
import { FactChips, scopeText } from './fact-chips';
import { cell, dateRange } from './format';
import { ExplanationView } from './explanation-panel';
import { ProvenancePanel } from './provenance-panel';
import { Chart3D } from './chart3d';
import { answerCharts, breakdownQuestions } from './chart-data';
import type { View } from './view-mode';
import type { Answer } from '@/semantic/answer';

interface Turn {
  id: number;
  question: string;
  result: AskResult;
}

// The browser keeps only what it displays plus the last answer's structured intent. The server re-validates
// that intent and re-checks scope on every turn, so editing it can't widen access.
const MAX_TURNS_SHOWN = 20;

/** The conversation state the next question sends, after this reply. A refusal leaves it as it was. */
function nextPrevious(result: AskResult, current: unknown): unknown {
  if (result?.kind === 'answer') return result.intent;
  // A follow-up after an explanation continues from the asker's own figure.
  if (result?.kind === 'explanation') return result.answer.intent;
  // A clarification waits on a partial request (e.g. coverage with no quarter); the reply finishes it.
  // A clarification with nothing to resume clears the state, so a bare reply can't continue an older question.
  if (result?.kind === 'clarify') return result.resume ?? null;
  return current;
}

export function AskPanel({
  user,
  name,
  examples,
  initialQuestion = '',
  view = 'numbers',
  metricDims = {},
}: {
  user: string;
  name: string;
  examples: string[];
  initialQuestion?: string;
  view?: View;
  metricDims?: Record<string, string[]>;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [previous, setPrevious] = useState<unknown>(null);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function send(question: string, refocus = false) {
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
        setPrevious((current: unknown) => nextPrevious(result, current));
        if (inputRef.current) inputRef.current.value = '';
        // A break-down chip goes away with the answer it was under, so focus moves to the question box, not to <body>.
        if (refocus) inputRef.current?.focus();
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
          <p className="sub">Answers come only from the governed metrics below, scoped to {name}. Ask follow-ups like “and next quarter?”.</p>
        </div>
        {turns.length > 0 && (
          <button type="button" className="link-button" onClick={() => { setTurns([]); setPrevious(null); }} disabled={pending}>
            New conversation
          </button>
        )}
      </div>

      <ol className="turns" aria-live="polite">
        {turns.map((t, i) => (
          <li key={t.id} className="turn">
            <p className="you"><span>You</span>{t.question}</p>
            <TurnResult
              result={t.result}
              graphs={view === 'graphs' ? { id: `answer-${t.id}`, metricDims, ask: i === turns.length - 1 ? send : null, busy: pending } : null}
            />
          </li>
        ))}
        {pending && <li className="turn thinking" role="status">Working out the governed query…</li>}
      </ol>
      {failed && <div className="answer notice failed" role="alert"><span className="notice-tag">Error</span>The copilot could not be reached. Check your connection and try again.</div>}

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

/**
 * Graphs view: the chart's id, the breakdowns each metric allows, (on the latest answer only) a way to ask a
 * follow-up, and whether a question is in flight (the chips stay, disabled, so a focused chip keeps focus).
 */
interface GraphsView {
  id: string;
  metricDims: Record<string, string[]>;
  ask: ((q: string, refocus?: boolean) => void) | null;
  busy: boolean;
}

function TurnResult({ result, graphs }: { result: AskResult; graphs: GraphsView | null }) {
  if (!result) return null;
  if (result.kind === 'answer') return <AnswerView a={result} graphs={graphs} />;
  if (result.kind === 'explanation') return <ExplanationView e={result} />;
  // A clarifying question is the copilot asking back, not a refusal, so it gets its own look.
  if (result.kind === 'clarify') return <div className="answer notice clarify" role="status"><span className="notice-tag">Question</span>{result.question}</div>;
  return <div className="answer notice refused" role="status"><span className="notice-tag">Not answered</span>{result.message}</div>;
}

function AnswerView({ a, graphs }: { a: Answer; graphs: GraphsView | null }) {
  const cols = Object.keys(a.rows[0] ?? { value: '' });
  const charts = graphs ? answerCharts(a, graphs.id) : null;
  // Follow-up chips are follow-ups of this answer ("And open pipeline by stage"), so only the latest answer offers them:
  // send() continues the latest question.
  const breakdowns = graphs?.ask ? breakdownQuestions(a, graphs.metricDims) : [];
  // A single number is shown as large as the dashboard's, with its scope and data date right under it.
  const single = a.filters.groupBy.length === 0 && a.rows.length === 1 ? a.rows[0]! : null;
  const big = single && single.value !== null && single.value !== undefined ? cell('value', single.value, a.metric.unit) : null;
  return (
    <div className="answer">
      <h3>{a.metric.name}</h3>
      {big && <p className="answer-value">{big}</p>}
      <FactChips label="Scope and data date" items={[['Scope', scopeText(a.scope)], ['Data as of', dateRange(a.provenance.asOfDate)]]} />
      <p className="narrative">{a.narrative}</p>
      {charts && (
        // The answer list is a live region; the chart's controls change whenever any graph on the page turns, and
        // announcing that for every answer would bury the answers themselves.
        <div className="answer-graph" aria-live="off">
          <Chart3D charts={charts} />
          {breakdowns.length > 0 && (
            <fieldset className="chips" aria-label="Break this number down">
              {breakdowns.map((b) => (
                <button key={b.question} type="button" disabled={graphs?.busy} onClick={() => graphs?.ask?.(b.question, true)}>{b.label}</button>
              ))}
            </fieldset>
          )}
        </div>
      )}
      {!charts && a.chart && <BarChart values={a.chart.data.values as { [k: string]: string | number }[]} dim={a.chart.encoding.y.field} unit={a.metric.unit} />}
      {/* A one-cell table would only repeat the big number; coverage keeps its numerator and denominator columns.
          In the Graphs view the chart's own "Show numbers" table carries the values. */}
      {!charts && !(big && cols.length === 1) && (
        <div className="tablewrap">
          <table>
            <thead><tr>{cols.map((k) => (<th key={k}>{k}</th>))}</tr></thead>
            <tbody>
              {a.rows.map((r, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: result rows have no id and never reorder within an answer.
                <tr key={i}>{cols.map((k) => (<td key={k}>{cell(k, k === 'owner' ? (a.ownerNames?.[String(r[k])] ?? r[k]) : r[k], a.metric.unit)}</td>))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ProvenancePanel a={a} />
    </div>
  );
}

/** Deterministic horizontal bars drawn from the same rows as the table (the Vega-Lite spec travels with the answer). */
/** Longest label that fits the label column; longer names are shortened, with the full name on hover. */
const MAX_LABEL = 18;
const shortLabel = (s: string) => (s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1).trimEnd()}…` : s);

function BarChart({ values: rows, dim, unit }: { values: { [k: string]: string | number }[]; dim: string; unit: string }) {
  // Largest first, as the spec's sort '-x' says.
  const values = [...rows].sort((a, b) => Number(b.value) - Number(a.value));
  const max = Math.max(...values.map((v) => Number(v.value)), 0) || 1;
  const rowH = 28;
  const labelW = 150; // room for a rep's full name
  const width = 560;
  const barW = width - labelW - 90;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${width} ${values.length * rowH + 8}`} role="img" aria-label={`Bar chart by ${dim}`}>
        {values.map((v, i) => {
          const w = (Number(v.value) / max) * barW;
          const y = i * rowH + 4;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: chart bars follow the fixed row order of one answer.
            <g key={i}>
              {/* The spec already holds the display label (src/semantic/narrative.ts chartSpec). */}
              <text x={labelW - 8} y={y + 15} textAnchor="end" className="chart-label">
                <title>{String(v[dim])}</title>
                {shortLabel(String(v[dim]))}
              </text>
              <rect x={labelW} y={y} width={Math.max(w, 1)} height={rowH - 10} rx={3} className="chart-bar" />
              <text x={labelW + w + 6} y={y + 15} className="chart-value">{cell('value', Number(v.value), unit)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
