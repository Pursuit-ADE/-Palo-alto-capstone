// Graphs that rest as an ordinary flat chart and turn 3D as the page is rotated. This file is the pure part: the
// flat layout, the 3D scene built from the same numbers, the camera, paint order, hit testing and the drag physics.
// No DOM, no Intl, no Date or Math.random, so the server-rendered flat chart and the browser agree to the pixel.
// Shared byte-for-byte by both apps (app/ and alerts/app/).

export type Unit = 'currency' | 'count' | 'ratio';
export type Form = 'columns' | 'rows';
export type Anchor = 'start' | 'middle' | 'end';

/** One value. Charts only show what they are given: values come from governed rows, display strings from format(). */
export interface ChartDatum {
  category: string; // key into ChartData.categories
  series: number; // index into ChartData.series
  value: number | null; // null = not available (e.g. no quota): drawn as "n/a", never as 0
  display: string; // the exact text the Numbers view shows
  detail?: string; // extra line for the tooltip and table
}

export interface ChartData {
  id: string; // unique on the page
  title: string;
  summary: string; // one sentence for screen readers
  unit: Unit;
  categoryName: string; // table header for the categories
  categories: { key: string; label: string }[];
  series: string[]; // one name per series; more than one draws grouped bars
  data: ChartDatum[];
  target?: { value: number; label: string }; // a reference value (coverage 1.00x): a line flat, a glass plane in 3D
  axisFloor?: number; // the value axis reaches at least this
  form?: Form; // default: chosen from the data
  size?: 'tile' | 'card' | 'answer';
  note?: string;
  tab?: string; // label when a card offers more than one chart of the same rows
}

// PANW tokens (app/globals.css, and the sign-in stage's dark tones). Every chart colour is one of these or a mix of two.
export const TOKENS = {
  orange: '#fa582d',
  orangeDark: '#c23b16',
  orangeSoft: '#fff1ec',
  white: '#ffffff',
  black: '#000000',
  chrome: '#1b1d21',
  chrome2: '#26292f',
  stageTop: '#111215',
  stageBottom: '#15171a',
  chromeFg: '#f5f6f7',
  chromeMuted: '#9aa1ab',
  stageMuted: '#a9b0b9',
  muted: '#5d6470',
  field: '#868e99',
  line: '#e2e5ea',
} as const;

const hexRgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const hex2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');

/** a mixed toward b by p (0..1). */
export function mix(a: string, b: string, p: number): string {
  const x = hexRgb(a);
  const y = hexRgb(b);
  return `#${hex2(x[0] + (y[0] - x[0]) * p)}${hex2(x[1] + (y[1] - x[1]) * p)}${hex2(x[2] + (y[2] - x[2]) * p)}`;
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000})`;
}

/** WCAG contrast ratio of two opaque colours. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = hexRgb(hex).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** One series' colours: flat (2D, on white) and glass (3D, on the dark stage). */
export interface SeriesTone {
  flat: string;
  hover: string;
  core: string;
  rim: string;
  shade: string;
  cap: string;
  edge: string;
  glow: number; // bloom gain
}
const T = TOKENS;
export const SERIES_TONES: SeriesTone[] = [
  // Signature orange.
  { flat: T.orange, hover: T.orangeDark, core: T.orange, rim: mix(T.orange, T.white, 0.2), shade: T.orangeDark, cap: mix(T.orange, T.white, 0.55), edge: mix(T.orange, T.white, 0.45), glow: 1 },
  // Charcoal flat, silver glass in 3D.
  { flat: T.chrome2, hover: T.chrome, core: T.chromeMuted, rim: T.line, shade: T.muted, cap: T.chromeFg, edge: T.line, glow: 0.6 },
  // Cool grey flat, graphite glass in 3D.
  { flat: T.field, hover: T.muted, core: T.muted, rim: T.chromeMuted, shade: T.chrome2, cap: T.line, edge: mix(T.chromeMuted, T.line, 0.5), glow: 0.45 },
];
export const MAX_SERIES = SERIES_TONES.length;

// ---------------------------------------------------------------- numbers and labels

const trimZeros = (s: string) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);
const commas = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Short value text ("$1.96M", "763K", "2,089", "0.76x"). Hand-written so the server and every browser agree. */
export function compact(v: number, unit: Unit): string {
  if (unit === 'ratio') return `${v.toFixed(2)}x`;
  const sign = v < 0 ? '-' : '';
  const pre = unit === 'currency' ? '$' : '';
  let a = Math.abs(v);
  if (a < 1000) return `${sign}${pre}${commas(a)}`;
  if (unit === 'count' && a < 10000) return `${sign}${commas(a)}`;
  const suffixes = ['K', 'M', 'B', 'T'];
  for (let i = 0; i < suffixes.length; i++) {
    a /= 1000;
    const text = a >= 100 ? a.toFixed(0) : a >= 10 ? a.toFixed(1) : a.toFixed(2);
    if (Number(text) < 1000 || i === suffixes.length - 1) return `${sign}${pre}${trimZeros(text)}${suffixes[i]}`;
  }
  return `${sign}${pre}${commas(a)}`;
}

/**
 * Round axis ticks from 0 to at least max: steps of 1, 2, 2.5 or 5 times a power of ten. Counts, and dollar amounts
 * under $40, take whole steps, since their labels are whole numbers.
 */
export function niceTicks(max: number, unit: Unit, count = 4): number[] {
  const top = Number.isFinite(max) && max > 0 ? max : 1;
  const raw = top / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const whole = unit === 'count' || (unit === 'currency' && raw < 10);
  const steps = whole ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  let step = mag * (steps.find((s) => s * mag >= raw * (1 - 1e-9)) ?? 10);
  if (whole) step = Math.max(1, Math.round(step));
  const n = Math.max(1, Math.ceil(top / step - 1e-9));
  return Array.from({ length: n + 1 }, (_, i) => Number((i * step).toPrecision(12)));
}

/** Longest label that fits; longer names are shortened, with the full name on hover and in the table. */
export const shortLabel = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…` : s);

