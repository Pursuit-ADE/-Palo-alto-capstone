// The chart type picker (app/chart3d-math.ts): only the types that fit the data are offered, every type's flat layout
// stays inside its box, the flat pose of its 3D scene is that layout exactly, turned it keeps its labels on stage, and
// the pointer finds the right value in every type.
import { describe, expect, it } from 'vitest';
import {
  buildScene,
  camera,
  defaultKind,
  DONUT_MAX,
  hitTest,
  isPrism,
  KINDS,
  kindsFor,
  labelSize,
  layout2D,
  localCamera,
  mix,
  morph,
  paintOrder,
  parseKinds,
  PART_TONES,
  poseToT,
  PRESET,
  rememberKind,
  TOKENS,
  wedgeOutline,
  type ChartData,
  type ChartKind,
  type Layout,
  type Pose,
} from '../app/chart3d-math';
import { drawFrame } from '../app/chart3d-draw';

const regions = (over: Partial<ChartData> = {}): ChartData => ({
  id: 'regions',
  title: 'Open pipeline by region',
  summary: '',
  unit: 'currency',
  categoryName: 'Region',
  categories: [
    { key: 'central', label: 'Central' },
    { key: 'east', label: 'East' },
    { key: 'west', label: 'West' },
  ],
  series: ['Open pipeline'],
  data: [
    { category: 'central', series: 0, value: 1898408, display: '$1,898,408' },
    { category: 'east', series: 0, value: 1069586, display: '$1,069,586' },
    { category: 'west', series: 0, value: 1998221, display: '$1,998,221' },
  ],
  parts: true,
  ...over,
});

const stagesTile = regions({
  id: 'kpi-pipeline',
  size: 'tile',
  form: 'columns',
  categoryName: 'Stage',
  categories: [
    { key: 'Prospecting', label: 'Prospecting' },
    { key: 'Engaging', label: 'Engaging' },
    { key: 'Negotiating', label: 'Negotiating' },
  ],
  data: [
    { category: 'Prospecting', series: 0, value: 2410551, display: '$2,410,551' },
    { category: 'Engaging', series: 0, value: 3892229, display: '$3,892,229' },
    { category: 'Negotiating', series: 0, value: 663435, display: '$663,435' },
  ],
  ordered: true,
  total: { value: 6966215, display: '$6,966,215', label: 'total' },
});

const coverage = regions({
  id: 'coverage-region-ratio',
  unit: 'ratio',
  size: 'card',
  parts: false,
  target: { value: 1, label: '1.00x = quota' },
  axisFloor: 1.25,
  data: [
    { category: 'central', series: 0, value: 0.76, display: '0.76x' },
    { category: 'east', series: 0, value: null, display: 'n/a' },
    { category: 'west', series: 0, value: 1.31, display: '1.31x' },
  ],
});

const pipelineVsQuota = regions({
  id: 'coverage-region-money',
  size: 'card',
  parts: false,
  compare: true,
  series: ['Pipeline closing in Q3', 'Quota for Q3'],
  data: [
    { category: 'central', series: 0, value: 762599, display: '$762,599' },
    { category: 'central', series: 1, value: 1003000, display: '$1,003,000' },
    { category: 'east', series: 0, value: 394634, display: '$394,634' },
    { category: 'east', series: 1, value: 926000, display: '$926,000' },
    { category: 'west', series: 0, value: 806676, display: '$806,676' },
    { category: 'west', series: 1, value: null, display: 'No quota' },
  ],
});

/** Two breakdowns: four regions by three stages, one pair with no row at all, one value missing. */
const twoDims = (() => {
  const cats = ['central', 'east', 'west', 'north'];
  const data: ChartData['data'] = [];
  cats.forEach((c, i) => {
    [0, 1, 2].forEach((s) => {
      if (c === 'north' && s === 2) return; // no row for this pair
      const value = c === 'east' && s === 1 ? null : (i + 1) * 100000 + s * 250000 + 1234;
      data.push({ category: c, series: s, value, display: value === null ? 'n/a' : `$${value.toLocaleString('en-US')}` });
    });
  });
  return regions({ id: 'answer-2', categories: cats.map((k) => ({ key: k, label: k[0]!.toUpperCase() + k.slice(1) })), series: ['Prospecting', 'Engaging', 'Won'], data, grid: true });
})();

