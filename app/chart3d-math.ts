// Graphs that rest as an ordinary flat chart and turn 3D as the page is rotated. This file is the pure part: the
// flat layout, the 3D scene built from the same numbers, the camera, paint order, hit testing and the drag physics.
// No DOM, no Intl, no Date or Math.random, so the server-rendered flat chart and the browser agree to the pixel.
// Shared byte-for-byte by both apps (app/ and alerts/app/).

export type Unit = 'currency' | 'count' | 'ratio';
export type Form = 'columns' | 'rows';
export type Anchor = 'start' | 'middle' | 'end';
/** The chart types a person can pick. Each has a flat look and a 3D look, and only the ones that fit the data are offered. */
export type ChartKind = 'columns' | 'bars' | 'stacked' | 'bullet' | 'lollipop' | 'line' | 'area' | 'donut' | 'heatmap';

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
  // What the numbers are, which decides the chart types offered (kindsFor).
  ordered?: boolean; // the categories have a real order (deal stages): line and area
  parts?: boolean; // the values are sums or counts that add up to a whole: donut, and stacked for two breakdowns
  compare?: boolean; // two series, the second the target of the first (pipeline vs quota): bullet
  grid?: boolean; // two breakdowns: heatmap
  total?: { value: number; display: string; label: string }; // a governed total (the tile's number), shown in the donut's hole
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

const glassTone = (flat: string, hover: string, core: string, glow: number): SeriesTone => ({
  flat,
  hover,
  core,
  rim: mix(core, T.white, 0.25),
  shade: mix(core, T.black, 0.4),
  cap: mix(core, T.white, 0.55),
  edge: mix(core, T.white, 0.45),
  glow,
});
/**
 * A donut's wedge colours, in order around the ring. Neighbours are kept apart for colour-blind readers (checked with the
 * dataviz palette validator: worst neighbouring pair 13.9 under protanopia); each wedge also has a gap, a legend row
 * and a table row, so colour is never the only way to tell them apart.
 */
export const PART_TONES: SeriesTone[] = [
  SERIES_TONES[0]!,
  SERIES_TONES[1]!,
  glassTone(mix(T.orange, T.white, 0.55), mix(T.orange, T.white, 0.35), mix(T.orange, T.white, 0.4), 0.8),
  SERIES_TONES[2]!,
  glassTone(T.orangeDark, mix(T.orangeDark, T.black, 0.2), T.orangeDark, 0.7),
  glassTone(mix(T.field, T.line, 0.5), T.field, T.line, 0.5),
];
export const DONUT_MAX = PART_TONES.length;

/** A heatmap cell's colour: one hue, light to dark with the value (0..1). */
export const heatFill = (p: number) => mix(T.orangeSoft, T.orangeDark, Math.min(1, Math.max(0, p)));

/** Ink for text on a coloured mark: whichever of charcoal and white reads better on it. */
export const inkOn = (fill: string): 'dark' | 'light' => (contrast(fill, T.chrome) >= contrast(fill, T.white) ? 'dark' : 'light');

/** The picker's order, with each type's name and what it shows. */
export const KINDS: { kind: ChartKind; name: string; hint: string }[] = [
  { kind: 'columns', name: 'Columns', hint: 'bars that stand up' },
  { kind: 'bars', name: 'Bars', hint: 'bars that run across, good for long names' },
  { kind: 'stacked', name: 'Stacked', hint: 'each bar split into its parts' },
  { kind: 'bullet', name: 'Bullet', hint: 'each bar inside its target' },
  { kind: 'lollipop', name: 'Lollipop', hint: 'a dot on a thin stem' },
  { kind: 'line', name: 'Line', hint: 'points joined in order' },
  { kind: 'area', name: 'Area', hint: 'a filled line, in order' },
  { kind: 'donut', name: 'Donut', hint: 'shares of the whole' },
  { kind: 'heatmap', name: 'Heatmap', hint: 'a grid shaded by size' },
];
const KIND_SET = new Set<string>(KINDS.map((k) => k.kind));
export const isKind = (v: unknown): v is ChartKind => typeof v === 'string' && KIND_SET.has(v);

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

/** The chart type a graph opens in: columns, or bars when there are many categories or long names. */
export const defaultKind = (chart: ChartData): ChartKind => (chooseForm(chart) === 'rows' ? 'bars' : 'columns');

/**
 * The chart types that fit this data, in the picker's order. A type is offered only when it can't mislead:
 * - line and area need categories with a real order (deal stages), since a line between regions means nothing;
 * - donut needs sums or counts that make up one whole, at most six of them, none missing;
 * - stacked needs two breakdowns of a sum or count, so each stack is a real total;
 * - bullet needs a series and its target (pipeline and quota);
 * - heatmap needs two breakdowns.
 * A single number gets no choice: it is a number, not a comparison.
 */
export function kindsFor(chart: ChartData): ChartKind[] {
  const n = chart.categories.length;
  const S = Math.max(1, Math.min(MAX_SERIES, chart.series.length));
  const values = chart.data.filter((d) => d.series < S).map((d) => d.value);
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const nonNegative = known.every((v) => v >= 0);
  const base = defaultKind(chart);
  if (n < 2 && S < 2) return [base];
  const ok = new Set<ChartKind>([base]);
  // Columns only up to the 12 categories the default allows them; past that their labels pile up.
  if (n <= 12) ok.add('columns');
  // Bars run across, and only columns draw a target line (1.00x = quota), so a chart with a target keeps columns.
  if (!chart.target || base === 'bars') ok.add('bars');
  if (S === 1 && n >= 2) ok.add('lollipop');
  if (chart.ordered && n >= 2) ok.add('line');
  if (chart.ordered && n >= 2 && S === 1 && nonNegative) ok.add('area');
  const whole = known.length === values.length && known.length === n && known.reduce((s, v) => s + v, 0) > 0;
  if (chart.parts && S === 1 && n >= 2 && n <= DONUT_MAX && whole && nonNegative && !chart.target) ok.add('donut');
  if (chart.parts && S >= 2 && nonNegative && known.length > 0) ok.add('stacked');
  if (chart.compare && S === 2) ok.add('bullet');
  if (chart.grid && S >= 2 && n >= 2) ok.add('heatmap');
  return KINDS.map((k) => k.kind).filter((k) => ok.has(k));
}

/** Which way a bar-like type runs: columns stand up, bars run across, and the others follow the data. */
export function formFor(chart: ChartData, kind: ChartKind): Form {
  if (kind === 'columns') return 'columns';
  if (kind === 'bars') return 'rows';
  if (kind === 'stacked' || kind === 'bullet' || kind === 'lollipop') return chooseForm(chart);
  return 'columns';
}

// The picked chart type of each graph that remembers it, kept in one small cookie ("id.kind~id.kind"), so the first
// paint already shows it. Only known ids and types are read back; anything else is ignored.
export const KINDS_COOKIE = 'alto_charts';
const ID_RE = /^[a-z0-9-]{1,64}$/;
const MAX_REMEMBERED = 24;

export function parseKinds(raw: string | undefined | null): Record<string, ChartKind> {
  const out: Record<string, ChartKind> = {};
  if (!raw || raw.length > 2048) return out;
  for (const part of raw.split('~').slice(0, MAX_REMEMBERED)) {
    const dot = part.lastIndexOf('.');
    const id = part.slice(0, dot);
    const kind = part.slice(dot + 1);
    if (dot > 0 && ID_RE.test(id) && isKind(kind) && !Object.prototype.hasOwnProperty.call(out, id)) out[id] = kind;
  }
  return out;
}

/** The cookie value after picking a type for one graph: that graph first, at most MAX_REMEMBERED graphs. */
export function rememberKind(raw: string | undefined | null, id: string, kind: ChartKind): string {
  if (!ID_RE.test(id)) return Object.entries(parseKinds(raw)).map(([i, k]) => `${i}.${k}`).join('~');
  const rest = Object.entries(parseKinds(raw)).filter(([i]) => i !== id);
  return [[id, kind], ...rest].slice(0, MAX_REMEMBERED).map(([i, k]) => `${i}.${k}`).join('~');
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
  text: string; // value label ('' = none: it doesn't fit, and the table and tooltip have the value)
  tx: number;
  ty: number;
  anchor: Anchor;
  round?: 'end' | 'none'; // stacked: only the stack's last part has rounded corners
  ink?: 'dark' | 'light'; // a label drawn inside the bar (stacked), in this ink
  dot?: { x: number; y: number; r: number }; // lollipop: the dot at the bar's end (the bar is the stem)
  role?: 'case' | 'fill'; // bullet: the target's glass case, and the bar it holds
}
/** A point of a line or area chart. */
export interface Point {
  datum: number;
  cat: number;
  series: number;
  x: number;
  y: number;
  value: number;
  text: string; // '' = no label (it would collide); the table and tooltip have the value
  tx: number;
  ty: number;
  anchor: Anchor;
}
/** A donut wedge: angles in radians, clockwise from 12 o'clock. */
export interface Wedge {
  datum: number;
  cat: number;
  tone: number; // index into PART_TONES
  a0: number;
  a1: number;
  value: number;
}
export interface DonutGeo {
  cx: number;
  cy: number;
  r0: number;
  r1: number;
  wedges: Wedge[];
  legend: { datum: number; tone: number; x: number; y: number; label: string; full: string; value: string; vx: number }[];
  center: { text: string; y: number; sub: string; subY: number } | null;
}
export interface HeatCell {
  datum: number; // -1: no row for this pair
  cat: number;
  series: number;
  x: number;
  y: number;
  w: number;
  h: number;
  value: number | null;
  share: number; // value / largest value, 0..1
  fill: string;
  text: string;
  ink: 'dark' | 'light';
  tx: number;
  ty: number;
}
export interface HeatGeo {
  cells: HeatCell[];
  rows: { text: string; full: string; x: number; y: number }[];
  top: number; // the grid's edges
  bottom: number;
  left: number;
  right: number;
  max: number;
  transposed: boolean; // categories as rows (many of them), series as columns
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
  kind: ChartKind;
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
  points: Point[]; // line and area
  runs: { series: number; points: number[] }[]; // unbroken stretches of points (a missing value breaks the line)
  donut: DonutGeo | null;
  heat: HeatGeo | null;
}

