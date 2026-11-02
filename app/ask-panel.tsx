'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { askCopilot, type AskResult } from './actions';
import { addTurn, AskTimeout, conversationOwner, GIVE_UP_MS, keepQuestion, loadConversation, MAX_TURNS_SHOWN, offScreen, saveConversation, SLOW_MS, spokenReply, tabStore, takeKeptQuestion, withTimeout } from './ask-flow';
import { FactChips, scopeText } from './fact-chips';
import { cell, dateRange } from './format';
import { coverageSpec, coverageStanding } from '@/semantic/coverage-target';
import { ExplanationView } from './explanation-panel';
import { ProvenancePanel } from './provenance-panel';
import { readAs } from './reading';
import { Chart3D } from './chart3d';
import { answerCharts, breakdownQuestions } from './chart-data';
import type { View } from './view-mode';
import type { Answer } from '@/semantic/answer';

interface Turn {
  id: number;
  question: string;
  result: AskResult;
}

// The browser keeps only what it displays (the last MAX_TURNS_SHOWN turns) plus the last answer's structured intent.
// The server re-validates that intent and re-checks scope on every turn, so editing it can't widen access.

const WORKING = 'Working out the governed query…';
const SLOW = 'Still working: this is taking longer than usual…';

const FAILED = {
  unreachable: 'The copilot could not be reached. Check your connection and try again.',
  timeout: `No answer after ${GIVE_UP_MS / 1000} seconds, so the copilot stopped waiting. Your question is still in the box: ask again, and if it's still stuck, reload the page.`,
};

/** Smooth scrolling, unless the person asked for less motion. */
const scrollBehavior = (): ScrollBehavior => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

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

type Shown = { turns: Turn[]; dropped: number };

/**
 * A reload, or /trends and back, used to lose the whole conversation (BH 7, REC). This puts back what the tab kept for
 * this owner (the user and the scope the server applied on this load), then keeps each change; the server still checks
 * every follow-up's intent and scope. With no owner (the page passed no scope), nothing is kept. It returns the last turn
 * put back (not scrolled to), or null until the tab has been read, so the first, empty render can't overwrite it.
 */
function useKeptConversation(owner: string | null, shown: Shown, setShown: (s: Shown) => void, previous: unknown, setPrevious: (p: unknown) => void) {
  const restored = useRef<{ lastId: number | undefined } | null>(null);
  useEffect(() => {
    const kept = owner ? loadConversation<Turn>(tabStore(), owner) : null;
    if (kept) {
      setShown({ turns: kept.turns, dropped: kept.dropped });
      setPrevious(kept.previous);
    }
    restored.current = { lastId: kept?.turns.at(-1)?.id };
  }, [owner, setShown, setPrevious]);
  useEffect(() => {
    if (owner && restored.current) saveConversation(tabStore(), owner, { turns: shown.turns, dropped: shown.dropped, previous });
  }, [shown, previous, owner]);
  return restored;
}