const CHAR_W = 6.7; // average width of a 12px Manrope character, in viewBox units

export function chooseForm(chart: ChartData): Form {
  if (chart.form) return chart.form;
  const longest = Math.max(0, ...chart.categories.map((c) => c.label.length));
  return chart.categories.length > 12 || longest > 14 ? 'rows' : 'columns';
}

// ---------------------------------------------------------------- flat layout

export interface Bar {
  datum: number;
  cat: number;
  series: number;
  x: number; // screen rect in viewBox units (y down)
  y: number;
  w: number;
  h: number;
  value: number;
  text: string; // value label
  tx: number;
  ty: number;
  anchor: Anchor;
}
export interface Ghost {
  datum: number;
  cat: number;
  series: number;
  x: number; // footprint on the baseline: columns x..x+w at y; rows x at y..y+w
  y: number;
  w: number;
  text: string;
  tx: number;
  ty: number;
  anchor: Anchor;
}
export interface Tick {
  value: number;
  text: string;
  pos: number; // screen y (columns) or x (rows)
}
export interface CatLabel {
  text: string;
  full: string;
  x: number;
  y: number;
  anchor: Anchor;
}
export interface Layout {
  form: Form;
  vw: number;
  vh: number;
  base: number; // the zero line: screen y (columns) or x (rows)
  plot: { x0: number; y0: number; x1: number; y1: number };
  axisMax: number;
  ticks: Tick[];
  bars: Bar[];
  ghosts: Ghost[];
  cats: CatLabel[];
  target: { pos: number; text: string; x: number; ty: number; anchor: Anchor } | null;
  seriesCount: number;
  band: number; // columns: group width per category; rows: band height per category
}

const SIZES = { tile: { vw: 400, vh: 180 }, card: { vw: 560, vh: 220 }, answer: { vw: 560, vh: 240 } } as const;
/** Below this stage width (CSS px) wide charts use a narrower viewBox, so their text stays readable on a phone. */
export const NARROW_PX = 480;
const NARROW_VW = { columns: 340, rows: 360 } as const;
export const ROW_H = 28;
export const ROW_LABEL_W = 150;

/** Whether a chart has a separate narrow layout (the dashboard tiles are small already). */
export const hasNarrow = (chart: ChartData) => chart.size !== 'tile' || chooseForm(chart) === 'rows';

type Rect = { x0: number; y0: number; x1: number; y1: number };
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
const textBox = (text: string, x: number, y: number, anchor: Anchor, size = 12): Rect => {
  const w = text.length * CHAR_W * (size / 12);
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return { x0, y0: y - size * 0.85, x1: x0 + w, y1: y + size * 0.3 };
};

/**
 * Where the target line's label goes: as far right as it can sit, just above or just below the line, without covering
 * a bar or a value label; when every spot covers something, the spot that covers least.
 */