const SIZES = { tile: { vw: 400, vh: 180 }, card: { vw: 560, vh: 220 }, answer: { vw: 560, vh: 240 } } as const;
/** Below this stage width (CSS px) wide charts use a narrower viewBox, so their text stays readable on a phone. */
export const NARROW_PX = 480;
const NARROW_VW = { columns: 340, rows: 360 } as const;
export const ROW_H = 28;
export const ROW_LABEL_W = 150;

/** Whether a chart has a separate narrow layout (the dashboard tiles are small already, except bars that run across). */
export const hasNarrow = (chart: ChartData, kind: ChartKind = defaultKind(chart)) => chart.size !== 'tile' || formFor(chart, kind) === 'rows';

type Rect = { x0: number; y0: number; x1: number; y1: number };
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
const textBox = (text: string, x: number, y: number, anchor: Anchor, size = 12): Rect => {
  const w = text.length * CHAR_W * (size / 12);
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return { x0, y0: y - size * 0.85, x1: x0 + w, y1: y + size * 0.3 };
};
const inside = (r: Rect, vw: number, vh: number) => r.x0 >= 0 && r.y0 >= 0 && r.x1 <= vw && r.y1 <= vh;

/** What a bar covers on the chart: the bar, its label and a lollipop's dot. */
const barRects = (bars: Bar[]): Rect[] =>
  bars.flatMap((b) => {
    const out: Rect[] = [{ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h }, textBox(b.text, b.tx, b.ty, b.anchor)];
    if (b.dot) out.push({ x0: b.dot.x - b.dot.r, y0: b.dot.y - b.dot.r, x1: b.dot.x + b.dot.r, y1: b.dot.y + b.dot.r });
    return out;
  });

/**
 * Where the target line's label goes: as far right as it can sit, just above or just below the line, without covering
 * a bar or a value label; when every spot covers something, the spot that covers least.
 */
