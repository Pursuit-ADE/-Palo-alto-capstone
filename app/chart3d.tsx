'use client';

// A governed number as a graph. It rests as an ordinary flat chart (server-rendered SVG, from the same rows as the
// Numbers view). 3D is opt-in (client feedback, Oct 24): only after "3D view" or the 3 key does dragging the graph, or
// the page around it, turn every graph on the page together. In 3D the
// backdrop goes to the dark PANW stage and the bars become glass. The values stay in a table for screen readers,
// and "Show numbers" puts that table on screen. Shared byte-for-byte by both apps.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  buildScene,
  camera,
  clampPose,
  coastStep,
  defaultKind,
  hasNarrow,
  hitTest,
  KINDS,
  KINDS_COOKIE,
  kindsFor,
  layout2D,
  LIMITS,
  morph,
  NARROW_PX,
  poseToT,
  PRESET,
  releaseVelocity,
  rememberKind,
  rubberBand,
  smooth,
  springStep,
  unRubberBand,
  wedgeOutline,
  type Anchor,
  type Bar,
  type Camera,
  type ChartData,
  type ChartKind,
  type Layout,
  type Mark,
  type Pose,
} from './chart3d-math';
import { drawFrame, makeScratch, releaseScratch, type Scratch } from './chart3d-draw';
import './chart3d.css';

// ---------------------------------------------------------------- the shared turn

type Mode = 'rest' | 'drag' | 'coast' | 'spring';
interface Orbit {
  pose: Pose;
  vel: Pose;
  mode: Mode;
  target: Pose;
  omega: number;
  raw: Pose; // the hand's pose while dragging, before the rubber band
  samples: { at: number; yaw: number; tilt: number }[];
  moved: boolean;
  flat: boolean; // exactly at rest at (0, 0): the flat SVG shows
  listeners: Set<() => void>;
}
interface Live {
  orbitKey: () => string;
  draw: () => void;
  dirty: boolean;
}

const PAGE = 'page';
const orbits = new Map<string, Orbit>();
const lives = new Set<Live>();
let raf = 0;
let lastFrame = 0;

function orbitFor(key: string): Orbit {
  let o = orbits.get(key);
  if (!o) {
    o = { pose: { yaw: 0, tilt: 0 }, vel: { yaw: 0, tilt: 0 }, mode: 'rest', target: { yaw: 0, tilt: 0 }, omega: 12, raw: { yaw: 0, tilt: 0 }, samples: [], moved: false, flat: true, listeners: new Set() };
    orbits.set(key, o);
  }
  return o;
}

const reducedQuery = () => (typeof window === 'undefined' ? null : window.matchMedia('(prefers-reduced-motion: reduce)'));
const reduced = () => !!reducedQuery()?.matches;
// High-contrast (forced colours) mode shows only the flat chart and its table, so nothing turns.
const forced = () => typeof window !== 'undefined' && window.matchMedia('(forced-colors: active)').matches;

function setFlat(o: Orbit) {
  const flat = o.mode === 'rest' && o.pose.yaw === 0 && o.pose.tilt === 0;
  if (flat !== o.flat) {
    o.flat = flat;
    o.listeners.forEach((l) => {
      l();
    });
  }
}

function kick() {
  if (!raf && typeof window !== 'undefined') raf = requestAnimationFrame(tick);
}

function step(o: Orbit, dt: number) {
  if (o.mode === 'coast') {
    const [yaw, vy] = coastStep(o.pose.yaw, o.vel.yaw, dt);
    const [tilt, vt] = coastStep(o.pose.tilt, o.vel.tilt, dt);
    o.pose = { yaw, tilt };
    o.vel = { yaw: vy, tilt: vt };
    const c = clampPose(o.pose);
    const out = c.yaw !== yaw || c.tilt !== tilt;
    if (out || Math.hypot(vy, vt) < 3) {
      if (out) {
        // Past a limit: keep a fifth of the outward speed, for a small bounce, never a flight past the limit.
        const back = (p: number, v: number, lo: number, hi: number): [number, number] =>
          p > hi ? [Math.min(p, hi + LIMITS.over), v > 0 ? v * 0.2 : v] : p < lo ? [Math.max(p, lo - LIMITS.over), v < 0 ? v * 0.2 : v] : [p, v];
        const [y2, vy2] = back(yaw, vy, -LIMITS.yaw, LIMITS.yaw);
        const [t2, vt2] = back(tilt, vt, LIMITS.tiltMin, LIMITS.tiltMax);
        o.pose = { yaw: y2, tilt: t2 };
        o.vel = { yaw: vy2, tilt: vt2 };
        springTo(o, c, 18, false);
      } else o.mode = 'rest';
    }
    o.moved = true;
  } else if (o.mode === 'spring') {
    const [yaw, vy] = springStep(o.pose.yaw, o.vel.yaw, o.target.yaw, o.omega, dt);
    const [tilt, vt] = springStep(o.pose.tilt, o.vel.tilt, o.target.tilt, o.omega, dt);
    o.pose = { yaw, tilt };
    o.vel = { yaw: vy, tilt: vt };
    if (Math.abs(yaw - o.target.yaw) < 0.02 && Math.abs(tilt - o.target.tilt) < 0.02 && Math.hypot(vy, vt) < 0.5) {
      o.pose = { ...o.target };
      o.vel = { yaw: 0, tilt: 0 };
      o.mode = 'rest';
    }
    o.moved = true;
  }
  if (o.mode === 'rest' && Math.abs(o.pose.yaw) < 0.05 && Math.abs(o.pose.tilt) < 0.05 && (o.pose.yaw !== 0 || o.pose.tilt !== 0)) {
    o.pose = { yaw: 0, tilt: 0 };
    o.moved = true;
  }
  setFlat(o);
}