function placeTarget(text: string, pos: number, plot: Rect, bars: Bar[]): { x: number; ty: number; anchor: Anchor } {
  const taken: Rect[] = bars.flatMap((b) => [{ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h }, textBox(b.text, b.tx, b.ty, b.anchor)]);
  const w = text.length * CHAR_W;
  const rows = [pos - 5, pos + 14].filter((ty) => ty + 4 <= plot.y1 && ty - 11 >= 0);
  let best = { x: plot.x1 - 2, ty: rows[0] ?? pos - 5, anchor: 'end' as Anchor };
  let least = Infinity;
  for (let x = plot.x1 - 2; x >= plot.x0 + 4 + w - 1e-9; x -= 2) {
    for (const ty of rows) {
      const box = textBox(text, x, ty, 'end');
      const cover = taken.reduce((sum, r) => sum + overlap(box, r), 0);
      if (cover < least - 1e-9) {
        least = cover;
        best = { x, ty, anchor: 'end' };
      }
      if (cover === 0) return best;
    }
  }
  return best;
}

export function layout2D(chart: ChartData, form = chooseForm(chart), narrow = false): Layout {
  const S = Math.max(1, Math.min(MAX_SERIES, chart.series.length));
  const values = chart.data.map((d) => (d.value !== null && Number.isFinite(d.value) ? Math.max(0, d.value) : null));
  const max = Math.max(0, chart.axisFloor ?? 0, chart.target?.value ?? 0, ...values.map((v) => v ?? 0));
  const catIndex = new Map(chart.categories.map((c, i) => [c.key, i]));
  const bars: Bar[] = [];
  const ghosts: Ghost[] = [];
  const cats: CatLabel[] = [];
  const n = Math.max(1, chart.categories.length);

  if (form === 'rows') {
    // Today's copilot bar chart: a 150-unit label column, 28-unit rows, 18-unit bars, values after the bar.
    const vw = narrow ? NARROW_VW.rows : 560;
    const bandH = 18 + 12 * (S - 1);
    const rowH = ROW_H + 12 * (S - 1);
    const vh = Math.max(64, n * rowH + 8);
    const barW = vw - ROW_LABEL_W - 90;
    const axisMax = max || 1;
    const ticks = niceTicks(axisMax, chart.unit)
      .filter((v) => v <= axisMax * (1 + 1e-9))
      .map((v) => ({ value: v, text: compact(v, chart.unit), pos: ROW_LABEL_W + (v / axisMax) * barW }));
    chart.categories.forEach((c, i) => {
      const y = i * rowH + 4;
      cats.push({ text: shortLabel(c.label, 18), full: c.label, x: ROW_LABEL_W - 8, y: y + bandH / 2 + 6, anchor: 'end' });
    });
    chart.data.forEach((d, k) => {
      const cat = catIndex.get(d.category);
      if (cat === undefined || d.series >= S) return;
      const sub = bandH / S;
      const y = cat * rowH + 4 + d.series * sub + (S > 1 ? 0.5 : 0);
      const h = S > 1 ? sub - 1 : 18;
      const v = values[k];
      if (v === null || v === undefined) {
        ghosts.push({ datum: k, cat, series: d.series, x: ROW_LABEL_W, y, w: h, text: 'n/a', tx: ROW_LABEL_W + 6, ty: y + h / 2 + 4, anchor: 'start' });
        return;
      }
      const w = (v / axisMax) * barW;
      bars.push({ datum: k, cat, series: d.series, x: ROW_LABEL_W, y, w, h, value: v, text: d.display, tx: ROW_LABEL_W + Math.max(w, 1) + 6, ty: y + h / 2 + 4, anchor: 'start' });
    });
    return { form, vw, vh, base: ROW_LABEL_W, plot: { x0: ROW_LABEL_W, y0: 4, x1: ROW_LABEL_W + barW, y1: n * rowH + 4 }, axisMax, ticks, bars, ghosts, cats, target: null, seriesCount: S, band: bandH };
  }

  const { vh } = SIZES[chart.size ?? 'answer'];
  const vw = narrow ? NARROW_VW.columns : SIZES[chart.size ?? 'answer'].vw;
  const plot = { x0: 50, y0: 24, x1: vw - 14, y1: vh - 30 };
  const plotH = plot.y1 - plot.y0;
  const ticksV = niceTicks(max, chart.unit);
  const axisMax = ticksV[ticksV.length - 1]!;
  const ticks = ticksV.map((v) => ({ value: v, text: compact(v, chart.unit), pos: plot.y1 - (v / axisMax) * plotH }));
  const slot = (plot.x1 - plot.x0) / n;
  const gw = Math.min(slot * 0.64, 56 + 26 * (S - 1));
  const maxChars = Math.max(4, Math.floor((slot - 6) / CHAR_W));
  chart.categories.forEach((c, i) => {
    cats.push({ text: shortLabel(c.label, maxChars), full: c.label, x: plot.x0 + slot * (i + 0.5), y: plot.y1 + 18, anchor: 'middle' });
  });
  chart.data.forEach((d, k) => {
    const cat = catIndex.get(d.category);
    if (cat === undefined || d.series >= S) return;
    const cx = plot.x0 + slot * (cat + 0.5);
    const sw = gw / S;
    const x = cx - gw / 2 + d.series * sw + (S > 1 ? 1 : 0);
    const w = S > 1 ? sw - 2 : gw;
    const v = values[k];
    if (v === null || v === undefined) {
      ghosts.push({ datum: k, cat, series: d.series, x, y: plot.y1, w, text: 'n/a', tx: x + w / 2, ty: plot.y1 - 6, anchor: 'middle' });
      return;
    }
    const h = (v / axisMax) * plotH;
    // Full value when it fits over its bar, else the short form; the tooltip and table keep the exact value.
    const room = (S > 1 ? sw : slot) - 4;
    const text = d.display.length * CHAR_W <= room ? d.display : compact(v, chart.unit);
    bars.push({ datum: k, cat, series: d.series, x, y: plot.y1 - h, w, h, value: v, text, tx: x + w / 2, ty: plot.y1 - h - 6, anchor: 'middle' });
  });
  let target: Layout['target'] = null;
  if (chart.target) {
    const pos = plot.y1 - (chart.target.value / axisMax) * plotH;
    target = { pos, text: chart.target.label, ...placeTarget(chart.target.label, pos, plot, bars) };
  }
  return { form, vw, vh, base: plot.y1, plot, axisMax, ticks, bars, ghosts, cats, target, seriesCount: S, band: gw };
}