function placeTarget(text: string, pos: number, plot: Rect, taken: Rect[]): { x: number; ty: number; anchor: Anchor } {
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

/** The full value when it fits the room, else the short form, else nothing (the tooltip and table keep the exact value). */
const fitText = (display: string, v: number, unit: Unit, room: number) =>
  display.length * CHAR_W <= room ? display : compact(v, unit).length * CHAR_W <= room ? compact(v, unit) : '';

const NO_EXTRA = { points: [] as Point[], runs: [] as Layout['runs'], donut: null, heat: null };

/** The flat chart of a type. At rest the page shows exactly this; the 3D scene is built from it. */
export function layout2D(chart: ChartData, kind: ChartKind = defaultKind(chart), narrow = false): Layout {
  if (kind === 'donut') return donutLayout(chart, narrow);
  if (kind === 'heatmap') return heatLayout(chart, narrow);
  if (kind === 'line' || kind === 'area') return lineLayout(chart, kind, narrow);
  return barLayout(chart, kind, formFor(chart, kind), narrow);
}

function barLayout(chart: ChartData, kind: ChartKind, form: Form, narrow: boolean): Layout {
  const S = Math.max(1, Math.min(MAX_SERIES, chart.series.length));
  const values = chart.data.map((d) => (d.value !== null && Number.isFinite(d.value) ? Math.max(0, d.value) : null));
  const catIndex = new Map(chart.categories.map((c, i) => [c.key, i]));
  const n = Math.max(1, chart.categories.length);
  // Grouped bars give each series a lane of its own; stacks, bullets and lollipops share one.
  const grouped = kind === 'columns' || kind === 'bars';
  const lanes = grouped ? S : 1;
  const at = (cat: number, s: number) => chart.data.findIndex((d) => catIndex.get(d.category) === cat && d.series === s);
  const sums = new Array<number>(n).fill(0);
  chart.data.forEach((d, k) => {
    const c = catIndex.get(d.category);
    if (c !== undefined && d.series < S) sums[c]! += values[k] ?? 0;
  });
  // A stack reaches its parts' total; everything else, its largest value.
  const tops = kind === 'stacked' ? sums : values.map((v) => v ?? 0);
  const max = Math.max(0, chart.axisFloor ?? 0, chart.target?.value ?? 0, ...tops);
  const bars: Bar[] = [];
  const ghosts: Ghost[] = [];
  const cats: CatLabel[] = [];
  const ink = (s: number) => inkOn((SERIES_TONES[s] ?? SERIES_TONES[0]!).flat);

  if (form === 'rows') {
    // Today's copilot bar chart: a 150-unit label column, 28-unit rows, 18-unit bars, values after the bar.
    const vw = narrow ? NARROW_VW.rows : 560;
    const bandH = 18 + 12 * (lanes - 1);
    const rowH = ROW_H + 12 * (lanes - 1);
    const vh = Math.max(64, n * rowH + 8);
    const barW = vw - ROW_LABEL_W - 90;
    const axisMax = max || 1;
    const xAt = (v: number) => (v / axisMax) * barW;
    const ticks = niceTicks(axisMax, chart.unit)
      .filter((v) => v <= axisMax * (1 + 1e-9))
      .map((v) => ({ value: v, text: compact(v, chart.unit), pos: ROW_LABEL_W + (v / axisMax) * barW }));
    chart.categories.forEach((c, i) => {
      const y = i * rowH + 4;
      cats.push({ text: shortLabel(c.label, 18), full: c.label, x: ROW_LABEL_W - 8, y: y + bandH / 2 + 6, anchor: 'end' });
    });
    if (grouped) {
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
        const w = xAt(v);
        bars.push({ datum: k, cat, series: d.series, x: ROW_LABEL_W, y, w, h, value: v, text: d.display, tx: ROW_LABEL_W + Math.max(w, 1) + 6, ty: y + h / 2 + 4, anchor: 'start' });
      });
    } else {
      for (let cat = 0; cat < chart.categories.length; cat++) {
        const y = cat * rowH + 4;
        if (kind === 'stacked') {
          // Parts left to right in series order, a 2-unit gap of card between them; labels inside when they fit.
          let acc = 0;
          const parts: Bar[] = [];
          for (let s = 0; s < S; s++) {
            const k = at(cat, s);
            const v = k < 0 ? null : values[k];
            if (v === null || v === undefined || v <= 0) continue;
            const x0 = ROW_LABEL_W + xAt(acc);
            const w0 = xAt(v);
            acc += v;
            const gap = parts.length && w0 > 2.5 ? 2 : 0;
            const w = w0 - gap;
            const text = fitText(chart.data[k]!.display, v, chart.unit, w - 8);
            parts.push({ datum: k, cat, series: s, x: x0 + gap, y, w, h: 18, value: v, text, tx: x0 + gap + w / 2, ty: y + 13, anchor: 'middle', round: 'none', ink: ink(s) });
          }
          if (parts.length) parts[parts.length - 1]!.round = 'end';
          bars.push(...parts);
        } else if (kind === 'lollipop') {
          const k = at(cat, 0);
          if (k < 0) continue;
          const v = values[k];
          if (v === null || v === undefined) {
            ghosts.push({ datum: k, cat, series: 0, x: ROW_LABEL_W, y, w: 18, text: 'n/a', tx: ROW_LABEL_W + 6, ty: y + 13, anchor: 'start' });
            continue;
          }
          const w = xAt(v);
          bars.push({ datum: k, cat, series: 0, x: ROW_LABEL_W, y: y + 8, w, h: 2, value: v, text: chart.data[k]!.display, tx: ROW_LABEL_W + w + 11, ty: y + 13, anchor: 'start', dot: { x: ROW_LABEL_W + w, y: y + 9, r: 5 } });
        } else if (kind === 'bullet') {
          // The target (series 1) is a case the full band high; the bar it holds (series 0) is a thinner bar inside it.
          const kc = at(cat, 1);
          const kf = at(cat, 0);
          const vc = kc < 0 ? null : values[kc];
          const vf = kf < 0 ? null : values[kf];
          const wc = vc === null || vc === undefined ? 0 : xAt(vc);
          const wf = vf === null || vf === undefined ? 0 : xAt(vf);
          if (vc !== null && vc !== undefined) bars.push({ datum: kc, cat, series: 1, x: ROW_LABEL_W, y, w: wc, h: 18, value: vc, text: '', tx: 0, ty: 0, anchor: 'start', role: 'case' });
          else if (kc >= 0) ghosts.push({ datum: kc, cat, series: 1, x: ROW_LABEL_W, y, w: 18, text: '', tx: 0, ty: 0, anchor: 'start' });
          // One label after the longer bar: "pipeline of quota" (both exactly as the Numbers view writes them).
          const tx = ROW_LABEL_W + Math.max(wc, wf, 1) + 6;
          const fill = kf >= 0 ? chart.data[kf]!.display : '';
          const goal = kc >= 0 ? chart.data[kc]!.display : '';
          const both = goal ? `${fill} of ${goal}` : fill;
          const text = tx + both.length * CHAR_W <= vw - 2 ? both : fill;
          if (vf !== null && vf !== undefined) bars.push({ datum: kf, cat, series: 0, x: ROW_LABEL_W, y: y + 5, w: wf, h: 8, value: vf, text, tx, ty: y + 13, anchor: 'start', role: 'fill' });
          else if (kf >= 0) ghosts.push({ datum: kf, cat, series: 0, x: ROW_LABEL_W, y: y + 5, w: 8, text: 'n/a', tx, ty: y + 13, anchor: 'start' });
        }
      }
    }
    return { kind, form, vw, vh, base: ROW_LABEL_W, plot: { x0: ROW_LABEL_W, y0: 4, x1: ROW_LABEL_W + barW, y1: n * rowH + 4 }, axisMax, ticks, bars, ghosts, cats, target: null, seriesCount: S, band: bandH, ...NO_EXTRA };
  }

  const { vh } = SIZES[chart.size ?? 'answer'];
  const vw = narrow ? NARROW_VW.columns : SIZES[chart.size ?? 'answer'].vw;
  const plot = { x0: 50, y0: 24, x1: vw - 14, y1: vh - 30 };
  const plotH = plot.y1 - plot.y0;
  const ticksV = niceTicks(max, chart.unit);
  const axisMax = ticksV[ticksV.length - 1]!;
  const hAt = (v: number) => (v / axisMax) * plotH;
  const ticks = ticksV.map((v) => ({ value: v, text: compact(v, chart.unit), pos: plot.y1 - (v / axisMax) * plotH }));
  const slot = (plot.x1 - plot.x0) / n;
  const gw = Math.min(slot * 0.64, 56 + 26 * (lanes - 1));
  const maxChars = Math.max(4, Math.floor((slot - 6) / CHAR_W));
  chart.categories.forEach((c, i) => {
    cats.push({ text: shortLabel(c.label, maxChars), full: c.label, x: plot.x0 + slot * (i + 0.5), y: plot.y1 + 18, anchor: 'middle' });
  });
  if (grouped) {
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
      const h = hAt(v);
      // Full value when it fits over its bar, else the short form; the tooltip and table keep the exact value.
      const room = (S > 1 ? sw : slot) - 4;
      const text = d.display.length * CHAR_W <= room ? d.display : compact(v, chart.unit);
      bars.push({ datum: k, cat, series: d.series, x, y: plot.y1 - h, w, h, value: v, text, tx: x + w / 2, ty: plot.y1 - h - 6, anchor: 'middle' });
    });
  } else {
    for (let cat = 0; cat < chart.categories.length; cat++) {
      const cx = plot.x0 + slot * (cat + 0.5);
      if (kind === 'stacked') {
        // Parts bottom to top in series order, a 2-unit gap of card between them; labels inside when they fit.
        let acc = 0;
        const parts: Bar[] = [];
        for (let s = 0; s < S; s++) {
          const k = at(cat, s);
          const v = k < 0 ? null : values[k];
          if (v === null || v === undefined || v <= 0) continue;
          const bottom = plot.y1 - hAt(acc);
          const top = plot.y1 - hAt(acc + v);
          acc += v;
          const gap = parts.length && bottom - top > 2.5 ? 2 : 0;
          const h = bottom - top - gap;
          const text = h >= 16 ? fitText(chart.data[k]!.display, v, chart.unit, gw - 6) : '';
          parts.push({ datum: k, cat, series: s, x: cx - gw / 2, y: top, w: gw, h, value: v, text, tx: cx, ty: top + h / 2 + 4, anchor: 'middle', round: 'none', ink: ink(s) });
        }
        if (parts.length) parts[parts.length - 1]!.round = 'end';
        bars.push(...parts);
      } else if (kind === 'lollipop') {
        const k = at(cat, 0);
        if (k < 0) continue;
        const v = values[k];
        if (v === null || v === undefined) {
          ghosts.push({ datum: k, cat, series: 0, x: cx - 5, y: plot.y1, w: 10, text: 'n/a', tx: cx, ty: plot.y1 - 6, anchor: 'middle' });
          continue;
        }
        const h = hAt(v);
        const text = chart.data[k]!.display.length * CHAR_W <= slot - 4 ? chart.data[k]!.display : compact(v, chart.unit);
        bars.push({ datum: k, cat, series: 0, x: cx - 1, y: plot.y1 - h, w: 2, h, value: v, text, tx: cx, ty: plot.y1 - h - 11, anchor: 'middle', dot: { x: cx, y: plot.y1 - h, r: 5 } });
      } else if (kind === 'bullet') {
        // The target (series 1) is a wide glass case; the bar it holds (series 0) stands inside it.
        const cw = Math.min(slot * 0.56, 64);
        const fw = Math.max(8, cw * 0.42);
        const kc = at(cat, 1);
        const kf = at(cat, 0);
        const vc = kc < 0 ? null : values[kc];
        const vf = kf < 0 ? null : values[kf];
        const caseTop = vc === null || vc === undefined ? null : plot.y1 - hAt(vc);
        const fillTop = vf === null || vf === undefined ? null : plot.y1 - hAt(vf);
        // The bar's label goes above it, or above the case when the bar ends just under the case's top.
        let fy = (fillTop ?? plot.y1) - 6;
        if (caseTop !== null && fillTop !== null && fillTop - caseTop > 0 && fillTop - caseTop < 18) fy = caseTop - 6;
        let fillText = '';
        if (vf !== null && vf !== undefined && fillTop !== null) {
          fillText = chart.data[kf]!.display.length * CHAR_W <= slot - 4 ? chart.data[kf]!.display : compact(vf, chart.unit);
          bars.push({ datum: kf, cat, series: 0, x: cx - fw / 2, y: fillTop, w: fw, h: plot.y1 - fillTop, value: vf, text: fillText, tx: cx, ty: fy, anchor: 'middle', role: 'fill' });
        } else if (kf >= 0) {
          fillText = 'n/a';
          ghosts.push({ datum: kf, cat, series: 0, x: cx - fw / 2, y: plot.y1, w: fw, text: 'n/a', tx: cx, ty: fy, anchor: 'middle' });
        }
        const fillBox = textBox(fillText, cx, fy, 'middle');
        if (vc !== null && vc !== undefined && caseTop !== null) {
          // The case's label: beside its top edge, else above the bar's label, else left to the table.
          const d = chart.data[kc]!;
          const right = Math.min(vw - 2, cx + slot / 2 - 2);
          let label = { text: '', tx: 0, ty: 0, anchor: 'start' as Anchor };
          for (const text of [d.display, compact(vc, chart.unit)]) {
            const a = { text, tx: cx + cw / 2 + 4, ty: caseTop + 9, anchor: 'start' as Anchor };
            const box = textBox(a.text, a.tx, a.ty, a.anchor);
            if (box.x1 <= right && box.y0 >= 0 && overlap(box, fillBox) === 0) {
              label = a;
              break;
            }
            const b = { text, tx: cx, ty: Math.min(fy, caseTop - 6) - 15, anchor: 'middle' as Anchor };
            const bb = textBox(b.text, b.tx, b.ty, b.anchor);
            if (bb.y0 >= 0 && bb.x0 >= cx - slot / 2 && bb.x1 <= cx + slot / 2) {
              label = b;
              break;
            }
          }
          bars.unshift({ datum: kc, cat, series: 1, x: cx - cw / 2, y: caseTop, w: cw, h: plot.y1 - caseTop, value: vc, ...label, role: 'case' });
        } else if (kc >= 0) {
          // No target ("No quota"): said beside the baseline, else above the bar's label, else left to the table.
          const text = chart.data[kc]!.display;
          const right = Math.min(vw - 2, cx + slot / 2 - 2);
          const side = { text, tx: cx + cw / 2 + 4, ty: plot.y1 - 6, anchor: 'start' as Anchor };
          const sb = textBox(side.text, side.tx, side.ty, side.anchor);
          const up = { text, tx: cx, ty: fy - 15, anchor: 'middle' as Anchor };
          const ub = textBox(up.text, up.tx, up.ty, up.anchor);
          const label = sb.x1 <= right && overlap(sb, fillBox) === 0 ? side : ub.y0 >= 0 && ub.x0 >= cx - slot / 2 && ub.x1 <= cx + slot / 2 ? up : { ...side, text: '' };
          ghosts.push({ datum: kc, cat, series: 1, x: cx - cw / 2, y: plot.y1, w: cw, ...label });
        }
      }
    }
  }
  let target: Layout['target'] = null;
  if (chart.target) {
    const pos = plot.y1 - (chart.target.value / axisMax) * plotH;
    target = { pos, text: chart.target.label, ...placeTarget(chart.target.label, pos, plot, barRects(bars)) };
  }
  return { kind, form, vw, vh, base: plot.y1, plot, axisMax, ticks, bars, ghosts, cats, target, seriesCount: S, band: kind === 'bullet' ? Math.min(slot * 0.56, 64) : gw, ...NO_EXTRA };
}