/** Many owners by two stages: rows, and a heatmap with the owners down the side. */
const ownersByStage = (() => {
  const n = 10;
  const categories = Array.from({ length: n }, (_, i) => ({ key: `o${i}`, label: `Owner number ${i}` }));
  const data = categories.flatMap((c, i) => [0, 1].map((s) => ({ category: c.key, series: s, value: (n - i) * 1000 + s * 700 + 17, display: `$${(n - i) * 1000 + s * 700 + 17}` })));
  return regions({ id: 'answer-3', form: 'rows', categoryName: 'Owner', categories, series: ['Prospecting', 'Engaging'], data, grid: true, compare: true });
})();

const alerts = regions({
  id: 'alert-summary',
  unit: 'count',
  size: 'card',
  categoryName: 'Status',
  categories: [
    { key: 'delivered', label: 'Delivered' },
    { key: 'waiting', label: 'Waiting for digest' },
    { key: 'not_sent', label: 'Not sent' },
  ],
  series: ['Alerts'],
  data: [
    { category: 'delivered', series: 0, value: 12, display: '12' },
    { category: 'waiting', series: 0, value: 3, display: '3' },
    { category: 'not_sent', series: 0, value: 0, display: '0' },
  ],
});

const FIXTURES: [string, ChartData][] = [
  ['regions', regions()],
  ['stage tile', stagesTile],
  ['coverage', coverage],
  ['pipeline vs quota', pipelineVsQuota],
  ['two breakdowns', twoDims],
  ['owners by stage', ownersByStage],
  ['alerts', alerts],
];

/** Every chart, in every type it offers, wide and (where it has one) narrow. */
const CASES: [string, ChartData, ChartKind, boolean][] = FIXTURES.flatMap(([name, c]) => kindsFor(c).flatMap((k) => [[name, c, k, false] as [string, ChartData, ChartKind, boolean], [name, c, k, true] as [string, ChartData, ChartKind, boolean]]));

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const CHAR_W = 6.7;