// ---------------------------------------------------------------- 3D

export interface Pose {
  yaw: number; // degrees; + turns the chart's front to the right
  tilt: number; // degrees; + looks down onto the tops
}
export const LIMITS = { yaw: 50, tiltMin: 0, tiltMax: 62, over: 12 } as const;
/** The "View in 3D" pose: full 3D, tops and one side in view. */
export const PRESET: Pose = { yaw: -30, tilt: 24 };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const smooth = (x: number) => {
  const a = clamp01(x);
  return a * a * (3 - 2 * a);
};
export const smoothstep = (a: number, b: number, x: number) => smooth((x - a) / (b - a));
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/** How 3D the chart is, 0 (flat) to 1: full 3D at 35 degrees of turn or 30 of tilt. */
export function poseToT(p: Pose): number {
  return smooth(Math.hypot(p.yaw / 35, p.tilt / 30));
}

/** Everything that changes between flat and 3D, as 0..1 channels of one t. */
export interface Morph {
  t: number;
  e: number; // extrusion depth
  stage: number; // the chart's backdrop goes from the white card to the dark stage
  glass: number; // flat fill becomes glass
  floor: number; // grid floor, light pools
  glow: number; // bloom; never on a light backdrop
  group: number; // grouped bars slide from side by side into rows in depth
  fit: number; // shrink to keep the turned scene inside the box
  chips: number; // label backing chips
  dark: boolean; // labels switch to their dark-stage colours
}
export function morph(t: number): Morph {
  const stage = smoothstep(0.02, 0.25, t);
  return {
    t,
    e: t,
    stage,
    glass: smoothstep(0.05, 0.4, t),
    floor: smoothstep(0.1, 0.5, t),
    glow: smoothstep(0.2, 0.85, t),
    group: smoothstep(0.1, 0.8, t),
    fit: smoothstep(0, 0.3, t),
    chips: smoothstep(0, 0.2, stage),
    dark: stage >= 0.55,
  };
}

export type V3 = [number, number, number];
export interface Box {
  datum: number;
  series: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
  part: 'whole' | 'below' | 'above'; // split at the target plane
}
export interface Label3 {
  p: V3; // world anchor
  dx: number; // screen offset at the anchor, in viewBox units
  dy: number;
  text: string;
  anchor: Anchor;
  kind: 'value' | 'category' | 'tick' | 'target' | 'na';
  datum?: number;
}
export interface Scene {
  form: Form;
  vw: number;
  vh: number;
  boxes: Box[];
  ghosts: { datum: number; series: number; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }[];
  floor: { y: number; x0: number; x1: number; z0: number; z1: number };
  panel: { z: number; x0: number; x1: number; y0: number; y1: number };
  grid: { a: V3; b: V3 }[]; // value gridlines on the back panel
  target: { y: number; x0: number; x1: number; z0: number; z1: number } | null;
  labels: Label3[];
  pivot: V3;
  radius: number;
  bounds: { min: V3; max: V3 }; // boxes and panel
}