function tick(now: number) {
  raf = 0;
  const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 1 / 60;
  lastFrame = now;
  let busy = false;
  for (const o of orbits.values()) {
    step(o, dt);
    if (o.mode !== 'rest') busy = true;
  }
  for (const l of lives) {
    const o = orbitFor(l.orbitKey());
    if (o.moved || l.dirty) {
      l.dirty = false;
      l.draw();
    }
  }
  for (const o of orbits.values()) o.moved = false;
  if (busy || [...lives].some((l) => l.dirty)) kick();
  else lastFrame = 0;
}

function springTo(o: Orbit, target: Pose, omega: number, jump = reduced()) {
  if (jump) {
    o.pose = { ...target };
    o.vel = { yaw: 0, tilt: 0 };
    o.mode = 'rest';
  } else {
    o.target = { ...target };
    o.omega = omega;
    o.mode = 'spring';
  }
  o.moved = true;
  setFlat(o);
  kick();
}

const flatten = (o: Orbit) => springTo(o, { yaw: 0, tilt: 0 }, 12);

function dragStart(o: Orbit) {
  o.mode = 'drag';
  // Grabbed while past a limit: start the hand where the rubber band puts this pose, so nothing jumps.
  o.raw = { yaw: unRubberBand(o.pose.yaw, -LIMITS.yaw, LIMITS.yaw), tilt: unRubberBand(o.pose.tilt, LIMITS.tiltMin, LIMITS.tiltMax) };
  o.vel = { yaw: 0, tilt: 0 };
  o.samples = [{ at: performance.now(), ...o.pose }];
  setFlat(o);
}

function dragBy(o: Orbit, dx: number, dy: number) {
  o.raw = { yaw: o.raw.yaw + dx * 0.45, tilt: o.raw.tilt + dy * 0.35 };
  o.pose = { yaw: rubberBand(o.raw.yaw, -LIMITS.yaw, LIMITS.yaw), tilt: rubberBand(o.raw.tilt, LIMITS.tiltMin, LIMITS.tiltMax) };
  const at = performance.now();
  o.samples.push({ at, ...o.pose });
  while (o.samples.length > 2 && at - o.samples[0]!.at > 100) o.samples.shift();
  o.moved = true;
  kick();
}

function dragEnd(o: Orbit) {
  const s = o.samples;
  const first = s[0];
  const last = s[s.length - 1];
  const vel = first && last && !reduced() && performance.now() - last.at <= 80 ? releaseVelocity(first, last) : null;
  if (!vel) {
    // No coasting (a hold, a click with a wobble, reduced motion): settle where the hand let go, inside the limits.
    springTo(o, clampPose(o.pose), 18);
    return;
  }
  o.vel = vel;
  o.mode = 'coast';
  o.moved = true;
  kick();
}

/** Controls and readable content keep their own mouse behaviour; a drag that starts on one never turns the page. */
const OWN_POINTER = 'a, button, input, select, textarea, label, summary, option, table, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="tab"], [role="link"], [tabindex]:not([tabindex="-1"])';

/** True when the point is over a run of text (where a press should start a text selection, not a turn). */
function overText(x: number, y: number): boolean {
  const d = document as unknown as {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const node = d.caretPositionFromPoint ? d.caretPositionFromPoint(x, y)?.offsetNode : d.caretRangeFromPoint?.(x, y)?.startContainer;
  if (!node || node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) return false;
  // The caret snaps to the nearest text, so check that the point is really on it.
  const r = document.createRange();
  r.selectNodeContents(node);
  for (const b of r.getClientRects()) if (x >= b.left - 2 && x <= b.right + 2 && y >= b.top - 2 && y <= b.bottom + 2) return true;
  return false;
}

/**
 * Drags that start on the page around the graphs (mouse only) turn the page's graphs too: on the page's own
 * background, or on an empty part of anything inside a [data-c3d-surface] (a card's padding, the gap between
 * tiles). Text, controls and tables keep their usual behaviour. Escape flattens the page from anywhere.
 */
let surfaceInstalled = false;
function installSurfaceDrag() {
  if (surfaceInstalled || typeof document === 'undefined') return;
  surfaceInstalled = true;
  const startsTurn = (e: MouseEvent) => {
    const t = e.target;
    if (!(t instanceof Element) || !document.querySelector('[data-c3d-surface]')) return false;
    if (t === document.documentElement || t === document.body) return true;
    return !!t.closest('[data-c3d-surface]') && !t.closest(OWN_POINTER) && !overText(e.clientX, e.clientY);
  };
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0 || reduced() || forced() || lives.size === 0 || orbitFor(PAGE).flat || !startsTurn(e)) return;
    e.preventDefault(); // no text selection while turning
    // That also stops the press from doing what a press on the page normally does: blur a focused field and clear a
    // selection. Do both here.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) active.blur();
    document.getSelection()?.removeAllRanges();
    const o = orbitFor(PAGE);
    let x = e.clientX;
    let y = e.clientY;
    let started = false;
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
        started = true;
        dragStart(o);
        document.documentElement.dataset.c3dDragging = '';
      }
      dragBy(o, ev.clientX - x, ev.clientY - y);
      x = ev.clientX;
      y = ev.clientY;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      delete document.documentElement.dataset.c3dDragging;
      if (started) dragEnd(o);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
  document.addEventListener('dblclick', (e) => {
    if (lives.size > 0 && startsTurn(e)) flatten(orbitFor(PAGE));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || lives.size === 0) return;
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    for (const o of orbits.values()) if (!o.flat) flatten(o);
  });
}