describe('which chart types are offered', () => {
  it('only the types that fit the data, in the picker order, always with the default', () => {
    expect(kindsFor(regions())).toEqual(['columns', 'bars', 'lollipop', 'donut']);
    expect(kindsFor(stagesTile)).toEqual(['columns', 'bars', 'lollipop', 'line', 'area', 'donut']);
    expect(kindsFor(coverage)).toEqual(['columns', 'lollipop']); // bars can't draw its 1.00x line
    expect(kindsFor(pipelineVsQuota)).toEqual(['columns', 'bars', 'bullet']);
    expect(kindsFor(twoDims)).toEqual(['columns', 'bars', 'stacked', 'heatmap']);
    expect(kindsFor(ownersByStage)).toEqual(['columns', 'bars', 'stacked', 'bullet', 'heatmap']);
    for (const [, c] of FIXTURES) expect(kindsFor(c)).toContain(defaultKind(c));
    const order = KINDS.map((k) => k.kind);
    for (const [, c] of FIXTURES) {
      const ks = kindsFor(c);
      expect([...ks].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(ks);
    }
  });

  it('a single number is a number, not a comparison: no choice', () => {
    const one = regions({ categories: [{ key: 'all', label: 'All open deals' }], data: [{ category: 'all', series: 0, value: 5, display: '5' }], ordered: true });
    expect(kindsFor(one)).toEqual([defaultKind(one)]);
  });

  it('no line or area between regions, since their order means nothing', () => {
    expect(kindsFor(regions())).not.toContain('line');
    expect(kindsFor(regions())).not.toContain('area');
  });

  it('no donut unless every part is known, there are at most six, and they add up to a whole', () => {
    const seven = regions({
      categories: Array.from({ length: DONUT_MAX + 1 }, (_, i) => ({ key: `r${i}`, label: `R${i}` })),
      data: Array.from({ length: DONUT_MAX + 1 }, (_, i) => ({ category: `r${i}`, series: 0, value: i + 1, display: `${i + 1}` })),
    });
    expect(kindsFor(seven)).not.toContain('donut');
    const missing = regions({ data: regions().data.map((d, i) => (i === 1 ? { ...d, value: null, display: 'n/a' } : d)) });
    expect(kindsFor(missing)).not.toContain('donut');
    expect(kindsFor(regions({ parts: false }))).not.toContain('donut');
    expect(kindsFor(regions({ target: { value: 1, label: 'x' } }))).not.toContain('donut');
    const zero = regions({ data: regions().data.map((d) => ({ ...d, value: 0, display: '$0' })) });
    expect(kindsFor(zero)).not.toContain('donut');
    // A ratio is never a part of a whole.
    expect(kindsFor(coverage)).not.toContain('donut');
  });

  it('no bars when the chart has a target line, which only columns draw; no columns past 12 categories', () => {
    for (const kind of kindsFor(coverage)) expect(layout2D(coverage, kind).target, kind).not.toBeNull();
    const many = regions({
      categories: Array.from({ length: 13 }, (_, i) => ({ key: `o${i}`, label: `O${i}` })),
      data: Array.from({ length: 13 }, (_, i) => ({ category: `o${i}`, series: 0, value: i + 1, display: `${i + 1}` })),
    });
    expect(defaultKind(many)).toBe('bars');
    expect(kindsFor(many)).not.toContain('columns');
    expect(kindsFor(regions({ categories: many.categories.slice(0, 12), data: many.data.slice(0, 12) }))).toContain('columns');
  });

  it('stacked only for sums or counts, bullet only for a value and its target', () => {
    expect(kindsFor({ ...twoDims, parts: false })).not.toContain('stacked');
    expect(kindsFor({ ...pipelineVsQuota, compare: false })).not.toContain('bullet');
    expect(kindsFor({ ...twoDims, compare: true })).not.toContain('bullet'); // three series: no single target
  });
});

describe('remembering the picked type', () => {
  it('reads back only known ids and types, newest first, at most 24', () => {
    expect(parseKinds('kpi-pipeline.donut~coverage-region-money.bullet')).toEqual({ 'kpi-pipeline': 'donut', 'coverage-region-money': 'bullet' });
    expect(parseKinds('a.pie~B.donut~c.donut.x~.donut~d.~__proto__.donut~e.donut~e.line')).toEqual({ e: 'donut' });
    expect(parseKinds(undefined)).toEqual({});
    expect(parseKinds('x'.repeat(3000))).toEqual({});
    const proto = parseKinds('constructor.line');
    expect(Object.getPrototypeOf(proto)).toBe(Object.prototype);
    expect(proto.constructor).toBe('line');
    let raw = '';
    for (let i = 0; i < 30; i++) raw = rememberKind(raw, `g${i}`, 'line');
    const kept = Object.keys(parseKinds(raw));
    expect(kept).toHaveLength(24);
    expect(kept[0]).toBe('g29');
    expect(kept).not.toContain('g0');
    expect(parseKinds(rememberKind(raw, 'g10', 'donut'))['g10']).toBe('donut');
    expect(Object.keys(parseKinds(rememberKind(raw, 'g10', 'donut')))[0]).toBe('g10');
    expect(rememberKind('a.line', 'Bad Id', 'donut')).toBe('a.line');
  });
});

/** Every text the flat chart writes, with where it sits. */
function flatTexts(L: Layout): { text: string; x: number; y: number; anchor: string; size: number }[] {
  const out: { text: string; x: number; y: number; anchor: string; size: number }[] = [];
  const add = (text: string, x: number, y: number, anchor = 'middle', size = 12) => text && out.push({ text, x, y, anchor, size });
  for (const b of L.bars) add(b.text, b.tx, b.ty, b.anchor);
  for (const p of L.points) add(p.text, p.tx, p.ty, p.anchor);
  for (const g of L.ghosts) add(g.text, g.tx, g.ty, g.anchor, 11);
  for (const c of L.cats) add(c.text, c.x, c.y, c.anchor);
  if (L.target) add(L.target.text, L.target.x, L.target.ty, L.target.anchor);
  if (L.form === 'columns') for (const t of L.ticks) add(t.text, L.plot.x0 - 8, t.pos + 4, 'end', 11);
  if (L.donut) {
    for (const l of L.donut.legend) {
      add(l.label, l.x + 16, l.y, 'start');
      add(l.value, l.vx, l.y, 'end');
    }
    if (L.donut.center) {
      add(L.donut.center.text, L.donut.cx, L.donut.center.y, 'middle', 16);
      add(L.donut.center.sub, L.donut.cx, L.donut.center.subY, 'middle', 11);
    }
  }
  if (L.heat) {
    for (const c of L.heat.cells) add(c.text, c.tx, c.ty);
    for (const r of L.heat.rows) add(r.text, r.x, r.y, 'end');
  }
  return out;
}

const allNumbers = (v: unknown, path = ''): [string, number][] => {
  if (typeof v === 'number') return [[path, v]];
  if (Array.isArray(v)) return v.flatMap((x, i) => allNumbers(x, `${path}[${i}]`));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => allNumbers(x, `${path}.${k}`));
  return [];
};