/** The 3D scene for a morph, built from the flat layout, so at t = 0 it projects exactly onto the flat chart. */
export function buildScene(L: Layout, m: Morph): Scene {
  const Y = (sy: number) => L.vh - sy; // world y is up; viewBox y is down
  const boxes: Box[] = [];
  const ghosts: Scene['ghosts'] = [];
  const labels: Label3[] = [];
  const S = L.seriesCount;
  let zMin = 0;
  let zMax = 0;

  if (L.form === 'columns') {
    const w3 = S > 1 ? L.band * 0.7 : L.band;
    const sep = 1.5 * w3 * m.e;
    const place = (x: number, w: number, series: number, cat: number) => {
      const slot = (L.plot.x1 - L.plot.x0) / Math.max(1, L.cats.length);
      const cx3 = L.plot.x0 + slot * (cat + 0.5);
      const width = lerp(w, w3, m.group);
      const cx = lerp(x + w / 2, cx3, m.group);
      const d = (S > 1 ? w3 : w) * m.e;
      const zc = -series * sep;
      return { x0: cx - width / 2, x1: cx + width / 2, z0: zc - d / 2, z1: zc + d / 2 };
    };
    for (const b of L.bars) {
      const f = place(b.x, b.w, b.series, b.cat);
      boxes.push({ datum: b.datum, series: b.series, ...f, y0: Y(L.base), y1: Y(L.base) + b.h, part: 'whole' });
      zMin = Math.min(zMin, f.z0);
      zMax = Math.max(zMax, f.z1);
      labels.push({ p: [(f.x0 + f.x1) / 2, Y(L.base) + b.h, f.z1], dx: 0, dy: b.ty - (L.base - b.h), text: b.text, anchor: 'middle', kind: 'value', datum: b.datum });
    }
    for (const g of L.ghosts) {
      const f = place(g.x, g.w, g.series, g.cat);
      ghosts.push({ datum: g.datum, series: g.series, ...f, y0: Y(L.base), y1: Y(L.base) });
      labels.push({ p: [(f.x0 + f.x1) / 2, Y(L.base), f.z1], dx: 0, dy: -6, text: g.text, anchor: 'middle', kind: 'na', datum: g.datum });
    }
    for (const c of L.cats) labels.push({ p: [c.x, Y(L.base), zMax], dx: 0, dy: c.y - L.base, text: c.text, anchor: 'middle', kind: 'category' });
  } else {
    const sub = L.band / S;
    const d3 = S > 1 ? L.band * 0.8 : 18;
    const sep = 1.5 * d3 * m.e;
    const place = (y: number, h: number, series: number, cat: number) => {
      const rowH = ROW_H + 12 * (S - 1);
      const top3 = cat * rowH + 4 + (L.band - d3) / 2;
      const top = lerp(y, top3, m.group);
      const height = lerp(h, d3, m.group);
      const d = (S > 1 ? d3 : h) * m.e;
      const zc = -series * sep;
      return { y0: Y(top + height), y1: Y(top), z0: zc - d / 2, z1: zc + d / 2 };
    };
    for (const b of L.bars) {
      const f = place(b.y, b.h, b.series, b.cat);
      boxes.push({ datum: b.datum, series: b.series, x0: L.base, x1: L.base + Math.max(b.w, 1), ...f, part: 'whole' });
      zMin = Math.min(zMin, f.z0);
      zMax = Math.max(zMax, f.z1);
      labels.push({ p: [L.base + Math.max(b.w, 1), (f.y0 + f.y1) / 2, f.z1], dx: b.tx - (L.base + Math.max(b.w, 1)), dy: b.ty - (b.y + b.h / 2), text: b.text, anchor: 'start', kind: 'value', datum: b.datum });
    }
    for (const g of L.ghosts) {
      const f = place(g.y, g.w, g.series, g.cat);
      ghosts.push({ datum: g.datum, series: g.series, x0: L.base, x1: L.base, ...f });
      labels.push({ p: [L.base, (f.y0 + f.y1) / 2, f.z1], dx: g.tx - L.base, dy: g.ty - (g.y + g.w / 2), text: g.text, anchor: 'start', kind: 'na', datum: g.datum });
    }
    L.cats.forEach((c, i) => {
      const rowH = ROW_H + 12 * (S - 1);
      const mid = i * rowH + 4 + L.band / 2;
      labels.push({ p: [L.base, Y(mid), zMax], dx: c.x - L.base, dy: c.y - mid, text: c.text, anchor: 'end', kind: 'category' });
    });
  }

  // The back panel carries the value gridlines. Flat, it lies in the bars' plane, so its gridlines are the 2D gridlines.
  const gap = (L.form === 'columns' ? L.band : 18) * 0.6 * m.e;
  const zPanel = zMin - gap;
  const grid: Scene['grid'] = [];
  let panel: Scene['panel'];
  let floor: Scene['floor'];
  if (L.form === 'columns') {
    panel = { z: zPanel, x0: L.plot.x0, x1: L.plot.x1, y0: Y(L.plot.y1), y1: Y(L.plot.y0) + 4 };
    for (const tk of L.ticks) {
      grid.push({ a: [L.plot.x0, Y(tk.pos), zPanel], b: [L.plot.x1, Y(tk.pos), zPanel] });
      labels.push({ p: [L.plot.x0, Y(tk.pos), zPanel], dx: -8, dy: 4, text: tk.text, anchor: 'end', kind: 'tick' });
    }
    floor = { y: Y(L.plot.y1), x0: L.plot.x0 - 16, x1: L.plot.x1 + 16, z0: zPanel, z1: zMax + 36 * m.e };
  } else {
    panel = { z: zPanel, x0: L.plot.x0, x1: L.plot.x1, y0: Y(L.plot.y1), y1: Y(L.plot.y0) };
    for (const tk of L.ticks) {
      if (tk.value === 0) continue;
      grid.push({ a: [tk.pos, Y(L.plot.y1), zPanel], b: [tk.pos, Y(L.plot.y0), zPanel] });
    }
    floor = { y: Y(L.plot.y1), x0: L.plot.x0 - 16, x1: L.plot.x1 + 16, z0: zPanel, z1: zMax + 30 * m.e };
  }

  let target: Scene['target'] = null;
  if (L.target) {
    const yT = Y(L.target.pos);
    target = { y: yT, x0: L.plot.x0, x1: L.plot.x1, z0: zPanel, z1: zMax + 10 * m.e };
    labels.push({ p: [L.target.x, yT, target.z1], dx: 0, dy: L.target.ty - L.target.pos, text: L.target.text, anchor: L.target.anchor, kind: 'target' });
    // Bars that cross the plane are cut in two, so the plane can be drawn between the parts.
    const cut: Box[] = [];
    for (const b of boxes) {
      if (b.y0 < yT - 1e-6 && b.y1 > yT + 1e-6) {
        cut.push({ ...b, y1: yT, part: 'below' }, { ...b, y0: yT, part: 'above' });
      } else cut.push({ ...b, part: b.y1 <= yT + 1e-6 ? 'below' : 'above' });
    }
    boxes.splice(0, boxes.length, ...cut);
  }

  const min: V3 = [panel.x0, panel.y0, zPanel];
  const max: V3 = [panel.x1, panel.y1, zMax];
  for (const b of boxes) {
    min[0] = Math.min(min[0], b.x0);
    min[1] = Math.min(min[1], b.y0);
    max[0] = Math.max(max[0], b.x1);
    max[1] = Math.max(max[1], b.y1);
  }
  const pivot: V3 = [(min[0] + max[0]) / 2, L.form === 'columns' ? min[1] + (max[1] - min[1]) * 0.45 : (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.max(40, 0.5 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]));
  return { form: L.form, vw: L.vw, vh: L.vh, boxes, ghosts, floor, panel, grid, target, labels, pivot, radius, bounds: { min, max } };
}