// ---------------------------------------------------------------- the flat chart

const r2 = (n: number) => Math.round(n * 100) / 100; // sin and cos may differ in the last bit between engines
/** A column with its two top corners rounded. */
const roundTop = (x: number, y: number, w: number, h: number, r: number) => `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
/** A bar with its two outer (right) corners rounded. */
const roundEnd = (x: number, y: number, w: number, h: number, r: number) => `M${x} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x}Z`;

function FlatChart({ chart, L, variant, enter }: { chart: ChartData; L: Layout; variant?: 'wide' | 'narrow'; enter: boolean }) {
  const cols = L.form === 'columns';
  const S = chart.series.length;
  const name = (k: number) => {
    const d = chart.data[k]!;
    const cat = chart.categories.find((c) => c.key === d.category)?.label ?? d.category;
    return `${cat}${S > 1 ? ` · ${chart.series[d.series]}` : ''}: ${d.display}`;
  };
  const cls = ['c3d-svg', variant && `c3d-${variant}`, `c3d-k-${L.kind}`, cols ? 'c3d-cols' : 'c3d-rows', enter && 'c3d-enter'].filter(Boolean).join(' ');
  const valueText = (b: { text: string; tx: number; ty: number; anchor: Anchor; ink?: 'dark' | 'light' }) =>
    b.text ? <text x={b.tx} y={b.ty} textAnchor={b.anchor} className={b.ink ? `c3d-ink-${b.ink}` : 'c3d-value'}>{b.text}</text> : null;

  const bar = (b: Bar) => {
    const r = Math.min(3, b.w / 2, b.h / 2);
    if (b.role === 'case') {
      // The target as a glass case, open at the baseline: the bar it holds stands inside it.
      const d = cols ? `M${b.x} ${b.y + b.h}V${b.y}H${b.x + b.w}V${b.y + b.h}` : `M${b.x} ${b.y}H${b.x + b.w}V${b.y + b.h}H${b.x}`;
      return <path className={`c3d-case s${b.series}`} d={d} />;
    }
    if (b.dot) {
      return (
        <>
          <rect className={`c3d-bar c3d-stem s${b.series}`} x={b.x} y={b.y} width={Math.max(b.w, cols ? 2 : 0)} height={Math.max(b.h, cols ? 0 : 2)} />
          <circle className={`c3d-dot s${b.series}`} cx={b.dot.x} cy={b.dot.y} r={b.dot.r} />
        </>
      );
    }
    // A real zero, or a part too thin to see: a line where it sits (the baseline, or on top of the parts below it).
    if (cols && b.h < 0.5) return <line x1={b.x} x2={b.x + b.w} y1={b.y + b.h} y2={b.y + b.h} className={`c3d-bar s${b.series} c3d-zerobar`} />;
    if (b.round === 'none') return <rect className={`c3d-bar s${b.series}`} x={b.x} y={b.y} width={Math.max(b.w, 1)} height={b.h} />;
    if (cols) return <path className={`c3d-bar s${b.series}`} d={roundTop(b.x, b.y, b.w, b.h, r)} />;
    if (b.round === 'end') return <path className={`c3d-bar s${b.series}`} d={roundEnd(b.x, b.y, Math.max(b.w, 1), b.h, Math.min(3, b.h / 2, Math.max(b.w, 1) / 2))} />;
    return <rect className={`c3d-bar s${b.series}`} x={b.x} y={b.y} width={Math.max(b.w, 1)} height={b.h} rx={Math.min(3, b.h / 2)} />;
  };

  const D = L.donut;
  const H = L.heat;
  return (
    <svg className={cls} viewBox={`0 0 ${L.vw} ${L.vh}`} aria-hidden="true" focusable="false">
      {cols &&
        L.ticks.map((t, i) => (
          <g key={t.value}>
            <line x1={L.plot.x0} x2={L.plot.x1} y1={t.pos} y2={t.pos} className={i === 0 ? 'c3d-zero' : 'c3d-grid'} />
            <text x={L.plot.x0 - 8} y={t.pos + 4} textAnchor="end" className="c3d-tick">{t.text}</text>
          </g>
        ))}
      <g className="c3d-marks">
        {L.bars.map((b) => (
          <g key={b.datum} className={b.role === 'case' ? 'c3d-hold' : undefined}>
            <title>{name(b.datum)}</title>
            {bar(b)}
            {valueText(b)}
          </g>
        ))}
        {L.runs.map((r, i) => {
          const pts = r.points.map((j) => L.points[j]!);
          if (pts.length < 2) return null;
          const d = pts.map((p, k) => `${k ? 'L' : 'M'}${p.x} ${p.y}`).join('');
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: one answer's series runs stay in order and have no id.
            <g key={`r${i}`}>
              {L.kind === 'area' && <path className={`c3d-area s${r.series}`} d={`${d}L${pts[pts.length - 1]!.x} ${L.base}L${pts[0]!.x} ${L.base}Z`} />}
              <path className={`c3d-line s${r.series}`} d={d} pathLength={1} />
            </g>
          );
        })}
        {L.points.map((p) => (
          <g key={`p${p.datum}`} className="c3d-pt">
            <title>{name(p.datum)}</title>
            <circle className="c3d-hit" cx={p.x} cy={p.y} r={12} />
            <circle className={`c3d-dot s${p.series}`} cx={p.x} cy={p.y} r={4} />
            {valueText(p)}
          </g>
        ))}
        {D &&
          D.wedges.filter((w) => w.a1 > w.a0).map((w) => (
            <g key={`w${w.datum}`}>
              <title>{name(w.datum)}</title>
              <path className={`c3d-wedge t${w.tone}`} d={`M${wedgeOutline(D, w.a0, w.a1).map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L')}Z`} />
            </g>
          ))}
        {H &&
          H.cells.map((c) => (
            <g key={`c${c.cat}-${c.series}`}>
              <title>{c.datum >= 0 ? name(c.datum) : `${chart.categories[c.cat]?.label ?? ''} · ${chart.series[c.series] ?? ''}: no data`}</title>
              <rect className={c.value === null ? 'c3d-cell c3d-cell-empty' : 'c3d-cell'} x={c.x} y={c.y} width={c.w} height={c.h} rx={3} fill={c.fill} />
              {c.text && <text x={c.tx} y={c.ty} textAnchor="middle" className={`c3d-ink-${c.ink}`}>{c.text}</text>}
            </g>
          ))}
      </g>
      {D && (
        <>
          {D.legend.map((l) => (
            <g key={`l${l.datum}`}>
              <title>{name(l.datum)}</title>
              <rect className={`c3d-sw t${l.tone}`} x={l.x} y={l.y - 9} width={10} height={10} rx={2} />
              <text x={l.x + 16} y={l.y} className="c3d-cat">{l.label}</text>
              <text x={l.vx} y={l.y} textAnchor="end" className="c3d-value">{l.value}</text>
            </g>
          ))}
          {D.center && (
            <g>
              <text x={D.cx} y={D.center.y} textAnchor="middle" className="c3d-total">{D.center.text}</text>
              <text x={D.cx} y={D.center.subY} textAnchor="middle" className="c3d-tick">{D.center.sub}</text>
            </g>
          )}
        </>
      )}
      {H &&
        H.rows.map((r, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: heatmap row labels follow this answer's category order.
          <text key={`h${i}`} x={r.x} y={r.y} textAnchor="end" className="c3d-cat">
            <title>{r.full}</title>
            {r.text}
          </text>
        ))}
      {L.ghosts.map((g) => (
        <g key={`g${g.datum}`}>
          <title>{name(g.datum)}</title>
          {cols ? <line x1={g.x} x2={g.x + g.w} y1={g.y} y2={g.y} className="c3d-ghost" /> : <line x1={g.x} x2={g.x} y1={g.y} y2={g.y + g.w} className="c3d-ghost" />}
          {g.text && <text x={g.tx} y={g.ty} textAnchor={g.anchor} className="c3d-tick">{g.text}</text>}
        </g>
      ))}
      {L.target && (
        <g>
          <line x1={L.plot.x0} x2={L.plot.x1} y1={L.target.pos} y2={L.target.pos} className="c3d-target" />
          <text x={L.target.x} y={L.target.ty} textAnchor={L.target.anchor} className="c3d-target-label">{L.target.text}</text>
        </g>
      )}
      {L.cats.map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: category labels follow this answer's category order.
        <text key={i} x={c.x} y={c.y} textAnchor={c.anchor} className="c3d-cat">
          <title>{c.full}</title>
          {c.text}
        </text>
      ))}
    </svg>
  );
}