/** Line and area: one point per category at its slot's centre, joined in order; a missing value breaks the line. */
function lineLayout(chart: ChartData, kind: ChartKind, narrow: boolean): Layout {
  const S = Math.max(1, Math.min(MAX_SERIES, chart.series.length));
  const values = chart.data.map((d) => (d.value !== null && Number.isFinite(d.value) ? Math.max(0, d.value) : null));
  const catIndex = new Map(chart.categories.map((c, i) => [c.key, i]));
  const n = Math.max(1, chart.categories.length);
  const max = Math.max(0, chart.axisFloor ?? 0, chart.target?.value ?? 0, ...values.map((v) => v ?? 0));
  const { vh } = SIZES[chart.size ?? 'answer'];
  const vw = narrow ? NARROW_VW.columns : SIZES[chart.size ?? 'answer'].vw;
  const plot = { x0: 50, y0: 24, x1: vw - 14, y1: vh - 30 };
  const plotH = plot.y1 - plot.y0;
  const ticksV = niceTicks(max, chart.unit);
  const axisMax = ticksV[ticksV.length - 1]!;
  const ticks = ticksV.map((v) => ({ value: v, text: compact(v, chart.unit), pos: plot.y1 - (v / axisMax) * plotH }));
  const slot = (plot.x1 - plot.x0) / n;
  const maxChars = Math.max(4, Math.floor((slot - 6) / CHAR_W));
  const cats: CatLabel[] = chart.categories.map((c, i) => ({ text: shortLabel(c.label, maxChars), full: c.label, x: plot.x0 + slot * (i + 0.5), y: plot.y1 + 18, anchor: 'middle' }));
  const points: Point[] = [];
  const ghosts: Ghost[] = [];
  chart.data.forEach((d, k) => {
    const cat = catIndex.get(d.category);
    if (cat === undefined || d.series >= S) return;
    const x = plot.x0 + slot * (cat + 0.5);
    const v = values[k];
    if (v === null || v === undefined) {
      ghosts.push({ datum: k, cat, series: d.series, x: x - 5, y: plot.y1, w: 10, text: 'n/a', tx: x, ty: plot.y1 - 6, anchor: 'middle' });
      return;
    }
    const y = plot.y1 - (v / axisMax) * plotH;
    points.push({ datum: k, cat, series: d.series, x, y, value: v, text: '', tx: x, ty: y - 10, anchor: 'middle' });
  });
  const runs: Layout['runs'] = [];
  for (let s = 0; s < S; s++) {
    const mine = points.map((p, i) => [p, i] as const).filter(([p]) => p.series === s).sort((a, b) => a[0].cat - b[0].cat);
    let run: number[] = [];
    let last = -2;
    for (const [p, i] of mine) {
      if (p.cat !== last + 1 && run.length) {
        runs.push({ series: s, points: run });
        run = [];
      }
      run.push(i);
      last = p.cat;
    }
    if (run.length) runs.push({ series: s, points: run });
  }
  // Labels: the first series first, larger values first; above the point, else below it, else left to the table.
  // A label never covers a point, the line, an "n/a" or another label.
  const taken: Rect[] = points.map((p) => ({ x0: p.x - 5, y0: p.y - 5, x1: p.x + 5, y1: p.y + 5 }));
  for (const r of runs) {
    for (let i = 1; i < r.points.length; i++) {
      const a = points[r.points[i - 1]!]!;
      const b = points[r.points[i]!]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3));
      for (let j = 1; j < steps; j++) {
        const x = lerp(a.x, b.x, j / steps);
        const y = lerp(a.y, b.y, j / steps);
        taken.push({ x0: x - 1, y0: y - 1, x1: x + 1, y1: y + 1 });
      }
    }
  }
  for (const g of ghosts) taken.push(textBox(g.text, g.tx, g.ty, g.anchor));
  const own = (p: Point) => ({ x0: p.x - 5, y0: p.y - 5, x1: p.x + 5, y1: p.y + 5 });
  for (const p of [...points].sort((a, b) => a.series - b.series || b.value - a.value)) {
    const text = fitText(chart.data[p.datum]!.display, p.value, chart.unit, slot - 4);
    if (!text) continue;
    for (const ty of [p.y - 10, p.y + 18]) {
      const box = textBox(text, p.x, ty, 'middle');
      if (!inside(box, vw, plot.y1 + 4)) continue;
      const mine = own(p);
      if (taken.some((r) => overlap(r, box) > 0 && !(r.x0 === mine.x0 && r.y0 === mine.y0))) continue;
      p.text = text;
      p.ty = ty;
      taken.push(box);
      break;
    }
  }
  let target: Layout['target'] = null;
  if (chart.target) {
    const pos = plot.y1 - (chart.target.value / axisMax) * plotH;
    target = { pos, text: chart.target.label, ...placeTarget(chart.target.label, pos, plot, taken) };
  }
  return { kind, form: 'columns', vw, vh, base: plot.y1, plot, axisMax, ticks, bars: [], ghosts, cats, target, seriesCount: S, band: Math.min(slot * 0.64, 56), points, runs, donut: null, heat: null };
}

/** Donut: shares of one whole, wedges clockwise from 12 o'clock in category order, a legend with the values beside it. */
function donutLayout(chart: ChartData, narrow: boolean): Layout {
  const { vh } = SIZES[chart.size ?? 'answer'];
  const vw = narrow ? NARROW_VW.columns : SIZES[chart.size ?? 'answer'].vw;
  const r1 = Math.min(vh / 2 - 12, vw * 0.22);
  const r0 = r1 * 0.64;
  const cx = 14 + r1;
  const cy = vh / 2;
  const catIndex = new Map(chart.categories.map((c, i) => [c.key, i]));
  const items = chart.data
    .map((d, k) => ({ d, k, cat: catIndex.get(d.category) ?? -1 }))
    .filter((x) => x.cat >= 0 && x.d.series === 0 && x.d.value !== null && Number.isFinite(x.d.value) && x.d.value >= 0)
    .sort((a, b) => a.cat - b.cat);
  const total = items.reduce((s, x) => s + (x.d.value ?? 0), 0);
  let a = 0;
  const wedges: Wedge[] = items.map((x, i) => {
    const a0 = a;
    a = i === items.length - 1 ? Math.PI * 2 : a + (total > 0 ? ((x.d.value ?? 0) / total) * Math.PI * 2 : 0);
    return { datum: x.k, cat: x.cat, tone: i % DONUT_MAX, a0, a1: a, value: x.d.value ?? 0 };
  });
  const lx = cx + r1 + 26;
  const rowH = 22;
  const y0 = cy - (wedges.length * rowH) / 2 + 15;
  // The legend is a compact table beside the ring: names, then values right-aligned close to them (so a turned chart
  // keeps each value next to its name), never past the edge.
  const nameW = Math.max(0, ...items.map((x) => chart.categories[x.cat]!.label.length)) * CHAR_W;
  const valueW = Math.max(0, ...items.map((x) => x.d.display.length)) * CHAR_W;
  const vx = Math.min(vw - 8, lx + 16 + nameW + 18 + valueW);
  const legend = wedges.map((w, i) => {
    const d = chart.data[w.datum]!;
    const full = chart.categories[w.cat]!.label;
    const value = vx - d.display.length * CHAR_W - 12 - (lx + 16) >= 4 * CHAR_W ? d.display : compact(w.value, chart.unit);
    const chars = Math.max(3, Math.floor((vx - value.length * CHAR_W - 12 - (lx + 16)) / CHAR_W));
    return { datum: w.datum, tone: w.tone, x: lx, y: y0 + i * rowH, label: shortLabel(full, chars), full, value, vx };
  });
  let center: DonutGeo['center'] = null;
  if (chart.total) {
    const room = 2 * Math.sqrt(r0 * r0 - 225) - 4; // the hole's width at the text's top
    const big = chart.total.display.length * CHAR_W * (16 / 12) <= room ? chart.total.display : compact(chart.total.value, chart.unit);
    center = { text: big, y: cy - 1, sub: chart.total.label, subY: cy + 19 };
  }
  return {
    kind: 'donut',
    form: 'columns',
    vw,
    vh,
    base: cy + r1,
    plot: { x0: cx - r1, y0: cy - r1, x1: cx + r1, y1: cy + r1 },
    axisMax: total,
    ticks: [],
    bars: [],
    ghosts: [],
    cats: [],
    target: null,
    seriesCount: 1,
    band: r1 - r0,
    points: [],
    runs: [],
    donut: { cx, cy, r0, r1, wedges, legend, center },
    heat: null,
  };
}

/**
 * Heatmap: series as rows and categories as columns (or the other way round when there are many categories), each cell
 * shaded light to dark by its value and labelled with it when the label fits.
 */