export interface Camera {
  project: (p: V3) => [number, number]; // viewBox units
  depth: (p: V3) => number; // larger = nearer the viewer
  eye: V3; // world position of the eye
  scale: number; // auto-fit scale
}

const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Perspective camera turned by the pose, with a dolly zoom: the distance shrinks from 60 to 4.5 scene radii as t
 * grows, and the plane through the pivot keeps its scale, so at t = 0 the projection is the flat chart exactly.
 */
export function camera(scene: Scene, pose: Pose, m: Morph): Camera {
  const th = rad(pose.yaw);
  const ph = rad(pose.tilt);
  const [ct, st, cp, sp] = [Math.cos(th), Math.sin(th), Math.cos(ph), Math.sin(ph)];
  const D = scene.radius * lerp(60, 4.5, smooth(m.t));
  const [px, py, pz] = scene.pivot;
  const ox = px;
  const oy = scene.vh - py;
  const flat = m.t < 1e-3;
  const view = (p: V3): V3 => {
    const x = p[0] - px;
    const y = p[1] - py;
    const z = p[2] - pz;
    const x1 = x * ct + z * st;
    const z1 = -x * st + z * ct;
    return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
  };
  const raw = (p: V3): [number, number] => {
    const [x, y, z] = view(p);
    const s = flat ? 1 : D / (D - z);
    return [ox + x * s, oy - y * s];
  };
  // Auto-fit: turned, the scene and its labels are scaled to stay inside the box and centred in it. Labels keep their
  // size, so they are fitted as fixed offsets around their scaled anchors. Identity at t = 0 (fit is 0 there).
  const { min, max } = scene.bounds;
  const pts: { x: number; y: number; ax: number; bx: number; ay: number; by: number }[] = [];
  for (let i = 0; i < 8; i++) {
    const [x, y] = raw([i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]);
    pts.push({ x, y, ax: 0, bx: 0, ay: 0, by: 0 });
  }
  for (const l of scene.labels) {
    const [x, y] = raw(l.p);
    const box = textBox(l.text, l.dx, l.dy, l.anchor, l.kind === 'tick' ? 11 : 12);
    pts.push({ x, y, ax: box.x0 - 3, bx: box.x1 + 3, ay: box.y0, by: box.y1 });
  }
  const margin = 10;
  const span = (s: number, at: 'x' | 'y') => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const q of pts) {
      lo = Math.min(lo, q[at] * s + (at === 'x' ? q.ax : q.ay));
      hi = Math.max(hi, q[at] * s + (at === 'x' ? q.bx : q.by));
    }
    return [lo, hi] as const;
  };
  const fits = (s: number) => {
    const [xl, xh] = span(s, 'x');
    const [yl, yh] = span(s, 'y');
    return xh - xl <= scene.vw - 2 * margin && yh - yl <= scene.vh - 2 * margin;
  };
  let sf = 1;
  if (m.fit > 0 && !fits(1)) {
    // The spread only grows with the scale (a convex function of it), so the largest scale that fits is found by halving.
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 18; k++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    sf = Math.max(0.05, lo);
  }
  const [xl, xh] = span(sf, 'x');
  const [yl, yh] = span(sf, 'y');
  const shiftX = scene.vw / 2 - (xl + xh) / 2;
  const shiftY = scene.vh / 2 - (yl + yh) / 2;
  const fx = (sx: number, sy: number): [number, number] => [sx + m.fit * (sx * sf + shiftX - sx), sy + m.fit * (sy * sf + shiftY - sy)];
  return {
    project: (p) => {
      const [sx, sy] = raw(p);
      return m.fit > 0 ? fx(sx, sy) : [sx, sy];
    },
    depth: (p) => view(p)[2],
    eye: [px - D * cp * st, py + D * sp, pz + D * cp * ct],
    scale: lerp(1, sf, m.fit),
  };
}