describe('every type lays out inside its box', () => {
  for (const [name, c, kind, narrow] of CASES) {
    it(`${name} as ${kind}${narrow ? ' (narrow)' : ''}`, () => {
      const L = layout2D(c, kind, narrow);
      expect(L.kind).toBe(kind);
      for (const [p, v] of allNumbers(L)) expect(Number.isFinite(v), p).toBe(true);
      for (const t of flatTexts(L)) {
        const w = t.text.length * CHAR_W * (t.size / 12);
        const x0 = t.anchor === 'middle' ? t.x - w / 2 : t.anchor === 'end' ? t.x - w : t.x;
        const where = `"${t.text}" at ${t.x},${t.y}`;
        expect(x0, where).toBeGreaterThanOrEqual(-0.5);
        expect(x0 + w, where).toBeLessThanOrEqual(L.vw + 0.5);
        expect(t.y - t.size * 0.85, where).toBeGreaterThanOrEqual(-0.5);
        expect(t.y + t.size * 0.3, where).toBeLessThanOrEqual(L.vh + 0.5);
      }
      // Each value is drawn once: as a mark, a point, a wedge, a cell or an "n/a".
      const drawn = [...L.bars.map((b) => b.datum), ...L.points.map((p) => p.datum), ...L.ghosts.map((g) => g.datum), ...(L.donut?.wedges.map((w) => w.datum) ?? []), ...(L.heat?.cells.filter((x) => x.datum >= 0).map((x) => x.datum) ?? [])];
      expect(new Set(drawn).size).toBe(drawn.length);
    });
  }

  it('a donut is honest: wedge angles are proportional to the values and go all the way round', () => {
    const L = layout2D(stagesTile, 'donut');
    const total = stagesTile.data.reduce((s, d) => s + (d.value ?? 0), 0);
    for (const w of L.donut!.wedges) expect(near(w.a1 - w.a0, (w.value / total) * Math.PI * 2, 1e-9)).toBe(true);
    expect(near(L.donut!.wedges[L.donut!.wedges.length - 1]!.a1, Math.PI * 2)).toBe(true);
    // The hole shows the tile's governed total, never a sum the chart made up.
    expect(L.donut!.center!.text).toBe(stagesTile.total!.display);
    expect(layout2D(regions(), 'donut').donut!.center).toBeNull();
  });

  it('a stack reaches exactly its parts, and a missing part leaves no gap', () => {
    const L = layout2D(twoDims, 'stacked');
    const barHeight = (v: number) => (v / L.axisMax) * (L.plot.y1 - L.plot.y0);
    for (let cat = 0; cat < twoDims.categories.length; cat++) {
      const parts = L.bars.filter((b) => b.cat === cat);
      const sum = parts.reduce((s, b) => s + b.value, 0);
      const top = Math.min(...parts.map((b) => b.y));
      expect(near(top, L.plot.y1 - barHeight(sum), 1e-6)).toBe(true);
    }
  });

  it('a heatmap shades by value, one hue, and says "n/a" or "—" where there is nothing', () => {
    const L = layout2D(twoDims, 'heatmap');
    const known = L.heat!.cells.filter((c) => c.value !== null);
    const sorted = [...known].sort((a, b) => a.value! - b.value!);
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    for (let i = 1; i < sorted.length; i++) expect(lum(sorted[i]!.fill)).toBeLessThanOrEqual(lum(sorted[i - 1]!.fill));
    expect(L.heat!.cells.find((c) => c.datum < 0)!.text).toBe('—');
    expect(L.heat!.cells.find((c) => c.datum >= 0 && c.value === null)!.text).toBe('n/a');
    expect(layout2D(ownersByStage, 'heatmap').heat!.transposed).toBe(true);
  });

  it("donut colours are PANW tokens or mixes of them", () => {
    const allowed = new Set<string>(Object.values(TOKENS));
    const isMix = (c: string) => {
      for (const a of allowed) for (const b of allowed) for (let p = 0; p <= 1.0001; p += 0.05) if (mix(a, b, p) === c) return true;
      return false;
    };
    for (const t of PART_TONES) for (const c of [t.flat, t.hover, t.core]) expect(allowed.has(c) || isMix(c), c).toBe(true);
  });
});