function heatLayout(chart: ChartData, narrow: boolean): Layout {
  const S = Math.max(1, Math.min(MAX_SERIES, chart.series.length));
  const n = Math.max(1, chart.categories.length);
  const transposed = n > 8;
  const vw = narrow ? NARROW_VW.columns : SIZES[chart.size ?? 'answer'].vw;
  const labelW = narrow ? 84 : 120;
  const rowCount = transposed ? n : S;
  const colCount = transposed ? S : n;
  // Few rows get taller cells (up to 56), so the grid, and the towers it grows when turned, have room.
  const minH = 0.75 * SIZES[chart.size ?? 'answer'].vh;
  const cellH = transposed ? 24 : Math.max(34, Math.min(56, (minH - 34) / rowCount));
  const top = 8;
  const bottom = top + rowCount * cellH;
  const vh = bottom + 26;
  const left = labelW;
  const right = vw - 10;
  const cellW = (right - left) / colCount;
  const catIndex = new Map(chart.categories.map((c, i) => [c.key, i]));
  const known = chart.data.filter((d) => d.series < S && d.value !== null && Number.isFinite(d.value)).map((d) => Math.max(0, d.value!));
  const max = Math.max(0, ...known) || 1;
  const cells: HeatCell[] = [];
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < colCount; c++) {
      const cat = transposed ? r : c;
      const series = transposed ? c : r;
      const k = chart.data.findIndex((d) => catIndex.get(d.category) === cat && d.series === series);
      const d = k < 0 ? null : chart.data[k]!;
      const value = d && d.value !== null && Number.isFinite(d.value) ? Math.max(0, d.value) : null;
      const x = left + c * cellW + 1;
      const y = top + r * cellH + 1;
      const w = cellW - 2;
      const h = cellH - 2;
      const share = value === null ? 0 : value / max;
      const fill = value === null ? mix(T.line, T.white, 0.5) : heatFill(0.08 + 0.92 * share);
      const text = !d ? '—' : value === null ? 'n/a' : fitText(d.display, value, chart.unit, w - 6);
      cells.push({ datum: k, cat, series, x, y, w, h, value, share, fill, text, ink: value === null ? 'dark' : inkOn(fill), tx: x + w / 2, ty: y + h / 2 + 4 });
    }
  }
  const rowNames = transposed ? chart.categories.map((c) => c.label) : chart.series.slice(0, S);
  const colNames = transposed ? chart.series.slice(0, S) : chart.categories.map((c) => c.label);
  const rows = rowNames.map((full, r) => ({ text: shortLabel(full, Math.max(4, Math.floor((labelW - 12) / CHAR_W))), full, x: left - 8, y: top + r * cellH + cellH / 2 + 4 }));
  const cats: CatLabel[] = colNames.map((full, c) => ({ text: shortLabel(full, Math.max(4, Math.floor((cellW - 4) / CHAR_W))), full, x: left + (c + 0.5) * cellW, y: bottom + 18, anchor: 'middle' }));
  return {
    kind: 'heatmap',
    form: 'columns',
    vw,
    vh,
    base: bottom,
    plot: { x0: left, y0: top, x1: right, y1: bottom },
    axisMax: max,
    ticks: [],
    bars: [],
    ghosts: [],
    cats,
    target: null,
    seriesCount: S,
    band: cellW,
    points: [],
    runs: [],
    donut: null,
    heat: { cells, rows, top, bottom, left, right, max, transposed },
  };
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
  lay: number; // a heatmap's grid lies back like a table top, its cells rising as towers
  grow: number; // 0..1 after the chart type changes while turned: the new marks rise into place
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
    lay: smoothstep(0.05, 0.75, t),
    grow: 1,
  };
}

export type V3 = [number, number, number];
export interface Bounds {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}
export interface Box extends Bounds {
  datum: number;
  series: number;
  part: 'whole' | 'below' | 'above'; // split at the target plane
  tone?: SeriesTone; // a colour of its own (heatmap cells); otherwise the series' colour
  round?: 'none' | 'all' | 'end'; // corner rounding when flat; default: the two outer corners (columns) or all four (rows)
  cap?: { c: V3; r: number }; // lollipop: the dot on the stem's end
  inner?: Box; // bullet: the bar standing inside this glass case
  role?: 'case' | 'cell';
}
/** A marker: a dot flat, a glass bead in 3D. */
export interface Dot {
  datum: number;
  c: V3;
  r: number;
}
/** An outline in the x-y plane pushed out in depth: a donut wedge, an area, or a line's ribbon. */
export interface Prism extends Bounds {
  datum: number; // -1 for a line or an area: its points carry the data
  series: number;
  tone: SeriesTone;
  look: 'area' | 'wedge' | 'ribbon';
  pts: [number, number][];
  smooth: boolean[]; // per edge (pts[i] to pts[i + 1]): part of a curve, so its sides are shaded as one surface
  part: 'whole' | 'below' | 'above';
  dots: Dot[]; // a line's or an area's markers
  curtain: [number, number][] | null; // a line's glow down to the floor, in its middle plane
  edge: [number, number][] | null; // an area's top line, drawn along its front
  out: [number, number] | null; // a wedge's direction out from the centre: hovered, it slides out along it
}
export type Mark = Box | Prism;
export const isPrism = (m: Mark): m is Prism => 'pts' in m;
/** A heatmap's grid: its marks are given flat and turned about the x axis through (y, z) by theta. */
export interface Frame {
  theta: number;
  y: number;
  z: number;
}
export interface Label3 {
  p: V3; // world anchor
  dx: number; // screen offset at the anchor, in viewBox units
  dy: number;
  text: string;
  anchor: Anchor;
  kind: 'value' | 'category' | 'tick' | 'target' | 'na' | 'total';
  datum?: number;
  ink?: 'dark' | 'light'; // a label inside a coloured mark: its ink on the light card
}
/** Label text size by kind, in viewBox units: ticks are smaller, a donut's total larger. */
export const labelSize = (kind: Label3['kind']) => (kind === 'tick' ? 11 : kind === 'total' ? 16 : 12);
export interface Scene {
  form: Form;
  kind: ChartKind;
  vw: number;
  vh: number;
  boxes: Box[];
  prisms: Prism[];
  ghosts: { datum: number; series: number; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }[];
  floor: { y: number; x0: number; x1: number; z0: number; z1: number } | null;
  panel: { z: number; x0: number; x1: number; y0: number; y1: number } | null;
  grid: { a: V3; b: V3 }[]; // value gridlines on the back panel
  target: { y: number; x0: number; x1: number; z0: number; z1: number } | null;
  labels: Label3[];
  swatches: { p: V3; s: number; tone: SeriesTone }[]; // a donut's legend keys (top-left corner, side)
  frame: Frame | null;
  board: { x0: number; x1: number; y0: number; y1: number; empty: { x0: number; x1: number; y0: number; y1: number }[] } | null; // heatmap grid, in its own frame
  pivot: V3;
  radius: number;
  bounds: { min: V3; max: V3 }; // marks and panel
}

export function frameToWorld(f: Frame, p: V3): V3 {
  const c = Math.cos(f.theta);
  const s = Math.sin(f.theta);
  const y = p[1] - f.y;
  const z = p[2] - f.z;
  return [p[0], f.y + y * c + z * s, f.z - y * s + z * c];
}
export function frameToLocal(f: Frame, p: V3): V3 {
  const c = Math.cos(f.theta);
  const s = Math.sin(f.theta);
  const y = p[1] - f.y;
  const z = p[2] - f.z;
  return [p[0], f.y + y * c - z * s, f.z + y * s + z * c];
}

/** A closed outline around a polyline, half-width hw, with mitred joins (limited, so sharp turns don't spike). */
export function strokeOutline(pts: [number, number][], hw: number): [number, number][] {
  if (pts.length < 2) return [];
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  const unit = (x: number, y: number): [number, number] => {
    const l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    const d1 = i > 0 ? unit(p[0] - a[0], p[1] - a[1]) : unit(b[0] - p[0], b[1] - p[1]);
    const d2 = i < pts.length - 1 ? unit(b[0] - p[0], b[1] - p[1]) : d1;
    const m = unit(-d1[1] - d2[1], d1[0] + d2[0]);
    const len = hw / Math.max(0.35, m[0] * -d2[1] + m[1] * d2[0]);
    left.push([p[0] + m[0] * len, p[1] + m[1] * len]);
    right.push([p[0] - m[0] * len, p[1] - m[1] * len]);
  }
  return [...left, ...right.reverse()];
}

const boundsOf = (pts: [number, number][], z0: number, z1: number) => ({
  x0: Math.min(...pts.map((p) => p[0])),
  x1: Math.max(...pts.map((p) => p[0])),
  y0: Math.min(...pts.map((p) => p[1])),
  y1: Math.max(...pts.map((p) => p[1])),
  z0,
  z1,
});

/** Centre, size and extent of a scene: the camera turns about the pivot and keeps radius in view. */
function frameScene(min: V3, max: V3, form: Form) {
  const pivot: V3 = [(min[0] + max[0]) / 2, form === 'columns' ? min[1] + (max[1] - min[1]) * 0.45 : (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.max(40, 0.5 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]));
  return { pivot, radius, bounds: { min, max } };
}