/** A small drawing of each chart type, for the picker. */
function KindIcon({ kind }: { kind: ChartKind }) {
  const shapes: Record<ChartKind, ReactNode> = {
    columns: <path d="M3 14V8h2.5v6zM6.75 14V3h2.5v11zM10.5 14V6H13v8z" />,
    bars: <path d="M2 3h8v2.5H2zM2 6.75h12v2.5H2zM2 10.5h6V13H2z" />,
    stacked: (
      <>
        <path d="M3 14V9h4v5zM9 14V7h4v7z" />
        <path d="M3 8V4.5h4V8zM9 6V2.5h4V6z" opacity=".45" />
      </>
    ),
    bullet: (
      <>
        <path d="M2.75 14.5V4.25h4.5V14.5M8.75 14.5V2.75h4.5V14.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4.25 14V7h1.5v7zM10.25 14V5.5h1.5V14z" />
      </>
    ),
    lollipop: (
      <>
        <path d="M3.5 14V8M8 14V4.5M12.5 14V7" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="3.5" cy="7" r="1.9" />
        <circle cx="8" cy="3.5" r="1.9" />
        <circle cx="12.5" cy="6" r="1.9" />
      </>
    ),
    line: (
      <>
        <path d="M2 12 6 6.5l4 2.5 4-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx="6" cy="6.5" r="1.5" />
        <circle cx="10" cy="9" r="1.5" />
      </>
    ),
    area: (
      <>
        <path d="M2 12 6 6.5l4 2.5 4-6V14H2z" opacity=".45" />
        <path d="M2 12 6 6.5l4 2.5 4-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      </>
    ),
    donut: (
      <>
        <path d="M8.6 2.03A6 6 0 0 1 13.97 8.6L11 8.3A3 3 0 0 0 8.3 5.03z" />
        <path d="M13.8 9.8A6 6 0 1 1 7.4 2.03l.3 3A3 3 0 1 0 10.9 9.2z" opacity=".45" />
      </>
    ),
    heatmap: (
      <>
        <rect x="2" y="2" width="5.5" height="5.5" rx="1" />
        <rect x="8.5" y="2" width="5.5" height="5.5" rx="1" opacity=".45" />
        <rect x="2" y="8.5" width="5.5" height="5.5" rx="1" opacity=".3" />
        <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" opacity=".7" />
      </>
    ),
  };
  return (
    <svg className="c3d-kind-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" fill="currentColor">
      {shapes[kind]}
    </svg>
  );
}