describe("every type's flat pose is its 2D chart exactly", () => {
  for (const [name, c, kind, narrow] of CASES) {
    it(`${name} as ${kind}${narrow ? ' (narrow)' : ''}`, () => {
      const L = layout2D(c, kind, narrow);
      const m = morph(0);
      const scene = buildScene(L, m);
      const world = camera(scene, { yaw: 0, tilt: 0 }, m);
      const cam = localCamera(world, scene.frame);
      const P = (x: number, y: number, z: number) => cam.project([x, y, z]);
      // Bars (and a bullet's bar inside its case, a lollipop's stem): the front face is the flat rectangle.
      const boxes = scene.boxes.flatMap((b) => (b.inner ? [b, b.inner] : [b]));
      for (const bar of L.bars) {
        const parts = boxes.filter((b) => b.datum === bar.datum);
        expect(parts.length, `bar ${bar.datum}`).toBeGreaterThan(0);
        const x0 = Math.min(...parts.map((b) => P(b.x0, b.y0, b.z1)[0]));
        const x1 = Math.max(...parts.map((b) => P(b.x1, b.y1, b.z1)[0]));
        const yTop = Math.min(...parts.map((b) => P(b.x0, b.y1, b.z1)[1]));
        const yBot = Math.max(...parts.map((b) => P(b.x0, b.y0, b.z1)[1]));
        expect(near(x0, bar.x, 1e-6)).toBe(true);
        expect(near(x1, bar.x + (L.form === 'rows' && !bar.dot ? Math.max(bar.w, 1) : bar.w), 1e-6) || near(x1, bar.x + bar.w, 1e-6)).toBe(true);
        expect(near(yTop, bar.y, 1e-6)).toBe(true);
        expect(near(yBot, bar.y + bar.h, 1e-6)).toBe(true);
        if (bar.dot) {
          const cap = parts.find((b) => b.cap)!.cap!;
          const [x, y] = P(...cap.c);
          expect(near(x, bar.dot.x) && near(y, bar.dot.y)).toBe(true);
        }
      }
      // Heatmap cells: the board lies flat, so each tower's top is its cell.
      for (const cell of L.heat?.cells.filter((x) => x.datum >= 0 && x.value !== null) ?? []) {
        const b = scene.boxes.find((x) => x.datum === cell.datum)!;
        const [x0, y0] = P(b.x0, b.y0, b.z1);
        const [x1, y1] = P(b.x1, b.y1, b.z1);
        expect(near(Math.min(x0, x1), cell.x, 1e-6) && near(Math.max(x0, x1), cell.x + cell.w, 1e-6)).toBe(true);
        expect(near(Math.min(y0, y1), cell.y, 1e-6) && near(Math.max(y0, y1), cell.y + cell.h, 1e-6)).toBe(true);
      }
      // Donut wedges: the outline is the flat wedge.
      for (const w of L.donut?.wedges.filter((x) => x.a1 > x.a0) ?? []) {
        const pr = scene.prisms.find((p) => p.datum === w.datum)!;
        const flat = wedgeOutline(L.donut!, w.a0, w.a1);
        expect(pr.pts.length).toBe(flat.length);
        pr.pts.forEach(([x, y], i) => {
          const [sx, sy] = P(x, y, pr.z1);
          expect(near(sx, flat[i]![0], 1e-6) && near(sy, flat[i]![1], 1e-6)).toBe(true);
        });
      }
      // Lines and areas: every marker sits on its point.
      for (const p of L.points) {
        const dot = scene.prisms.flatMap((x) => x.dots).find((d) => d.datum === p.datum)!;
        const [x, y] = P(...dot.c);
        expect(near(x, p.x, 1e-6) && near(y, p.y, 1e-6)).toBe(true);
        expect(dot.r).toBe(4);
      }
      for (const pr of scene.prisms) expect(pr.z1 - pr.z0).toBe(0);
      for (const b of scene.boxes) expect(b.z1 - b.z0).toBe(0);
      // Every label of the scene lands on the same text of the flat chart.
      const texts = flatTexts(L);
      for (const l of scene.labels) {
        const [ax, ay] = world.project(l.p);
        const x = ax + l.dx;
        const y = ay + l.dy;
        const match = texts.find((t) => t.text === l.text && near(t.x, x, 1e-6) && near(t.y, y, 1e-6));
        expect(match, `${l.kind} "${l.text}" at ${x},${y}`).toBeTruthy();
      }
    });
  }
});

const POSES: Pose[] = [
  { yaw: 0, tilt: 30 },
  { yaw: 0, tilt: 62 },
  { yaw: -50, tilt: 62 },
  { yaw: 50, tilt: 62 },
  { yaw: -50, tilt: 0 },
  { yaw: 50, tilt: 10 },
  PRESET,
];