/** The 3D scene for a morph, built from the flat layout, so at t = 0 it projects exactly onto the flat chart. */
export function buildScene(L: Layout, m: Morph): Scene {
  if (L.kind === 'donut' && L.donut) return donutScene(L, L.donut, m);
  if (L.kind === 'heatmap' && L.heat) return heatScene(L, L.heat, m);
  const Y = (sy: number) => L.vh - sy; // world y is up; viewBox y is down
  const boxes: Box[] = [];
  const prisms: Prism[] = [];
  const ghosts: Scene['ghosts'] = [];
  const labels: Label3[] = [];
  const S = L.seriesCount;
  const grouped = L.kind === 'columns' || L.kind === 'bars';
  let zMin = 0;
  let zMax = 0;
  const keep = (z0: number, z1: number) => {
    zMin = Math.min(zMin, z0);
    zMax = Math.max(zMax, z1);
  };
  // After a type change the new marks rise from the baseline (grow 0 to 1).
  const yb = Y(L.base);
  const rise = (sy: number) => yb + (Y(sy) - yb) * m.grow;
  const reach = (sx: number) => L.base + (sx - L.base) * m.grow;

  if (L.kind === 'line' || L.kind === 'area') {
    // Each series is a ribbon (line) or a slab (area) in its own row in depth; markers become glass beads.
    const sep = 30 * m.e;
    for (const r of L.runs) {
      const s = r.series;
      const zc = -s * sep;
      const pts = r.points.map((i) => L.points[i]!);
      const tone = SERIES_TONES[s] ?? SERIES_TONES[0]!;
      const xy = pts.map((p) => [p.x, rise(p.y)] as [number, number]);
      const floorPts: [number, number][] = xy.length ? [...xy, [xy[xy.length - 1]![0], yb], [xy[0]![0], yb]] : [];
      if (L.kind === 'area') {
        const d = L.band * 0.8 * m.e;
        const outline = xy.length > 1 ? floorPts : [];
        const box = outline.length ? boundsOf(outline, zc - d / 2, zc + d / 2) : { x0: xy[0]![0], x1: xy[0]![0], y0: yb, y1: xy[0]![1], z0: zc - d / 2, z1: zc + d / 2 };
        prisms.push({ datum: -1, series: s, tone, look: 'area', pts: outline, smooth: outline.map(() => false), ...box, part: 'whole', dots: pts.map((p, i) => ({ datum: p.datum, c: [xy[i]![0], xy[i]![1], zc + d / 2], r: 4 + 1.5 * m.e })), curtain: null, edge: xy, out: null });
        keep(zc - d / 2, zc + d / 2);
        pts.forEach((p, i) => {
          if (p.text) labels.push({ p: [xy[i]![0], xy[i]![1], zc + d / 2], dx: 0, dy: p.ty - p.y, text: p.text, anchor: p.anchor, kind: 'value', datum: p.datum });
        });
      } else {
        const d = 12 * m.e;
        const outline = strokeOutline(xy, 1);
        const box = outline.length ? boundsOf([...outline, ...floorPts], zc - d / 2, zc + d / 2) : { x0: xy[0]![0] - 4, x1: xy[0]![0] + 4, y0: yb, y1: xy[0]![1] + 4, z0: zc - d / 2, z1: zc + d / 2 };
        prisms.push({ datum: -1, series: s, tone, look: 'ribbon', pts: outline, smooth: outline.map(() => false), ...box, part: 'whole', dots: pts.map((p, i) => ({ datum: p.datum, c: [xy[i]![0], xy[i]![1], zc], r: 4 + 1.5 * m.e })), curtain: xy.length > 1 ? floorPts : null, edge: null, out: null });
        keep(zc - d / 2, zc + d / 2);
        pts.forEach((p, i) => {
          if (p.text) labels.push({ p: [xy[i]![0], xy[i]![1], zc], dx: 0, dy: p.ty - p.y, text: p.text, anchor: p.anchor, kind: 'value', datum: p.datum });
        });
      }
    }
    for (const g of L.ghosts) {
      const w = g.w * m.e;
      ghosts.push({ datum: g.datum, series: g.series, x0: g.x, x1: g.x + g.w, y0: yb, y1: yb, z0: -g.series * sep - w / 2, z1: -g.series * sep + w / 2 });
      labels.push({ p: [g.tx, yb, -g.series * sep], dx: 0, dy: g.ty - L.base, text: g.text, anchor: g.anchor, kind: 'na', datum: g.datum });
    }
    for (const c of L.cats) labels.push({ p: [c.x, yb, zMax], dx: 0, dy: c.y - L.base, text: c.text, anchor: 'middle', kind: 'category' });
  } else if (L.form === 'columns') {
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
    if (grouped) {
      for (const b of L.bars) {
        const f = place(b.x, b.w, b.series, b.cat);
        boxes.push({ datum: b.datum, series: b.series, ...f, y0: yb, y1: yb + b.h * m.grow, part: 'whole' });
        keep(f.z0, f.z1);
        labels.push({ p: [(f.x0 + f.x1) / 2, yb + b.h * m.grow, f.z1], dx: 0, dy: b.ty - (L.base - b.h), text: b.text, anchor: 'middle', kind: 'value', datum: b.datum });
      }
      for (const g of L.ghosts) {
        const f = place(g.x, g.w, g.series, g.cat);
        ghosts.push({ datum: g.datum, series: g.series, ...f, y0: yb, y1: yb });
        labels.push({ p: [(f.x0 + f.x1) / 2, yb, f.z1], dx: 0, dy: -6, text: g.text, anchor: 'middle', kind: 'na', datum: g.datum });
      }
    } else {
      // Stacked parts, lollipop stems and bullets keep their flat places; only depth is added.
      const cases = new Map<number, Box>();
      for (const b of L.bars) {
        const depth = (b.role === 'case' ? b.w * 0.9 : b.dot ? 2 : b.w) * m.e;
        const box: Box = { datum: b.datum, series: b.series, x0: b.x, x1: b.x + b.w, y0: rise(b.y + b.h), y1: rise(b.y), z0: -depth / 2, z1: depth / 2, part: 'whole' };
        if (b.round) box.round = b.round;
        if (b.dot) box.cap = { c: [b.dot.x, rise(b.dot.y), 0], r: b.dot.r + 1.5 * m.e };
        if (b.role === 'case') {
          box.role = 'case';
          cases.set(b.cat, box);
          boxes.push(box);
        } else if (b.role === 'fill' && cases.has(b.cat)) cases.get(b.cat)!.inner = box;
        else boxes.push(box);
        keep(box.z0, box.z1);
        if (!b.text) continue;
        if (b.ink) labels.push({ p: [b.tx, rise(b.ty - 4), box.z1], dx: 0, dy: 4, text: b.text, anchor: b.anchor, kind: 'value', datum: b.datum, ink: b.ink });
        else {
          const ax = Math.min(Math.max(b.tx, b.x), b.x + b.w);
          labels.push({ p: [ax, rise(b.y), box.z1], dx: b.tx - ax, dy: b.ty - b.y, text: b.text, anchor: b.anchor, kind: 'value', datum: b.datum });
        }
      }
      for (const g of L.ghosts) {
        const d = g.w * m.e;
        ghosts.push({ datum: g.datum, series: g.series, x0: g.x, x1: g.x + g.w, y0: yb, y1: yb, z0: -d / 2, z1: d / 2 });
        if (g.text) labels.push({ p: [g.tx, yb, d / 2], dx: 0, dy: g.ty - L.base, text: g.text, anchor: g.anchor, kind: 'na', datum: g.datum });
      }
    }
    for (const c of L.cats) labels.push({ p: [c.x, yb, zMax], dx: 0, dy: c.y - L.base, text: c.text, anchor: 'middle', kind: 'category' });
  } else {
    const rowH = ROW_H + 12 * ((grouped ? S : 1) - 1);
    if (grouped) {
      const d3 = S > 1 ? L.band * 0.8 : 18;
      const sep = 1.5 * d3 * m.e;
      const place = (y: number, h: number, series: number, cat: number) => {
        const top3 = cat * rowH + 4 + (L.band - d3) / 2;
        const top = lerp(y, top3, m.group);
        const height = lerp(h, d3, m.group);
        const d = (S > 1 ? d3 : h) * m.e;
        const zc = -series * sep;
        return { y0: Y(top + height), y1: Y(top), z0: zc - d / 2, z1: zc + d / 2 };
      };
      for (const b of L.bars) {
        const f = place(b.y, b.h, b.series, b.cat);
        const x1 = L.base + Math.max(b.w, 1) * m.grow;
        boxes.push({ datum: b.datum, series: b.series, x0: L.base, x1, ...f, part: 'whole' });
        keep(f.z0, f.z1);
        labels.push({ p: [x1, (f.y0 + f.y1) / 2, f.z1], dx: b.tx - (L.base + Math.max(b.w, 1)), dy: b.ty - (b.y + b.h / 2), text: b.text, anchor: 'start', kind: 'value', datum: b.datum });
      }
      for (const g of L.ghosts) {
        const f = place(g.y, g.w, g.series, g.cat);
        ghosts.push({ datum: g.datum, series: g.series, x0: L.base, x1: L.base, ...f });
        labels.push({ p: [L.base, (f.y0 + f.y1) / 2, f.z1], dx: g.tx - L.base, dy: g.ty - (g.y + g.w / 2), text: g.text, anchor: 'start', kind: 'na', datum: g.datum });
      }
    } else {
      const cases = new Map<number, Box>();
      for (const b of L.bars) {
        const depth = (b.role === 'case' ? 16 : b.dot ? 2 : b.h) * m.e;
        const x0 = reach(b.x);
        const x1 = reach(b.x + Math.max(b.w, b.dot ? 0 : 1));
        const box: Box = { datum: b.datum, series: b.series, x0, x1, y0: Y(b.y + b.h), y1: Y(b.y), z0: -depth / 2, z1: depth / 2, part: 'whole' };
        if (b.round) box.round = b.round;
        if (b.dot) box.cap = { c: [reach(b.dot.x), Y(b.dot.y), 0], r: b.dot.r + 1.5 * m.e };
        if (b.role === 'case') {
          box.role = 'case';
          cases.set(b.cat, box);
          boxes.push(box);
        } else if (b.role === 'fill' && cases.has(b.cat)) cases.get(b.cat)!.inner = box;
        else boxes.push(box);
        keep(box.z0, box.z1);
        if (!b.text) continue;
        if (b.ink) labels.push({ p: [reach(b.tx), Y(b.ty - 4), box.z1], dx: 0, dy: 4, text: b.text, anchor: b.anchor, kind: 'value', datum: b.datum, ink: b.ink });
        else {
          // After the bar, or after the longer of a bullet's bar and its case.
          const end = b.role === 'fill' ? b.tx - 6 : b.x + Math.max(b.w, 1);
          labels.push({ p: [reach(end), Y(b.y + b.h / 2), box.z1], dx: b.tx - end, dy: b.ty - (b.y + b.h / 2), text: b.text, anchor: b.anchor, kind: 'value', datum: b.datum });
        }
      }
      for (const g of L.ghosts) {
        const d = g.w * m.e;
        ghosts.push({ datum: g.datum, series: g.series, x0: L.base, x1: L.base, y0: Y(g.y + g.w), y1: Y(g.y), z0: -d / 2, z1: d / 2 });
        if (g.text) labels.push({ p: [L.base, Y(g.y + g.w / 2), d / 2], dx: g.tx - L.base, dy: g.ty - (g.y + g.w / 2), text: g.text, anchor: g.anchor, kind: 'na', datum: g.datum });
      }
    }
    L.cats.forEach((c, i) => {
      const mid = i * rowH + 4 + L.band / 2;
      labels.push({ p: [L.base, Y(mid), zMax], dx: c.x - L.base, dy: c.y - mid, text: c.text, anchor: 'end', kind: 'category' });
    });
  }

  // The back panel carries the value gridlines. Flat, it lies in the bars' plane, so its gridlines are the 2D gridlines.
  const gap = (L.form === 'columns' ? L.band : 18) * 0.6 * m.e;
  const zPanel = zMin - gap;
  const grid: Scene['grid'] = [];
  let panel: NonNullable<Scene['panel']>;
  let floor: NonNullable<Scene['floor']>;
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
    // Bars that cross the plane are cut in two, so the plane can be drawn between the parts. A lollipop's dot goes with
    // the part it sits on; lines and areas go wholly to the side most of them is on.
    const cut: Box[] = [];
    for (const b of boxes) {
      if (b.y0 < yT - 1e-6 && b.y1 > yT + 1e-6 && !b.inner) {
        const { cap, ...rest } = b;
        cut.push({ ...rest, y1: yT, part: 'below' }, { ...rest, y0: yT, part: 'above', ...(cap ? { cap } : {}) });
      } else cut.push({ ...b, part: b.y1 <= yT + 1e-6 ? 'below' : 'above' });
    }
    boxes.splice(0, boxes.length, ...cut);
    for (const p of prisms) p.part = (p.y0 + p.y1) / 2 < yT ? 'below' : 'above';
  }

  const min: V3 = [panel.x0, panel.y0, zPanel];
  const max: V3 = [panel.x1, panel.y1, zMax];
  for (const b of [...boxes, ...prisms]) {
    min[0] = Math.min(min[0], b.x0);
    min[1] = Math.min(min[1], b.y0);
    max[0] = Math.max(max[0], b.x1);
    max[1] = Math.max(max[1], b.y1);
  }
  for (const b of boxes) {
    if (!b.cap) continue;
    min[1] = Math.min(min[1], b.cap.c[1] - b.cap.r);
    max[1] = Math.max(max[1], b.cap.c[1] + b.cap.r);
    max[0] = Math.max(max[0], b.cap.c[0] + b.cap.r);
  }
  return { form: L.form, kind: L.kind, vw: L.vw, vh: L.vh, boxes, prisms, ghosts, floor, panel, grid, target, labels, swatches: [], frame: null, board: null, ...frameScene(min, max, L.form) };
}