const corners = (b: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }): V3[] => {
  const out: V3[] = [];
  for (let i = 0; i < 8; i++) out.push([i & 1 ? b.x1 : b.x0, i & 2 ? b.y1 : b.y0, i & 4 ? b.z1 : b.z0]);
  return out;
};

/**
 * True when a must be painted before b: some axis separates the two boxes, and the eye is on b's side of it, so a
 * can never cover b. Exact for any two boxes that don't overlap.
 */
export function paintsBefore(a: Box, b: Box, eye: V3): boolean | null {
  const lo = [a.x0, a.y0, a.z0];
  const hi = [a.x1, a.y1, a.z1];
  const blo = [b.x0, b.y0, b.z0];
  const bhi = [b.x1, b.y1, b.z1];
  for (const k of [1, 0, 2]) {
    if (hi[k]! <= blo[k]! + 1e-9) return eye[k]! > (hi[k]! + blo[k]!) / 2;
    if (bhi[k]! <= lo[k]! + 1e-9) return eye[k]! < (bhi[k]! + lo[k]!) / 2;
  }
  return null;
}

/**
 * Painter's order (far to near) for boxes. Only pairs whose screen rectangles overlap are ordered by the separating
 * axis; the rest fall back to distance from the eye. Boxes above and below a target plane are ordered separately.
 */
export function sortBoxes(boxes: Box[], cam: Camera): Box[] {
  const rects = boxes.map((b) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const c of corners(b)) {
      const [sx, sy] = cam.project(c);
      x0 = Math.min(x0, sx);
      x1 = Math.max(x1, sx);
      y0 = Math.min(y0, sy);
      y1 = Math.max(y1, sy);
    }
    return { x0, y0, x1, y1 };
  });
  const dist = boxes.map((b) => Math.hypot((b.x0 + b.x1) / 2 - cam.eye[0], (b.y0 + b.y1) / 2 - cam.eye[1], (b.z0 + b.z1) / 2 - cam.eye[2]));
  const n = boxes.length;
  const after: number[][] = Array.from({ length: n }, () => []);
  const indeg = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = rects[i]!;
      const b = rects[j]!;
      if (a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0) continue;
      const first = paintsBefore(boxes[i]!, boxes[j]!, cam.eye);
      if (first === null) continue;
      const [u, v] = first ? [i, j] : [j, i];
      after[u]!.push(v);
      indeg[v]!++;
    }
  }
  // Kahn's algorithm, farthest first among the ready ones.
  const out: Box[] = [];
  const done = new Array<boolean>(n).fill(false);
  for (let k = 0; k < n; k++) {
    let pick = -1;
    for (let i = 0; i < n; i++) if (!done[i] && indeg[i] === 0 && (pick < 0 || dist[i]! > dist[pick]!)) pick = i;
    if (pick < 0) for (let i = 0; i < n; i++) if (!done[i] && (pick < 0 || dist[i]! > dist[pick]!)) pick = i; // a cycle: never expected
    done[pick] = true;
    out.push(boxes[pick]!);
    for (const v of after[pick]!) indeg[v]!--;
  }
  return out;
}