describe('every type, turned, keeps its labels on stage', () => {
  for (const [name, c, kind, narrow] of CASES) {
    it(`${name} as ${kind}${narrow ? ' (narrow)' : ''}`, () => {
      const L = layout2D(c, kind, narrow);
      for (const pose of POSES) {
        for (const grow of [1, 0.4]) {
          const m = { ...morph(poseToT(pose)), grow };
          const scene = buildScene(L, m);
          for (const [p, v] of allNumbers({ boxes: scene.boxes.map(({ tone: _t, ...b }) => b), prisms: scene.prisms.map(({ tone: _t, ...p }) => p) })) expect(Number.isFinite(v), p).toBe(true);
          const cam = camera(scene, pose, m);
          for (const l of scene.labels) {
            const [ax, ay] = cam.project(l.p);
            const size = labelSize(l.kind);
            const w = l.text.length * CHAR_W * (size / 12);
            const x = ax + l.dx;
            const y = ay + l.dy;
            const x0 = l.anchor === 'middle' ? x - w / 2 : l.anchor === 'end' ? x - w : x;
            const where = `${l.kind} "${l.text}" at yaw ${pose.yaw} tilt ${pose.tilt} grow ${grow}`;
            expect(x0 - 3, where).toBeGreaterThanOrEqual(-0.5);
            expect(x0 + w + 3, where).toBeLessThanOrEqual(L.vw + 0.5);
            expect(y - size * 0.85, where).toBeGreaterThanOrEqual(-0.5);
            expect(y + size * 0.3, where).toBeLessThanOrEqual(L.vh + 0.5);
          }
        }
      }
    });
  }
});