/**
 * A donut in 3D: each wedge becomes a glass segment of a thick ring standing on the floor, its legend beside it. After a
 * type change the wedges sweep round from 12 o'clock.
 */
function donutScene(L: Layout, D: DonutGeo, m: Morph): Scene {
  const Y = (sy: number) => L.vh - sy;
  const d = 0.3 * D.r1 * m.e;
  const z0 = -d / 2;
  const z1 = d / 2;
  const cy = Y(D.cy);
  const P = (r: number, a: number): [number, number] => [D.cx + r * Math.sin(a), cy + r * Math.cos(a)];
  const prisms: Prism[] = [];
  for (const w of D.wedges) {
    const a0 = w.a0 * m.grow;
    const a1 = w.a1 * m.grow;
    const span = a1 - a0;
    if (span <= 1e-6) continue;
    const pts = wedgeOutline(D, a0, a1).map(([x, y]) => [x, Y(y)] as [number, number]);
    const k = pts.length / 2 - 1; // edges per arc; edges k and the last are the wedge's straight ends
    const smooth = pts.map((_, i) => i !== k && i !== pts.length - 1);
    const am = (a0 + a1) / 2;
    prisms.push({ datum: w.datum, series: 0, tone: PART_TONES[w.tone] ?? PART_TONES[0]!, look: 'wedge', pts, smooth, ...boundsOf(pts, z0, z1), part: 'whole', dots: [], curtain: null, edge: null, out: [Math.sin(am), Math.cos(am)] });
  }
  const labels: Label3[] = [];
  const swatches: Scene['swatches'] = [];
  for (const l of D.legend) {
    swatches.push({ p: [l.x, Y(l.y - 9), z1], s: 10, tone: PART_TONES[l.tone] ?? PART_TONES[0]! });
    labels.push({ p: [l.x + 16, Y(l.y), z1], dx: 0, dy: 0, text: l.label, anchor: 'start', kind: 'category', datum: l.datum });
    // The value hangs off its name's anchor by a fixed offset, so turned it stays on its name's row.
    labels.push({ p: [l.x + 16, Y(l.y), z1], dx: l.vx - (l.x + 16), dy: 0, text: l.value, anchor: 'end', kind: 'value', datum: l.datum });
  }
  if (D.center) {
    labels.push({ p: [D.cx, Y(D.center.y), z1], dx: 0, dy: 0, text: D.center.text, anchor: 'middle', kind: 'total' });
    labels.push({ p: [D.cx, Y(D.center.subY), z1], dx: 0, dy: 0, text: D.center.sub, anchor: 'middle', kind: 'tick' });
  }
  const floor = { y: cy - D.r1 - 3, x0: D.cx - D.r1 * 1.45, x1: D.cx + D.r1 * 1.45, z0: z0 - 16 * m.e, z1: z1 + 36 * m.e };
  const min: V3 = [D.cx - D.r1, cy - D.r1, z0];
  const max: V3 = [D.cx + D.r1, cy + D.r1, z1];
  for (const s of swatches) {
    min[0] = Math.min(min[0], s.p[0]);
    max[0] = Math.max(max[0], s.p[0] + s.s);
  }
  return { form: 'columns', kind: 'donut', vw: L.vw, vh: L.vh, boxes: [], prisms, ghosts: [], floor, panel: null, grid: [], target: null, labels, swatches, frame: null, board: null, ...frameScene(min, max, 'columns') };
}

/**
 * A wedge's outline in viewBox units: the outer arc clockwise, then the inner arc back, with a 2-unit gap of card on
 * each side (the gap is the same width at both radii). The flat SVG and the 3D ring use this same outline.
 */
export function wedgeOutline(D: { cx: number; cy: number; r0: number; r1: number }, a0: number, a1: number): [number, number][] {
  const span = a1 - a0;
  const go = Math.min(1 / D.r1, span / 4);
  const gi = Math.min(1 / D.r0, span / 4);
  const k = Math.max(2, Math.ceil(span / (Math.PI / 60))); // 3 degree steps
  const at = (r: number, a: number): [number, number] => [D.cx + r * Math.sin(a), D.cy - r * Math.cos(a)];
  const out: [number, number][] = [];
  for (let i = 0; i <= k; i++) out.push(at(D.r1, lerp(a0 + go, a1 - go, i / k)));
  for (let i = k; i >= 0; i--) out.push(at(D.r0, lerp(a0 + gi, a1 - gi, i / k)));
  return out;
}

/**
 * A heatmap in 3D: the grid lies back like a table top (72 degrees at full turn) and each cell rises as a glass tower
 * whose height is its value, brighter the larger it is. Cells are built flat and turned with the grid (scene.frame).
 */