/** The whole paint order: boxes below the target plane, the plane, boxes above (reversed when the eye is below it). */
export function paintOrder(scene: Scene, cam: Camera): { below: Box[]; above: Box[]; eyeAbove: boolean } {
  if (!scene.target) return { below: sortBoxes(scene.boxes, cam), above: [], eyeAbove: true };
  const below = sortBoxes(scene.boxes.filter((b) => b.part === 'below'), cam);
  const above = sortBoxes(scene.boxes.filter((b) => b.part === 'above'), cam);
  return { below, above, eyeAbove: cam.eye[1] >= scene.target.y };
}

/** Convex hull (monotone chain) of screen points. */
export function convexHull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export function insidePolygon(pt: [number, number], poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The datum under a screen point, nearest box first; -1 for none. Boxes are given in paint order (far to near). The
 * exact outlines are tried first, so a neighbour's grown edge never takes a point the bar itself covers; only then a
 * few units of slack, for thin bars.
 */
export function hitTest(order: Box[], cam: Camera, pt: [number, number], pad = 3): number {
  for (const grow of pad > 0 ? [0, pad] : [0]) {
    for (let i = order.length - 1; i >= 0; i--) {
      const b = order[i]!;
      const grown = { ...b, x0: b.x0 - grow, x1: b.x1 + grow, y0: b.y0 - grow, y1: b.y1 + grow };
      if (insidePolygon(pt, convexHull(corners(grown).map(cam.project)))) return b.datum;
    }
  }
  return -1;
}

// ---------------------------------------------------------------- drag physics

/** Past a limit the pose follows the hand at 30%, never more than 12 degrees beyond it. */
export function rubberBand(raw: number, lo: number, hi: number): number {
  if (raw > hi) return hi + Math.min(LIMITS.over, (raw - hi) * 0.3);
  if (raw < lo) return lo - Math.min(LIMITS.over, (lo - raw) * 0.3);
  return raw;
}

/** Critically damped spring toward target (exact step): no overshoot from rest. Returns [position, velocity]. */
export function springStep(x: number, v: number, target: number, omega: number, dt: number): [number, number] {
  const d = x - target;
  const c = v + omega * d;
  const e = Math.exp(-omega * dt);
  return [target + (d + c * dt) * e, (v - omega * c * dt) * e];
}

/** Coasting after release: velocity decays with a 0.25 s time constant. Returns [position, velocity]. */
export function coastStep(x: number, v: number, dt: number, tau = 0.25): [number, number] {
  const e = Math.exp(-dt / tau);
  return [x + v * tau * (1 - e), v * e];
}

/** The hand position that rubberBand maps to this pose: grabbing a chart past a limit must not make it jump. */
export function unRubberBand(pose: number, lo: number, hi: number): number {
  if (pose > hi) return hi + Math.min(LIMITS.over - 1e-6, pose - hi) / 0.3;
  if (pose < lo) return lo - Math.min(LIMITS.over - 1e-6, lo - pose) / 0.3;
  return pose;
}

/** Fastest turn a release can start, in degrees a second. */
export const MAX_RELEASE = 600;

/**
 * The turn's velocity when the hand lets go, from its first and last recent samples: none (settle in place) when the
 * samples span under 30 ms, since a click with a wobble is not a flick; otherwise capped at MAX_RELEASE.
 */
export function releaseVelocity(first: { at: number; yaw: number; tilt: number }, last: { at: number; yaw: number; tilt: number }): Pose | null {
  const span = (last.at - first.at) / 1000;
  if (!(span >= 0.03)) return null;
  const cap = (v: number) => Math.max(-MAX_RELEASE, Math.min(MAX_RELEASE, v));
  return { yaw: cap((last.yaw - first.yaw) / span), tilt: cap((last.tilt - first.tilt) / span) };
}

export const clampPose = (p: Pose): Pose => ({ yaw: Math.min(LIMITS.yaw, Math.max(-LIMITS.yaw, p.yaw)), tilt: Math.min(LIMITS.tiltMax, Math.max(LIMITS.tiltMin, p.tilt)) });