describe('the pointer finds the value in every type', () => {
  const setup = (c: ChartData, kind: ChartKind, pose: Pose = PRESET) => {
    const L = layout2D(c, kind);
    const m = morph(poseToT(pose));
    const scene = buildScene(L, m);
    const po = paintOrder(scene, camera(scene, pose, m));
    return { L, scene, cam: po.cam, order: po.eyeAbove ? [...po.below, ...po.above] : [...po.above, ...po.below] };
  };

  it('donut: each wedge, and nothing in the hole', () => {
    const { L, scene, cam, order } = setup(stagesTile, 'donut');
    for (const w of L.donut!.wedges) {
      const pr = scene.prisms.find((p) => p.datum === w.datum)!;
      const mid = (w.a0 + w.a1) / 2;
      const r = (L.donut!.r0 + L.donut!.r1) / 2;
      const pt = cam.project([L.donut!.cx + r * Math.sin(mid), L.vh - L.donut!.cy + r * Math.cos(mid), pr.z1]); // world y is up
      expect(hitTest(order, cam, pt)).toBe(w.datum);
    }
    const hole = cam.project([L.donut!.cx, L.vh - L.donut!.cy, scene.prisms[0]!.z1]);
    expect(hitTest(order, cam, hole)).toBe(-1);
  });

  it('line and area: the marker under the pointer', () => {
    for (const kind of ['line', 'area'] as const) {
      const { L, scene, cam, order } = setup(stagesTile, kind);
      for (const p of L.points) {
        const dot = scene.prisms.flatMap((x) => x.dots).find((d) => d.datum === p.datum)!;
        expect(hitTest(order, cam, cam.project(dot.c))).toBe(p.datum);
      }
    }
  });

  it("a line with two series: each series' marker, even where the nearer line passes close by", () => {
    const owners = (cats: string[], a: number[], b: number[]): ChartData =>
      regions({
        categoryName: 'Stage',
        categories: cats.map((c) => ({ key: c, label: c })),
        series: ['Priya Nair', 'Owen Park'],
        data: cats.flatMap((c, i) => [
          { category: c, series: 0, value: a[i]!, display: `$${a[i]}` },
          { category: c, series: 1, value: b[i]!, display: `$${b[i]}` },
        ]),
        ordered: true,
      });
    const two = owners(['Prospecting', 'Engaging'], [120000, 40000], [95000, 60000]);
    const four = owners(['Prospecting', 'Engaging', 'Won', 'Lost'], [120000, 40000, 80000, 20000], [95000, 60000, 70000, 30000]);
    for (const [c, pose] of [[two, PRESET], [four, PRESET], [four, { yaw: -20, tilt: 20 }], [four, { yaw: 0, tilt: 30 }]] as [ChartData, Pose][]) {
      const { scene, cam, order } = setup(c, 'line', pose);
      for (const d of scene.prisms.flatMap((p) => p.dots)) expect(hitTest(order, cam, cam.project(d.c)), `${d.datum} at ${pose.yaw},${pose.tilt}`).toBe(d.datum);
    }
  });

  it('heatmap: the tower under the pointer, or the taller one in front of it, at every lean of the board', () => {
    for (const pose of [PRESET, { yaw: 0, tilt: 62 }, { yaw: 40, tilt: 10 }]) {
      const { scene, cam, order } = setup(twoDims, 'heatmap', pose);
      const rank = new Map(order.map((b, i) => [b.datum, i]));
      const cells = scene.boxes.filter((x) => x.role === 'cell');
      let own = 0;
      for (const b of cells) {
        const top = cam.project([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z1]);
        const got = hitTest(order, cam, top);
        const where = `${b.datum} at ${pose.yaw},${pose.tilt}`;
        expect(got, where).toBeGreaterThanOrEqual(0);
        if (got === b.datum) own++;
        else expect(rank.get(got)!, where).toBeGreaterThan(rank.get(b.datum)!); // a nearer tower covers this top
      }
      expect(own).toBeGreaterThan(0);
    }
  });

  it('bullet: the bar inside the case wins; the empty part of the case is the target', () => {
    const { scene, cam, order } = setup(pipelineVsQuota, 'bullet');
    for (const c of scene.boxes.filter((b) => b.role === 'case' && b.inner)) {
      const f = c.inner!;
      const inBar = cam.project([(f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2, f.z1]);
      expect(hitTest(order, cam, inBar)).toBe(f.datum);
      if (c.y1 - f.y1 > 8) {
        const above = cam.project([(c.x0 + c.x1) / 2, (f.y1 + c.y1) / 2, c.z1]);
        expect(hitTest(order, cam, above)).toBe(c.datum);
      }
    }
  });

  it('lollipop: the dot and the stem', () => {
    const { scene, cam, order } = setup(regions(), 'lollipop');
    for (const b of scene.boxes.filter((x) => x.cap)) expect(hitTest(order, cam, cam.project(b.cap!.c))).toBe(b.datum);
  });

  it('marks of every type are prisms or boxes, never both for one value', () => {
    for (const [, c, kind] of CASES) {
      const L = layout2D(c, kind);
      const scene = buildScene(L, morph(1));
      const boxData = new Set(scene.boxes.map((b) => b.datum));
      for (const p of scene.prisms.filter((x) => x.datum >= 0)) expect(boxData.has(p.datum)).toBe(false);
      expect(scene.prisms.every(isPrism)).toBe(true);
    }
  });
});

/** A 2D context that records what is drawn, enough for drawFrame. */
type Op = { op: 'fill' | 'stroke' | 'text'; path: (string | number)[][]; style: unknown; width: number; dash: number[]; text?: string };
function recorder(log: Op[]) {
  const st: Record<string, unknown> = { lineWidth: 1, strokeStyle: '#000', fillStyle: '#000', globalAlpha: 1, font: '', textAlign: 'start', textBaseline: 'alphabetic', globalCompositeOperation: 'source-over', lineJoin: 'miter', lineCap: 'butt', imageSmoothingEnabled: true, imageSmoothingQuality: 'low', filter: 'none' };
  let dash: number[] = [];
  let path: (string | number)[][] = [];
  const stack: Record<string, unknown>[] = [];
  const gradient = () => ({ addColorStop() {} });
  const rec = (op: Op['op'], text?: string) => log.push({ op, path: path.slice(), style: op === 'stroke' ? st.strokeStyle : st.fillStyle, width: st.lineWidth as number, dash: [...dash], text });
  const ctx: Record<string, unknown> = {
    setTransform() {}, clearRect() {}, fillRect() {}, drawImage() {}, clip() {}, translate() {}, scale() {},
    createLinearGradient: gradient, createRadialGradient: gradient,
    beginPath: () => { path = []; },
    moveTo: (x: number, y: number) => path.push(['M', x, y]),
    lineTo: (x: number, y: number) => path.push(['L', x, y]),
    arcTo: (...a: number[]) => path.push(['A', ...a]),
    arc: (...a: number[]) => path.push(['C', ...a]),
    roundRect: (...a: number[]) => path.push(['R', ...a]),
    closePath: () => path.push(['Z']),
    fill: () => rec('fill'),
    stroke: () => rec('stroke'),
    fillText: (t: string) => rec('text', t),
    measureText: (t: string) => ({ width: t.length * CHAR_W }),
    setLineDash: (d: number[]) => { dash = d; },
    save: () => stack.push({ ...st, dash }),
    restore: () => { const s = stack.pop(); if (s) { dash = s.dash as number[]; Object.assign(st, s); } },
  };
  for (const k of Object.keys(st)) Object.defineProperty(ctx, k, { get: () => st[k], set: (v) => { st[k] = v; } });
  const canvas = { width: 840, height: 600, getContext: () => ctx };
  ctx.canvas = canvas;
  return { ctx: ctx as unknown as CanvasRenderingContext2D, canvas: canvas as unknown as HTMLCanvasElement };
}

function draw(c: ChartData, kind: ChartKind, pose: Pose = { yaw: 0, tilt: 0 }) {
  const L = layout2D(c, kind);
  const m = morph(poseToT(pose));
  const scene = buildScene(L, m);
  const log: Op[] = [];
  const main = recorder(log);
  drawFrame(main.ctx, scene, L, camera(scene, pose, m), m, { unit: 1.5, dpr: 1, hover: -1, font: 'x', quality: 0 }, { layer: main.canvas, mips: [0, 1, 2].map(() => recorder([]).canvas) });
  return { L, scene, log };
}

describe('the canvas picks up exactly where the flat chart leaves off', () => {
  it("a bullet's case is open at the baseline, below the columns and left of the bars, with the flat outline's width", () => {
    for (const [c, form] of [[pipelineVsQuota, 'columns'], [ownersByStage, 'rows']] as const) {
      const { L, log } = draw(c, 'bullet');
      expect(L.form).toBe(form);
      const cases = L.bars.filter((b) => b.role === 'case');
      // The outline is the one 1.5-unit stroke of three edges: top for both, and then the far sides.
      const outlines = log.filter((o) => o.op === 'stroke' && near(o.width, 1.5) && o.path.length === 4);
      expect(outlines).toHaveLength(cases.length);
      for (const o of outlines) {
        const pts = o.path.map((q) => [q[1] as number, q[2] as number]);
        const xs = pts.map((p) => p[0]!);
        const ys = pts.map((p) => p[1]!);
        const left = Math.min(...xs);
        const bottom = Math.max(...ys);
        const edges = pts.slice(1).map((p, i) => [pts[i]!, p]);
        const onBaseline = edges.some(([a, b]) => (form === 'columns' ? near(a![1]!, bottom) && near(b![1]!, bottom) : near(a![0]!, left) && near(b![0]!, left)));
        expect(onBaseline, JSON.stringify(pts)).toBe(false);
      }
    }
  });

  it("a heatmap's empty cells stay rounded and plain at the hand-off, and their 'n/a' keeps its ink", () => {
    const { log, scene } = draw(twoDims, 'heatmap', { yaw: 0.3, tilt: 0 });
    const empties = scene.board!.empty.length;
    const pale = log.filter((o) => o.op === 'fill' && o.style === 'rgba(241,242,245,1)');
    expect(pale).toHaveLength(empties);
    for (const f of pale) expect(f.path.filter((q) => q[0] === 'A')).toHaveLength(4);
    expect(log.some((o) => o.op === 'stroke' && o.dash.length > 0)).toBe(false);
    for (const t of log.filter((o) => o.op === 'text' && (o.text === 'n/a' || o.text === '—'))) expect(t.style).toBe(TOKENS.chrome);
    expect(scene.labels.filter((l) => l.kind === 'na').every((l) => l.ink === 'dark')).toBe(true);
  });

  it('heatmap towers in 3D are brighter the larger the value', () => {
    const scene = buildScene(layout2D(twoDims, 'heatmap'), morph(1));
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) * 0.3 + parseInt(hex.slice(3, 5), 16) * 0.59 + parseInt(hex.slice(5, 7), 16) * 0.11;
    const value = (datum: number) => twoDims.data[datum]!.value!;
    const towers = [...scene.boxes].sort((a, b) => value(a.datum) - value(b.datum));
    for (let i = 1; i < towers.length; i++) expect(lum(towers[i]!.tone!.core)).toBeGreaterThanOrEqual(lum(towers[i - 1]!.tone!.core));
    expect(lum(towers[towers.length - 1]!.tone!.core)).toBeGreaterThan(lum(towers[0]!.tone!.core));
  });
});