export function AskPanel({
  user,
  name,
  examples,
  initialQuestion = '',
  view = 'numbers',
  metricDims = {},
  scope,
}: {
  user: string;
  name: string;
  examples: string[];
  initialQuestion?: string;
  view?: View;
  metricDims?: Record<string, string[]>;
  /** The scope the server applied on this page load (e.g. the dashboard answer's `scope`). Without it nothing is kept. */
  scope?: string;
}) {
  const [shown, setShown] = useState<Shown>({ turns: [], dropped: 0 });
  const turns = shown.turns;
  const [previous, setPrevious] = useState<unknown>(null);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<'unreachable' | 'timeout' | null>(null);
  const [slow, setSlow] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const lastId = turns.at(-1)?.id;
  const restored = useKeptConversation(scope === undefined ? null : conversationOwner(user, scope), shown, setShown, previous, setPrevious);

  // A new turn lands above the question box, and the browser keeps the box where it was, so a long answer started off
  // screen: by turn 5 at 1024 × 768 the reader had to scroll back 3,700 px to find it (UX review, Nov 2, row 6). Bring its
  // start to the top when it starts above the window, or runs past the bottom from lower than the top quarter (an answer
  // starting at 542 px ran to 1,543). One that fits where it is stays put. Focus stays in the box.
  // biome-ignore lint/correctness/useExhaustiveDependencies: restored is a ref read when the last turn changes; only a new turn scrolls.
  useEffect(() => {
    if (lastId === undefined || lastId === restored.current?.lastId) return;
    const turn = listRef.current?.querySelector<HTMLElement>(`[data-turn="${lastId}"]`);
    if (turn && offScreen(turn.getBoundingClientRect(), window.innerHeight)) turn.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
  }, [lastId]);

  // Arriving from an alert, the question is filled in but the box sat at the bottom edge of the window, so the link
  // looked dead (row 6). Show the box and put the cursor in it, so Enter asks. The same after signing in again from an
  // ended session, with the question that wasn't asked put back (row 7).
  useEffect(() => {
    const input = inputRef.current;
    const kept = takeKeptQuestion(tabStore(), user);
    if (input && kept) input.value = kept;
    if (!input || !(kept || initialQuestion)) return;
    input.focus({ preventScroll: true });
    input.scrollIntoView({ block: 'center', behavior: 'auto' });
  }, [initialQuestion, user]);

  /** What a reply changes on the page. */
  function showReply(q: string, result: AskResult, refocus: boolean) {
    setShown((s) => addTurn(s, { id: Date.now(), question: q, result }));
    setPrevious((current: unknown) => nextPrevious(result, current));
    // A question the server didn't take because the session ended stays in the box, and in this tab for after sign-in.
    if (signedOut(result)) keepQuestion(tabStore(), user, q);
    else if (inputRef.current) inputRef.current.value = '';
    // A break-down chip goes away with the answer it was under, so focus moves to the question box, not to <body>.
    if (refocus) inputRef.current?.focus();
  }

  function send(question: string, refocus = false) {
    const q = question.trim();
    if (!q || pending) return;
    const fd = new FormData();
    fd.set('user', user);
    fd.set('q', q);
    fd.set('turn', String(turns.length + 1));
    if (previous) fd.set('previous', JSON.stringify(previous));
    setFailed(null);
    // A request that never comes back used to leave "Working out the governed query…" up for good (REC, Nov 2). Say when
    // it's slow, and stop waiting after GIVE_UP_MS with the question still in the box.
    const slowTimer = setTimeout(() => setSlow(true), SLOW_MS);
    startTransition(async () => {
      try {
        showReply(q, await withTimeout(askCopilot(null, fd), GIVE_UP_MS), refocus);
      } catch (e) {
        setFailed(e instanceof AskTimeout ? 'timeout' : 'unreachable');
      } finally {
        clearTimeout(slowTimer);
        setSlow(false);
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
          <button type="button" className="link-button" onClick={() => { setShown({ turns: [], dropped: 0 }); setPrevious(null); }} disabled={pending}>
            New conversation
          </button>
        )}
      </div>

      {/* Older turns drop off silently otherwise (REC, Nov 2). */}
      {shown.dropped > 0 && <p className="sub">Only your last {MAX_TURNS_SHOWN} questions are shown. Earlier ones were cleared from this page.</p>}
      {/* The one live region: the latest reply's sentence, or that it's working. Turns put back from the tab aren't announced.
          The text sits in a node keyed by the turn, so a reply that repeats the one before (an ask-back asked again) is
          still a change, and is still read out. */}
      <p className="visually-hidden" role="status">
        <span key={pending ? 'pending' : lastId}>{pending ? (slow ? SLOW : WORKING) : lastId === restored.current?.lastId ? '' : spokenReply(turns.at(-1)?.result)}</span>
      </p>
      <ol ref={listRef} className="turns">
        {turns.map((t, i) => (
          <li key={t.id} className="turn" data-turn={t.id}>
            <p className="you"><span>You</span>{t.question}</p>
            <TurnResult
              result={t.result}
              graphs={view === 'graphs' ? { id: `answer-${t.id}`, metricDims, ask: i === turns.length - 1 ? send : null, busy: pending } : null}
            />
          </li>
        ))}
        {pending && <li className="turn thinking">{slow ? SLOW : WORKING}</li>}
      </ol>
      {failed && <div className="answer notice failed" role="alert"><span className="notice-tag">Error</span>{FAILED[failed]}</div>}

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

const signedOut = (result: AskResult) => result?.kind === 'refused' && result.signedOut === true;

function TurnResult({ result, graphs }: { result: AskResult; graphs: GraphsView | null }) {
  if (!result) return null;
  // The session ended mid-conversation (row 7): say how to get back, and that the question is kept.
  if (result.kind === 'refused' && result.signedOut) {
    return (
      <div className="answer notice refused">
        <span className="notice-tag">Not answered</span>
        {result.message} <a href="/login">Log in again</a>, and it will be back in the box.
      </div>
    );
  }
  if (result.kind === 'answer') return <AnswerView a={result} graphs={graphs} />;
  if (result.kind === 'explanation') return <ExplanationView e={result} />;
  // A clarifying question is the copilot asking back, not a refusal, so it gets its own look.
  if (result.kind === 'clarify') return <div className="answer notice clarify"><span className="notice-tag">Question</span>{result.question}</div>;
  return <div className="answer notice refused"><span className="notice-tag">Not answered</span>{result.message}</div>;
}

export function AnswerView({ a, graphs }: { a: Answer; graphs: GraphsView | null }) {
  const cols = Object.keys(a.rows[0] ?? { value: '' });
  const charts = graphs ? answerCharts(a, graphs.id) : null;
  // Follow-up chips are follow-ups of this answer ("And open pipeline by stage"), so only the latest answer offers them:
  // send() continues the latest question.
  const breakdowns = graphs?.ask ? breakdownQuestions(a, graphs.metricDims) : [];
  // A single number is shown as large as the dashboard's, with its scope and data date right under it.
  const single = a.filters.groupBy.length === 0 && a.rows.length === 1 ? a.rows[0]! : null;
  const big = single && single.value !== null && single.value !== undefined ? cell('value', single.value, a.metric.unit) : null;
  const goal = coverageSpec(a.metric);
  const tone = goal && single && typeof single.value === 'number' ? coverageStanding(single.value, goal).tone : null;
  return (
    <div className="answer">
      <h3>{a.metric.name}</h3>
      {/* The answer in one sentence comes first (client feedback, Oct 24): a leader reads it and can stop there. */}
      <p className="narrative narrative-lead">{a.narrative}</p>
      {/* How the question was read, before the number, so it can be checked where people look first: a reading, not a
          confidence score, which this copilot doesn't have (receipts design, Nov 1). The panel below keeps the full rows. */}
      <p className="read-as"><span>Read as:</span> {readAs(a)}</p>
      {big && <p className={tone ? `answer-value tone-${tone}` : 'answer-value'}>{big}</p>}
      <FactChips label="Scope and data date" items={[['Scope', scopeText(a.scope)], ['Data as of', dateRange(a.provenance.asOfDate)]]} />
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