function NumbersTable({ chart, id, shown }: { chart: ChartData; id: string; shown: boolean }) {
  const grouped = chart.series.length > 1;
  const details = chart.data.some((d) => d.detail);
  const at = (cat: string, s: number) => chart.data.find((d) => d.category === cat && d.series === s);
  return (
    <div className={shown ? 'c3d-table' : 'c3d-table visually-hidden'} id={id}>
      <table>
        <caption>{chart.target ? `${chart.title} (line: ${chart.target.label})` : chart.title}</caption>
        <thead>
          <tr>
            <th scope="col">{chart.categoryName}</th>
            {chart.series.map((s) => <th key={s} scope="col">{s}</th>)}
            {details && <th scope="col">Detail</th>}
          </tr>
        </thead>
        <tbody>
          {chart.categories.map((c) => (
            <tr key={c.key}>
              <th scope="row">{c.label}</th>
              {chart.series.map((s, i) => <td key={s}>{at(c.key, i)?.display ?? '—'}</td>)}
              {details && <td>{chart.series.map((_, i) => at(c.key, i)?.detail).filter(Boolean).join(' · ') || (grouped ? '' : '—')}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- the component

/** Remember a graph's chart type in this browser (a display preference, read back on the server for the first paint). */
function saveKind(id: string, kind: ChartKind) {
  const prefix = `${KINDS_COOKIE}=`;
  const raw = document.cookie.split('; ').find((c) => c.startsWith(prefix))?.slice(prefix.length);
  let old = raw;
  try {
    old = raw && decodeURIComponent(raw);
  } catch {
    old = '';
  }
  const value = rememberKind(old, id, kind);
  document.cookie = `${prefix}${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax${location.protocol === 'https:' ? '; secure' : ''}`;
}

/**
 * charts: one or more charts of the same rows (tabs). kinds: the chart types this browser picked before, by chart id;
 * when given, a new pick is remembered too (dashboard graphs). Without it a pick lasts while the page is open.
 */
export function Chart3D({ charts, kinds }: { charts: ChartData[]; kinds?: Record<string, ChartKind> }) {
  const uid = useId();
  const [which, setWhich] = useState(0);
  const [tableShown, setTableShown] = useState(false);
  const [solo, setSolo] = useState(false); // reduced motion: each graph turns on its own
  const [picked, setPicked] = useState<Record<string, ChartKind>>(() => ({ ...kinds }));
  const [entered, setEntered] = useState<string | null>(null); // the chart and type just picked: its marks animate in
  const chart = charts[Math.min(which, charts.length - 1)]!;
  const offered = useMemo(() => kindsFor(chart), [chart]);
  const want = picked[chart.id];
  const kind: ChartKind = want && offered.includes(want) ? want : defaultKind(chart);
  const L = useMemo(() => layout2D(chart, kind), [chart, kind]);
  // Phones: a narrower layout, so the text is not shrunk to half size. Both are rendered; CSS shows the one that fits.
  const N = useMemo(() => (hasNarrow(chart, kind) ? layout2D(chart, kind, true) : null), [chart, kind]);
  const growRef = useRef(0); // when the type changed while turned: the new marks rise into place
  const enterTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(enterTimer.current), []);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const key = solo ? uid : PAGE;
  const keyRef = useRef(key);
  keyRef.current = key;
  const layoutsRef = useRef({ L, N });
  layoutsRef.current = { L, N };
  /** The layout drawn at a stage width (CSS px): the same choice the stylesheet makes for the flat chart. */
  const layoutAt = (w: number) => (w < NARROW_PX && layoutsRef.current.N) || layoutsRef.current.L;
  const chartRef = useRef(chart);
  chartRef.current = chart;
  // What the last frame drew, for hit testing.
  const drawnRef = useRef<{ order: Mark[]; cam: Camera } | null>(null);
  const hoverRef = useRef(-1);
  const tipPose = useRef<Pose | null>(null); // the pose the tooltip was placed for
  const liveRef = useRef<Live | null>(null);

  const subscribe = useCallback(
    (cb: () => void) => {
      const o = orbitFor(key);
      o.listeners.add(cb);
      return () => {
        o.listeners.delete(cb);
      };
    },
    [key],
  );
  const is3d = useSyncExternalStore(subscribe, () => !orbitFor(key).flat, () => false);

  useEffect(() => {
    const q = reducedQuery();
    if (!q) return;
    const on = () => setSolo(q.matches);
    on();
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: installs the canvas once; hideTip and layoutAt read refs.
  useLayoutEffect(() => {
    const el = stage.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    installSurfaceDrag();
    const scratch: Scratch = makeScratch();
    let ctx: CanvasRenderingContext2D | null = null;
    let size = { w: 0, h: 0 };
    let visible = true;
    let font = 'sans-serif';
    let release = 0;
    let quality: 0 | 1 | 2 = 0;
    let slowSince = 0;
    let costEma = 0;
    let fastSince = 0;

    const measure = () => {
      const r = el.getBoundingClientRect();
      size = { w: r.width, h: r.height };
      font = getComputedStyle(el).fontFamily || 'sans-serif';
    };
    const draw = () => {
      const o = orbitFor(keyRef.current);
      const t = poseToT(o.pose);
      if (o.flat || (t === 0 && o.mode === 'rest')) {
        // Flat again: the SVG takes over, and the canvas memory goes after a moment.
        if ('c3d' in el.dataset) {
          delete el.dataset.c3d;
          delete el.dataset.dark;
          hideTip();
          window.clearTimeout(release);
          release = window.setTimeout(() => {
            cv.width = 0;
            cv.height = 0;
            releaseScratch(scratch);
            ctx = null;
          }, 1500);
        }
        return;
      }
      window.clearTimeout(release);
      if (!visible) {
        live.dirty = false;
        pending = true;
        return;
      }
      if (!size.w) measure();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(size.w * dpr));
      const h = Math.max(1, Math.round(size.h * dpr));
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
      ctx ??= cv.getContext('2d');
      if (!ctx) return;
      // The graph turned from somewhere else (another graph, the keyboard): a tooltip placed for the old pose is wrong.
      const tp = tipPose.current;
      if (tp && Math.hypot(o.pose.yaw - tp.yaw, o.pose.tilt - tp.tilt) > 0.5) {
        hideTip();
        hoverRef.current = -1;
      }
      const layout = layoutAt(size.w);
      const m = morph(t);
      if (growRef.current) {
        const p = Math.min(1, (performance.now() - growRef.current) / 650);
        m.grow = smooth(p);
        if (p < 1) live.dirty = true;
        else growRef.current = 0;
      }
      const scene = buildScene(layout, m);
      const cam = camera(scene, o.pose, m);
      const t0 = performance.now();
      const drawn = drawFrame(ctx, scene, layout, cam, m, { unit: size.w / layout.vw, dpr, hover: o.mode === 'drag' ? -1 : hoverRef.current, font, quality }, scratch);
      const cost = performance.now() - t0;
      costEma = costEma ? costEma * 0.8 + cost * 0.2 : cost;
      // Slow machine: drop the light pools, then the bloom; come back after two calm seconds.
      if (costEma > 14 && quality < 2) {
        slowSince ||= t0;
        if (t0 - slowSince > 150) {
          quality = (quality + 1) as 1 | 2;
          slowSince = 0;
        }
      } else slowSince = 0;
      if (costEma < 6 && quality > 0) {
        fastSince ||= t0;
        if (t0 - fastSince > 2000) {
          quality = (quality - 1) as 0 | 1;
          fastSince = 0;
        }
      } else fastSince = 0;
      drawnRef.current = drawn;
      el.dataset.c3d = '';
      if (m.dark) el.dataset.dark = '';
      else delete el.dataset.dark;
    };
    let pending = false;
    const live: Live = { orbitKey: () => keyRef.current, draw, dirty: false };
    liveRef.current = live;
    lives.add(live);
    measure();
    if (!orbitFor(keyRef.current).flat) {
      live.dirty = true;
      kick();
    }
    const ro = new ResizeObserver(() => {
      measure();
      live.dirty = true;
      kick();
    });
    ro.observe(el);
    const io = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible && pending) {
          pending = false;
          live.dirty = true;
          kick();
        }
      },
      { rootMargin: '120px' },
    );
    io.observe(el);
    const fonts = document.fonts;
    const refont = () => {
      measure();
      live.dirty = true;
      kick();
    };
    fonts?.addEventListener?.('loadingdone', refont);
    // A press anywhere else on the page puts away a tooltip pinned by a tap.
    const away = (e: PointerEvent) => {
      if (tipPose.current && !el.contains(e.target as Node)) {
        hideTip();
        if (hoverRef.current >= 0) {
          hoverRef.current = -1;
          live.dirty = true;
          kick();
        }
      }
    };
    document.addEventListener('pointerdown', away);
    return () => {
      document.removeEventListener('pointerdown', away);
      lives.delete(live);
      liveRef.current = null;
      ro.disconnect();
      io.disconnect();
      fonts?.removeEventListener?.('loadingdone', refont);
      window.clearTimeout(release);
      releaseScratch(scratch);
      // The last graph gone (client navigation): the page starts flat next time.
      if (lives.size === 0) for (const o of orbits.values()) {
        o.pose = { yaw: 0, tilt: 0 };
        o.vel = { yaw: 0, tilt: 0 };
        o.mode = 'rest';
        setFlat(o);
      }
    };
  }, []);

  // A different chart in the same card (tabs) or a new key: draw again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: L, N and key are why the canvas redraws; the body only marks it dirty.
  useEffect(() => {
    if (liveRef.current) {
      liveRef.current.dirty = true;
      kick();
    }
  }, [L, N, key]);

  const hideTip = () => {
    tipPose.current = null;
    if (tip.current) tip.current.hidden = true;
  };
  const showTip = (datum: number, x: number, y: number) => {
    const t = tip.current;
    const el = stage.current;
    const c = chartRef.current;
    const d = c.data[datum];
    if (!t || !el || !d) return hideTip();
    const cat = c.categories.find((k) => k.key === d.category)?.label ?? d.category;
    t.replaceChildren();
    const head = document.createElement('b');
    head.textContent = cat;
    t.append(head);
    const val = document.createElement('span');
    val.textContent = `${c.series.length > 1 ? `${c.series[d.series]}: ` : ''}${d.display}`;
    t.append(val);
    if (d.detail) {
      const det = document.createElement('span');
      det.textContent = d.detail;
      t.append(det);
    }
    t.hidden = false;
    tipPose.current = { ...orbitFor(keyRef.current).pose };
    const r = el.getBoundingClientRect();
    const tw = t.offsetWidth;
    const th = t.offsetHeight;
    t.style.transform = `translate(${Math.round(Math.min(Math.max(4, x + 12), r.width - tw - 4))}px, ${Math.round(Math.min(Math.max(4, y - th - 12), r.height - th - 4))}px)`;
  };

  const orbit = () => orbitFor(keyRef.current);
  const gesture = useRef<{ id: number; x: number; y: number; sx: number; sy: number; touch: boolean; dragging: boolean } | null>(null);

  const hoverAt = (clientX: number, clientY: number) => {
    const el = stage.current;
    const drawn = drawnRef.current;
    if (!el || !drawn || !('c3d' in el.dataset) || forced()) return;
    // While the page is being dragged the bars move under the pointer: no tooltip until it lets go.
    if ('c3dDragging' in document.documentElement.dataset || orbit().mode === 'drag') return hideTip();
    const r = el.getBoundingClientRect();
    const u = r.width / layoutAt(r.width).vw;
    const datum = hitTest(drawn.order, drawn.cam, [(clientX - r.left) / u, (clientY - r.top) / u]);
    if (datum !== hoverRef.current) {
      hoverRef.current = datum;
      if (liveRef.current) liveRef.current.dirty = true;
      kick();
    }
    if (datum >= 0) showTip(datum, clientX - r.left, clientY - r.top);
    else hideTip();
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || forced()) return;
    const touch = e.pointerType === 'touch';
    gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, touch, dragging: false };
    // A mouse or pen keeps reporting to the stage until it lets go, even if it leaves the stage first. (Touch is
    // captured only once it moves sideways, so a vertical swipe still scrolls the page.)
    if (!touch) e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    let g = gesture.current;
    if (g && !g.touch && e.buttons === 0) {
      // The button came up somewhere this stage never heard about: that press is over.
      gesture.current = null;
      if (g.dragging) dragEnd(orbit());
      g = null;
    }
    if (!g || g.id !== e.pointerId) {
      if (e.pointerType !== 'touch') hoverAt(e.clientX, e.clientY);
      return;
    }
    if (!g.dragging) {
      // Flat graphs stay flat: a drag only turns a graph someone already put in 3D. A tap still shows its tooltip.
      if (orbit().flat) {
        if (!g.touch) hoverAt(e.clientX, e.clientY);
        return;
      }
      const dx = e.clientX - g.sx;
      const dy = e.clientY - g.sy;
      if (g.touch) {
        // A sideways start turns the graphs; a vertical one is left to the page scroll.
        if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) {
          gesture.current = null;
          return;
        }
        if (Math.abs(dx) < 8 || Math.abs(dx) < 1.2 * Math.abs(dy)) return;
      } else if (Math.hypot(dx, dy) < 4) return;
      g.dragging = true;
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.setPointerCapture(e.pointerId);
      hideTip();
      hoverRef.current = -1;
      dragStart(orbit());
    }
    dragBy(orbit(), e.clientX - g.x, e.clientY - g.y);
    g.x = e.clientX;
    g.y = e.clientY;
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.id !== e.pointerId) return;
    if (g.dragging) dragEnd(orbit());
    else if (g.touch) hoverAt(e.clientX, e.clientY);
  };
  // Cancelled, or capture lost without a pointerup (the element moved, the window lost focus): end the drag.
  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    if (g.dragging) dragEnd(orbit());
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Browser shortcuts (Alt+Left for Back, Ctrl+0 to reset zoom, Ctrl+3 for a tab) are left alone.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (forced() && e.key !== 'Escape' && e.key !== 'Home' && e.key !== '0') return;
    const o = orbit();
    // Arrow keys turn a graph only once it is in 3D; the 3 key is the keyboard's way in.
    if (o.flat && e.key.startsWith('Arrow')) return;
    const big = e.shiftKey ? 3 : 1;
    const by = (dy: number, dt: number) => springTo(o, clampPose({ yaw: (o.mode === 'spring' ? o.target : o.pose).yaw + dy * big, tilt: (o.mode === 'spring' ? o.target : o.pose).tilt + dt * big }), 18);
    if (e.key === 'ArrowLeft') by(-7, 0);
    else if (e.key === 'ArrowRight') by(7, 0);
    else if (e.key === 'ArrowUp') by(0, -6);
    else if (e.key === 'ArrowDown') by(0, 6);
    else if (e.key === '3') springTo(o, PRESET, 12);
    else if (e.key === 'Escape' || e.key === 'Home' || e.key === '0') {
      if (o.flat) return;
      flatten(o);
    } else return;
    e.preventDefault();
  };

  const capId = `${uid}-cap`;
  const descId = `${uid}-desc`;
  const tableId = `${uid}-table`;
  const turn = (d: number) => {
    const o = orbit();
    springTo(o, clampPose({ yaw: (o.mode === 'spring' ? o.target : o.pose).yaw + d, tilt: Math.max(o.pose.tilt, 12) }), 12);
  };
  const pick = (k: ChartKind) => {
    if (k === kind) return;
    setPicked((p) => ({ ...p, [chart.id]: k }));
    setEntered(`${chart.id}.${k}`);
    // Done animating: drop the class, so a later re-show (a resize past the phone layout) doesn't replay it.
    window.clearTimeout(enterTimer.current);
    enterTimer.current = window.setTimeout(() => setEntered(null), 1200);
    if (kinds) saveKind(chart.id, k);
    // The old marks are gone: no tooltip for them, and a turned graph grows its new marks into place.
    hideTip();
    hoverRef.current = -1;
    if (!orbit().flat && !reduced()) growRef.current = performance.now();
  };
  const kindName = KINDS.find((k) => k.kind === kind)!.name;
  // The donut and the heatmap name their parts on the chart itself; the bullet's legend shows the case.
  const legend = chart.series.length > 1 && kind !== 'heatmap';
  const enter = entered === `${chart.id}.${kind}`;

  return (
    <figure className={`c3d c3d-${chart.size ?? 'answer'}`}>
      <figcaption id={capId} className="c3d-title">{chart.title}</figcaption>
      {(charts.length > 1 || legend || offered.length > 1) && (
        <div className="c3d-head">
          {charts.length > 1 && (
            <fieldset className="c3d-tabs" aria-label="Chart">
              {charts.map((c, i) => (
                <button key={c.id} type="button" aria-pressed={i === which} onClick={() => setWhich(i)}>{c.tab ?? c.title}</button>
              ))}
            </fieldset>
          )}
          {offered.length > 1 && (
            <fieldset className="c3d-kinds" aria-label="Chart type">
              {offered.map((k) => {
                const info = KINDS.find((x) => x.kind === k)!;
                return (
                  <button key={k} type="button" className="c3d-kind" aria-pressed={k === kind} aria-label={info.name} title={`${info.name}: ${info.hint}`} onClick={() => pick(k)}>
                    <KindIcon kind={k} />
                    <span>{info.name}</span>
                  </button>
                );
              })}
            </fieldset>
          )}
          {legend && (
            <ul className="c3d-legend" aria-hidden="true">
              {chart.series.map((s, i) => (
                <li key={s}><i className={kind === 'bullet' && i === 1 ? `s${i} case` : `s${i}`} />{s}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {/* biome-ignore lint/a11y/useSemanticElements: a rotatable drawing, not a set of form controls; group keeps the screen reader's reading mode. */}
      <div
        ref={stage}
        className="c3d-stage"
        style={{ '--c3d-ar': `${L.vw} / ${L.vh}`, '--c3d-ar-narrow': N ? `${N.vw} / ${N.vh}` : undefined, maxWidth: chart.size === 'answer' || !chart.size ? 760 : undefined } as CSSProperties}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: arrow keys turn this chart, so the drawing itself is in the tab order.
        tabIndex={0}
        role="group"
        aria-roledescription="rotatable chart"
        aria-labelledby={capId}
        aria-describedby={descId}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
        onPointerLeave={(e) => {
          if (e.pointerType !== 'touch' && !gesture.current?.dragging) {
            gesture.current = null;
            if (hoverRef.current >= 0 && liveRef.current) {
              hoverRef.current = -1;
              liveRef.current.dirty = true;
              kick();
            }
            hideTip();
          }
        }}
        onDoubleClick={() => flatten(orbit())}
        onKeyDown={onKeyDown}
      >
        <FlatChart key={`w-${kind}`} chart={chart} L={L} variant={N ? 'wide' : undefined} enter={enter} />
        {N && <FlatChart key={`n-${kind}`} chart={chart} L={N} variant="narrow" enter={enter} />}
        {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: the canvas only draws the chart; the stage and the numbers table carry the meaning. */}
        <canvas ref={canvas} className="c3d-canvas" aria-hidden="true" />
        <div ref={tip} className="c3d-tip" hidden aria-hidden="true" />
      </div>
      <div className="c3d-tools">
        {/* One fixed name, with the pressed state saying whether it is on (a changing name would read backwards). */}
        <button type="button" className="c3d-btn c3d-3d" aria-pressed={is3d} onClick={() => (is3d ? flatten(orbit()) : springTo(orbit(), PRESET, 12))}>
          3D view
        </button>
        {is3d && (
          <>
            <button type="button" className="c3d-btn c3d-3d" aria-label="Turn left" onClick={() => turn(-15)}>⟲</button>
            <button type="button" className="c3d-btn c3d-3d" aria-label="Turn right" onClick={() => turn(15)}>⟳</button>
          </>
        )}
        <button type="button" className="c3d-btn c3d-numbers" aria-expanded={tableShown} aria-controls={tableId} onClick={() => setTableShown((v) => !v)}>
          {tableShown ? 'Hide numbers' : 'Show numbers'}
        </button>
      </div>
      {chart.note && <p className="c3d-note">{chart.note}</p>}
      <p id={descId} className="visually-hidden">
        {chart.summary} Shown as {kindName.toLowerCase()}. Press 3D view, or the 3 key, to show it in 3D, then drag or use the arrow keys to turn it. Escape flattens it. The values are in the table that follows.
      </p>
      <NumbersTable chart={chart} id={tableId} shown={tableShown} />
    </figure>
  );
}