function heatScene(L: Layout, H: HeatGeo, m: Morph): Scene {
  const Y = (sy: number) => L.vh - sy;
  const frame: Frame = { theta: (72 * Math.PI * m.lay) / 180, y: Y(H.bottom), z: 0 };
  const W = (p: V3) => frameToWorld(frame, p);
  const tall = Math.min(70, 0.45 * L.vh);
  const boxes: Box[] = [];
  const labels: Label3[] = [];
  const empty: NonNullable<Scene['board']>['empty'] = [];
  for (const c of H.cells) {
    if (c.datum < 0 || c.value === null) {
      empty.push({ x0: c.x, x1: c.x + c.w, y0: Y(c.y + c.h), y1: Y(c.y) });
      if (c.text) labels.push({ p: W([c.tx, Y(c.ty - 4), 0]), dx: 0, dy: 4, text: c.text, anchor: 'middle', kind: 'na', ink: c.ink, ...(c.datum >= 0 ? { datum: c.datum } : {}) });
      continue;
    }
    const z1 = tall * c.share * m.e * m.grow;
    // On the dark stage the glass runs from a dim ember to full orange, so a larger value is a brighter tower.
    const tone = glassTone(c.fill, mix(c.fill, T.black, 0.15), mix(T.chrome2, T.orange, 0.3 + 0.7 * c.share), 0.3 + 0.7 * c.share);
    boxes.push({ datum: c.datum, series: c.series, x0: c.x, x1: c.x + c.w, y0: Y(c.y + c.h), y1: Y(c.y), z0: 0, z1, part: 'whole', tone, round: 'all', role: 'cell' });
    if (c.text) labels.push({ p: W([c.tx, Y(c.ty - 4), z1]), dx: 0, dy: 4, text: c.text, anchor: 'middle', kind: 'value', datum: c.datum, ink: c.ink });
  }
  for (const r of H.rows) labels.push({ p: W([r.x, Y(r.y - 4), 0]), dx: 0, dy: 4, text: r.text, anchor: 'end', kind: 'category' });
  for (const c of L.cats) labels.push({ p: W([c.x, Y(H.bottom), 0]), dx: 0, dy: c.y - H.bottom, text: c.text, anchor: 'middle', kind: 'category' });
  const board = { x0: H.left, x1: H.right, y0: Y(H.bottom), y1: Y(H.top), empty };
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  const add = (p: V3) => {
    const w = W(p);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, w[i]!);
      max[i] = Math.max(max[i]!, w[i]!);
    }
  };
  for (const [x, y] of [[board.x0, board.y0], [board.x1, board.y0], [board.x0, board.y1], [board.x1, board.y1]] as const) add([x, y, 0]);
  for (const b of boxes) for (let i = 0; i < 8; i++) add([i & 1 ? b.x1 : b.x0, i & 2 ? b.y1 : b.y0, i & 4 ? b.z1 : b.z0]);
  return { form: 'columns', kind: 'heatmap', vw: L.vw, vh: L.vh, boxes, prisms: [], ghosts: [], floor: null, panel: null, grid: [], target: null, labels, swatches: [], frame, board, ...frameScene(min, max, 'columns') };
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
    const box = textBox(l.text, l.dx, l.dy, l.anchor, labelSize(l.kind));
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

const corners = (b: Bounds): V3[] => {
  const out: V3[] = [];
  for (let i = 0; i < 8; i++) out.push([i & 1 ? b.x1 : b.x0, i & 2 ? b.y1 : b.y0, i & 4 ? b.z1 : b.z0]);
  return out;
};

/**
 * True when a must be painted before b: some axis separates the two boxes, and the eye is on b's side of it, so a
 * can never cover b. Exact for any two boxes that don't overlap.
 */
export function paintsBefore(a: Bounds, b: Bounds, eye: V3): boolean | null {
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
 * Painter's order (far to near) for marks, by their bounding boxes. Only pairs whose screen rectangles overlap are
 * ordered by the separating axis; the rest fall back to distance from the eye.
 */
export function sortBoxes<T extends Bounds>(boxes: T[], cam: Camera): T[] {
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
  const out: T[] = [];
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

/** The camera a scene's marks are drawn, sorted and hit tested with: a heatmap's grid turns in a frame of its own. */
export function localCamera(cam: Camera, f: Frame | null): Camera {
  if (!f) return cam;
  return { project: (p) => cam.project(frameToWorld(f, p)), depth: (p) => cam.depth(frameToWorld(f, p)), eye: frameToLocal(f, cam.eye), scale: cam.scale };
}

/**
 * The whole paint order: marks below the target plane, the plane, marks above (reversed when the eye is below it),
 * and the camera to draw and hit test them with.
 */
export function paintOrder(scene: Scene, world: Camera): { below: Mark[]; above: Mark[]; eyeAbove: boolean; cam: Camera } {
  const cam = localCamera(world, scene.frame);
  const marks: Mark[] = [...scene.boxes, ...scene.prisms];
  if (!scene.target) return { below: sortBoxes(marks, cam), above: [], eyeAbove: true, cam };
  const below = sortBoxes(marks.filter((b) => b.part === 'below'), cam);
  const above = sortBoxes(marks.filter((b) => b.part === 'above'), cam);
  return { below, above, eyeAbove: cam.eye[1] >= scene.target.y, cam };
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

/** On-screen radius of a bead of radius r at c: the longest of its three projected axes. */
export function dotRadius(cam: Camera, c: V3, r: number): number {
  const [x, y] = cam.project(c);
  let best = 0;
  for (const o of [[r, 0, 0], [0, r, 0], [0, 0, r]] as V3[]) {
    const [u, v] = cam.project([c[0] + o[0], c[1] + o[1], c[2] + o[2]]);
    best = Math.max(best, Math.hypot(u - x, v - y));
  }
  return best;
}

function segmentDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = dx * dx + dy * dy;
  const u = l > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
}

/** A wedge under the point, or for a line or area the point nearest along it (as a crosshair would pick). */
function hitPrism(pr: Prism, cam: Camera, pt: [number, number], grow: number): number {
  let best = -1;
  let bestD = Infinity;
  for (const d of pr.dots) {
    const [x, y] = cam.project(d.c);
    const dist = Math.hypot(pt[0] - x, pt[1] - y);
    if (dist <= dotRadius(cam, d.c, d.r) + 3 + grow && dist < bestD) {
      best = d.datum;
      bestD = dist;
    }
  }
  if (best >= 0) return best;
  if (pr.look === 'wedge') {
    const front = pr.pts.map(([x, y]) => cam.project([x, y, pr.z1]));
    const back = pr.pts.map(([x, y]) => cam.project([x, y, pr.z0]));
    if (insidePolygon(pt, front) || insidePolygon(pt, back)) return pr.datum;
    if (grow > 0 && front.some((p, i) => segmentDistance(pt, p, front[(i + 1) % front.length]!) <= grow)) return pr.datum;
    return -1;
  }
  if (!pr.dots.length) return -1;
  const line = pr.dots.map((d) => cam.project(d.c));
  const near =
    pr.look === 'area' && pr.pts.length
      ? insidePolygon(pt, pr.pts.map(([x, y]) => cam.project([x, y, pr.z1])))
      : line.some((p, i) => i > 0 && segmentDistance(pt, line[i - 1]!, p) <= 6 + grow);
  if (!near) return -1;
  let pick = 0;
  line.forEach((p, i) => {
    if (Math.abs(p[0] - pt[0]) < Math.abs(line[pick]![0] - pt[0])) pick = i;
  });
  return pr.dots[pick]!.datum;
}

/**
 * The datum under a screen point, nearest mark first; -1 for none. Marks are given in paint order (far to near). The
 * exact outlines are tried first, so a neighbour's grown edge never takes a point the bar itself covers; only then a
 * few units of slack, for thin bars. A bullet's bar is tried before its case, a lollipop's dot before its stem.
 */
export function hitTest(order: Mark[], cam: Camera, pt: [number, number], pad = 3): number {
  // A donut's wedges all share one depth, so a wedge's front face under the point beats any wedge's side or back.
  for (let i = order.length - 1; i >= 0; i--) {
    const b = order[i]!;
    if (isPrism(b) && b.look === 'wedge' && insidePolygon(pt, b.pts.map(([x, y]) => cam.project([x, y, b.z1])))) return b.datum;
  }
  // A line's point under the pointer beats a nearer line merely passing close by: the nearest point of any series wins.
  let bead = -1;
  let beadD = Infinity;
  for (const b of order) {
    if (!isPrism(b)) continue;
    for (const d of b.dots) {
      const [x, y] = cam.project(d.c);
      const dist = Math.hypot(pt[0] - x, pt[1] - y);
      if (dist <= dotRadius(cam, d.c, d.r) + 3 && dist < beadD) {
        bead = d.datum;
        beadD = dist;
      }
    }
  }
  if (bead >= 0) return bead;
  for (const grow of pad > 0 ? [0, pad] : [0]) {
    for (let i = order.length - 1; i >= 0; i--) {
      const b = order[i]!;
      if (isPrism(b)) {
        const d = hitPrism(b, cam, pt, grow);
        if (d >= 0) return d;
        continue;
      }
      if (b.cap) {
        const [x, y] = cam.project(b.cap.c);
        if (Math.hypot(pt[0] - x, pt[1] - y) <= dotRadius(cam, b.cap.c, b.cap.r) + grow) return b.datum;
      }
      for (const box of b.inner ? [b.inner, b] : [b]) {
        const grown = { ...box, x0: box.x0 - grow, x1: box.x1 + grow, y0: box.y0 - grow, y1: box.y1 + grow };
        if (insidePolygon(pt, convexHull(corners(grown).map(cam.project)))) return box.datum;
      }
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
