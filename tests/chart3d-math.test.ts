// Graphs that turn 3D: the pure math (app/chart3d-math.ts). The flat pose must be the 2D chart exactly, the bars
// must stay honest at every angle, and the paint order must be right wherever two bars cover each other.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildScene,
  camera,
  chooseForm,
  coastStep,
  compact,
  contrast,
  hasNarrow,
  hitTest,
  layout2D,
  LIMITS,
  MAX_RELEASE,
  mix,
  morph,
  niceTicks,
  paintOrder,
  poseToT,
  releaseVelocity,
  rubberBand,
  SERIES_TONES,
  springStep,
  TOKENS,
  unRubberBand,
  type Box,
  type ChartData,
  type Pose,
  type V3,
} from '../app/chart3d-math';

const chart = (over: Partial<ChartData> = {}): ChartData => ({
  id: 't',
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
  ...over,
});

const coverage = chart({
  unit: 'ratio',
  target: { value: 1, label: '1.00x = quota' },
  axisFloor: 1.25,
  data: [
    { category: 'central', series: 0, value: 0.76, display: '0.76x' },
    { category: 'east', series: 0, value: null, display: 'n/a' },
    { category: 'west', series: 0, value: 1.31, display: '1.31x' },
  ],
});

const grouped = chart({
  series: ['Pipeline', 'Quota'],
  data: [
    { category: 'central', series: 0, value: 762599, display: '$762,599' },
    { category: 'central', series: 1, value: 1003000, display: '$1,003,000' },
    { category: 'east', series: 0, value: 394634, display: '$394,634' },
    { category: 'east', series: 1, value: 926000, display: '$926,000' },
    { category: 'west', series: 0, value: 806676, display: '$806,676' },
    { category: 'west', series: 1, value: null, display: 'No quota' },
  ],
});

const owners = (n: number): ChartData =>
  chart({
    form: 'rows',
    categoryName: 'Owner',
    categories: Array.from({ length: n }, (_, i) => ({ key: `o${i}`, label: `Owner number ${i}` })),
    data: Array.from({ length: n }, (_, i) => ({ category: `o${i}`, series: 0, value: (n - i) * 1000 + 17, display: `$${(n - i) * 1000 + 17}` })),
  });

const SCENES: [string, ChartData][] = [
  ['columns', chart()],
  ['coverage with target and n/a', coverage],
  ['grouped', grouped],
  ['35 owner rows', owners(35)],
  ['tile', chart({ size: 'tile', categories: [{ key: 'a', label: 'Engaging' }], data: [{ category: 'a', series: 0, value: 3892229, display: '$3,892,229' }] })],
];

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

describe('flat pose is the 2D chart exactly', () => {
  for (const [name, c] of SCENES) {
    it(`${name}: every bar's front face and every label land on the flat layout`, () => {
      const L = layout2D(c);
      const m = morph(0);
      const scene = buildScene(L, m);
      const cam = camera(scene, { yaw: 0, tilt: 0 }, m);
      for (const bar of L.bars) {
        const parts = scene.boxes.filter((b) => b.datum === bar.datum);
        const x0 = Math.min(...parts.map((b) => cam.project([b.x0, b.y0, b.z1])[0]));
        const x1 = Math.max(...parts.map((b) => cam.project([b.x1, b.y1, b.z1])[0]));
        const yTop = Math.min(...parts.map((b) => cam.project([b.x0, b.y1, b.z1])[1]));
        const yBot = Math.max(...parts.map((b) => cam.project([b.x0, b.y0, b.z1])[1]));
        expect(near(x0, bar.x)).toBe(true);
        expect(near(x1, bar.x + (L.form === 'rows' ? Math.max(bar.w, 1) : bar.w))).toBe(true);
        expect(near(yTop, bar.y)).toBe(true);
        expect(near(yBot, bar.y + bar.h)).toBe(true);
        for (const b of parts) expect(b.z1 - b.z0).toBe(0); // no depth when flat
      }
      for (const l of scene.labels) {
        const [x, y] = cam.project(l.p);
        const flat =
          l.kind === 'value'
            ? L.bars.find((b) => b.datum === l.datum)!
            : l.kind === 'na'
              ? L.ghosts.find((g) => g.datum === l.datum)!
              : null;
        if (flat) {
          expect(near(x + l.dx, flat.tx)).toBe(true);
          expect(near(y + l.dy, flat.ty)).toBe(true);
        }
      }
      const cats = scene.labels.filter((l) => l.kind === 'category').map((l) => cam.project(l.p).map((v, i) => v + (i ? l.dy : l.dx)));
      cats.forEach(([x, y], i) => {
        expect(near(x!, L.cats[i]!.x)).toBe(true);
        expect(near(y!, L.cats[i]!.y)).toBe(true);
      });
      if (L.target) expect(near(cam.project([L.plot.x0, scene.target!.y, 0])[1], L.target.pos)).toBe(true);
    });
  }

  it('a barely turned chart is still within a fraction of a pixel of the flat one', () => {
    const L = layout2D(chart());
    const pose = { yaw: 0.02, tilt: 0 };
    const m = morph(poseToT(pose));
    const scene = buildScene(L, m);
    const cam = camera(scene, pose, m);
    for (const bar of L.bars) {
      const b = scene.boxes.find((x) => x.datum === bar.datum)!;
      const [x, y] = cam.project([b.x0, b.y1, b.z1]);
      expect(Math.abs(x - bar.x)).toBeLessThan(0.5);
      expect(Math.abs(y - bar.y)).toBeLessThan(0.5);
    }
  });
});

describe('how 3D a pose is', () => {
  it('is 0 flat, 1 at 35 degrees of turn or 30 of tilt, and grows along every ray', () => {
    expect(poseToT({ yaw: 0, tilt: 0 })).toBe(0);
    expect(poseToT({ yaw: 35, tilt: 0 })).toBe(1);
    expect(poseToT({ yaw: -35, tilt: 0 })).toBe(1);
    expect(poseToT({ yaw: 0, tilt: 30 })).toBe(1);
    for (const [dy, dt] of [[1, 0], [0, 1], [-1, 1], [0.7, 0.3]] as const) {
      let prev = -1;
      for (let s = 0; s <= 60; s++) {
        const t = poseToT({ yaw: dy * s, tilt: dt * s });
        expect(t).toBeGreaterThanOrEqual(prev);
        expect(t).toBeLessThanOrEqual(1);
        prev = t;
      }
    }
  });

  it('flat has no depth, stage, glass, floor or glow; full 3D has all of them', () => {
    const z = morph(0);
    expect([z.e, z.stage, z.glass, z.floor, z.glow, z.group, z.fit, z.chips]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(z.dark).toBe(false);
    const o = morph(1);
    expect([o.e, o.stage, o.glass, o.floor, o.glow, o.group, o.fit, o.chips]).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(o.dark).toBe(true);
  });

  it('never glows on a light backdrop', () => {
    for (let t = 0; t <= 1; t += 0.001) {
      const m = morph(t);
      if (m.stage < 0.5) expect(m.glow).toBe(0);
    }
  });
});

describe('honest bars at every angle', () => {
  it('the value axis starts at 0 and bar lengths are proportional to the values', () => {
    for (const c of [chart(), coverage, owners(12)]) {
      const L = layout2D(c);
      expect(L.ticks[0]!.value).toBe(0);
      const [a, b] = L.bars as [(typeof L.bars)[0], (typeof L.bars)[0]];
      const len = (x: typeof a) => (L.form === 'rows' ? x.w : x.h);
      expect(len(a) / len(b)).toBeCloseTo(a.value / b.value, 9);
    }
  });

  it('every bar of a series gets the same depth: the extrusion carries no data', () => {
    for (const t of [0.3, 0.7, 1]) {
      const scene = buildScene(layout2D(chart()), morph(t));
      const depths = new Set(scene.boxes.map((b) => (b.z1 - b.z0).toFixed(9)));
      expect(depths.size).toBe(1);
    }
  });

  it('a missing value is "n/a" with no height, never a bar; a real zero is a zero-height bar', () => {
    const L = layout2D(coverage);
    expect(L.bars.map((b) => b.datum)).toEqual([0, 2]);
    expect(L.ghosts).toHaveLength(1);
    expect(L.ghosts[0]!.text).toBe('n/a');
    const scene = buildScene(L, morph(1));
    for (const g of scene.ghosts) expect(g.y1 - g.y0).toBe(0);
    const zero = layout2D(chart({ data: [{ category: 'central', series: 0, value: 0, display: '$0' }, { category: 'east', series: 0, value: 5, display: '$5' }] }));
    expect(zero.bars.find((b) => b.datum === 0)!.h).toBe(0);
  });

  it('a bar cut at the target plane keeps its full height', () => {
    const scene = buildScene(layout2D(coverage), morph(1));
    const west = scene.boxes.filter((b) => b.datum === 2);
    expect(west.map((b) => b.part).sort()).toEqual(['above', 'below']);
    const whole = layout2D(coverage).bars.find((b) => b.datum === 2)!.h;
    expect(west.reduce((s, b) => s + (b.y1 - b.y0), 0)).toBeCloseTo(whole, 9);
    expect(west.find((b) => b.part === 'below')!.y1).toBeCloseTo(scene.target!.y, 9);
  });

  it('grouped bars sit side by side when flat, then slide into rows in depth without ever passing through each other', () => {
    const flat = layout2D(grouped);
    const byCat = new Map<number, typeof flat.bars>();
    for (const b of flat.bars) byCat.set(b.cat, [...(byCat.get(b.cat) ?? []), b]);
    for (const bars of byCat.values()) {
      if (bars.length < 2) continue; // West's quota is missing: one bar and an "n/a"
      const [a, b] = bars.sort((x, y) => x.series - y.series) as [(typeof bars)[0], (typeof bars)[0]];
      expect(a.x + a.w).toBeLessThanOrEqual(b.x);
    }
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const boxes = buildScene(flat, morph(Math.min(1, t))).boxes;
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          const overlap = a.x0 < b.x1 - 1e-9 && b.x0 < a.x1 - 1e-9 && a.z0 < b.z1 - 1e-9 && b.z0 < a.z1 - 1e-9 && a.y0 < b.y1 - 1e-9 && b.y0 < a.y1 - 1e-9;
          expect(overlap).toBe(false);
        }
    }
    const full = buildScene(flat, morph(1)).boxes;
    const central = full.filter((b) => b.datum <= 1);
    expect((central[0]!.x0 + central[0]!.x1) / 2).toBeCloseTo((central[1]!.x0 + central[1]!.x1) / 2, 9);
    expect(central[0]!.z0).toBeGreaterThan(central[1]!.z1);
  });
});

describe('labels and axes', () => {
  it('nice ticks', () => {
    expect(niceTicks(1.37, 'ratio')).toEqual([0, 0.5, 1, 1.5]);
    expect(niceTicks(1.25, 'ratio')).toEqual([0, 0.5, 1, 1.5]);
    expect(niceTicks(1234567, 'currency')).toEqual([0, 500000, 1000000, 1500000]);
    expect(niceTicks(2, 'count')).toEqual([0, 1, 2]);
    expect(niceTicks(0, 'count')).toEqual([0, 1]);
    expect(niceTicks(2089, 'count')).toEqual([0, 1000, 2000, 3000]);
    expect(niceTicks(219, 'count')).toEqual([0, 100, 200, 300]);
    for (const m of [0.3, 7, 99, 1e3, 3.3e6, 4966215]) {
      const t = niceTicks(m, 'currency');
      expect(t[t.length - 1]!).toBeGreaterThanOrEqual(m);
      expect(t.length).toBeLessThanOrEqual(7);
    }
    // Small dollar amounts take whole steps, so no two tick labels read the same and none claims a value it isn't.
    expect(niceTicks(0, 'currency')).toEqual([0, 1]);
    for (const m of [0, 0.4, 1.5, 3, 7, 12, 39, 41, 99]) {
      const t = niceTicks(m, 'currency');
      const texts = t.map((v) => compact(v, 'currency'));
      expect(new Set(texts).size, `${m}: ${texts}`).toBe(texts.length);
      for (const v of t) expect(Number.isInteger(v), `${m}: ${t}`).toBe(true);
    }
  });

  it("the target line's label never covers a bar or a value label, wherever the values fall", () => {
    const box = (text: string, x: number, y: number, anchor: string) => {
      const w = text.length * 6.7;
      const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
      return { x0, y0: y - 10.2, x1: x0 + w, y1: y + 3.6 };
    };
    const hit = (a: { x0: number; y0: number; x1: number; y1: number }, b: typeof a) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    for (const last of [0.4, 0.9, 0.98, 1, 1.02, 1.11, 1.3]) {
      for (const first of [0.76, 0.98, 1.05]) {
        for (const narrow of [false, true]) {
          const L = layout2D(
            chart({
              ...coverage,
              size: 'card',
              data: [
                { category: 'central', series: 0, value: first, display: `${first.toFixed(2)}x` },
                { category: 'east', series: 0, value: 0.43, display: '0.43x' },
                { category: 'west', series: 0, value: last, display: `${last.toFixed(2)}x` },
              ],
            }),
            undefined,
            narrow,
          );
          const t = L.target!;
          const label = box(t.text, t.x, t.ty, t.anchor);
          for (const b of L.bars) {
            expect(hit(label, { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h }), `bar ${b.cat} at ${first}/${last}`).toBe(false);
            expect(hit(label, box(b.text, b.tx, b.ty, b.anchor)), `value ${b.cat} at ${first}/${last}`).toBe(false);
          }
        }
      }
    }
  });

  it('phones get a narrower layout for wide charts, so text is not shrunk to half size', () => {
    expect(hasNarrow(chart())).toBe(true);
    expect(hasNarrow(chart({ size: 'tile' }))).toBe(false);
    expect(hasNarrow(owners(5))).toBe(true);
    expect(layout2D(chart(), undefined, true).vw).toBe(340);
    expect(layout2D(owners(5), undefined, true).vw).toBe(360);
    // The narrow layout draws the same data: same bars, values and order.
    const wide = layout2D(coverage);
    const narrow = layout2D(coverage, undefined, true);
    expect(narrow.bars.map((b) => [b.datum, b.value, b.h])).toEqual(wide.bars.map((b) => [b.datum, b.value, b.h]));
    expect(narrow.ghosts.map((g) => g.datum)).toEqual(wide.ghosts.map((g) => g.datum));
  });

  it('short values are written by hand, the same on the server and in every browser', () => {
    expect(compact(0, 'currency')).toBe('$0');
    expect(compact(950, 'currency')).toBe('$950');
    expect(compact(762599, 'currency')).toBe('$763K');
    expect(compact(1963909, 'currency')).toBe('$1.96M');
    expect(compact(1500000, 'currency')).toBe('$1.5M');
    expect(compact(999999, 'currency')).toBe('$1M');
    expect(compact(2089, 'count')).toBe('2,089');
    expect(compact(12500, 'count')).toBe('12.5K');
    expect(compact(0.5, 'ratio')).toBe('0.50x');
    const src = readFileSync('app/chart3d-math.ts', 'utf8').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/Intl\.|toLocaleString|Date\.|new Date|Math\.random/);
  });

  it('owners, long labels and long lists get horizontal rows; short lists get columns', () => {
    expect(chooseForm(chart())).toBe('columns');
    expect(chooseForm(owners(5))).toBe('rows');
    expect(chooseForm(chart({ categories: [{ key: 'a', label: 'A very long category name' }], data: [] }))).toBe('rows');
    expect(chooseForm(chart({ categories: Array.from({ length: 13 }, (_, i) => ({ key: `${i}`, label: `${i}` })), data: [] }))).toBe('rows');
  });

  it('labels stay readable on their chips at every step between the white card and the dark stage', () => {
    // Backdrop at stage s: the white card mixed toward the stage's darkest tone. Chips are drawn over it.
    for (let s = 0.2; s <= 1; s += 0.05) {
      const m = morph(0);
      const dark = s >= 0.55;
      const backdrop = mix(TOKENS.white, TOKENS.stageTop, s);
      const chipAlpha = 1; // chips are fully in by stage 0.2
      const chip = dark ? mix(backdrop, TOKENS.stageTop, 0.72 * chipAlpha) : mix(backdrop, TOKENS.white, 0.85 * chipAlpha);
      const texts = dark ? [TOKENS.chromeFg, TOKENS.white, TOKENS.stageMuted] : [TOKENS.chrome, TOKENS.muted];
      for (const t of texts) expect(contrast(t, chip)).toBeGreaterThanOrEqual(4.5);
      expect(m.t).toBe(0);
    }
  });

  it('chart colours are PANW tokens or mixes of them, and the drawing code has no colour literals of its own', () => {
    const allowed = new Set<string>(Object.values(TOKENS));
    const isMix = (c: string) => {
      for (const a of allowed) for (const b of allowed) for (let p = 0; p <= 1.0001; p += 0.05) if (mix(a, b, p) === c) return true;
      return false;
    };
    for (const tone of SERIES_TONES) for (const c of [tone.flat, tone.hover, tone.core, tone.rim, tone.shade, tone.cap, tone.edge]) expect(allowed.has(c) || isMix(c)).toBe(true);
    const draw = readFileSync('app/chart3d-draw.ts', 'utf8').replace(/\/\/.*$/gm, '');
    expect(draw).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|hsla?\(/);
  });
});

// ---------------------------------------------------------------- paint order, checked by casting rays

const rad = (d: number) => (d * Math.PI) / 180;

/** Distance along the ray from the eye to where it enters the box, or null. */
function enter(eye: V3, dir: V3, b: Box): number | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  const lo = [b.x0, b.y0, b.z0];
  const hi = [b.x1, b.y1, b.z1];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(dir[k]!) < 1e-12) {
      if (eye[k]! < lo[k]! || eye[k]! > hi[k]!) return null;
      continue;
    }
    const a = (lo[k]! - eye[k]!) / dir[k]!;
    const c = (hi[k]! - eye[k]!) / dir[k]!;
    t0 = Math.max(t0, Math.min(a, c));
    t1 = Math.min(t1, Math.max(a, c));
  }
  return t0 <= t1 && t1 > 0 ? t0 : null;
}

describe('paint order', () => {
  const poses: Pose[] = [];
  for (let yaw = -50; yaw <= 50; yaw += 10) for (let tilt = 0; tilt <= 62; tilt += 8) poses.push({ yaw, tilt });

  for (const [name, c] of SCENES) {
    it(`${name}: wherever two bars cover the same point, the nearer one is painted later`, () => {
      const L = layout2D(c);
      for (const pose of poses) {
        const m = morph(poseToT(pose));
        if (m.t < 0.05) continue;
        const scene = buildScene(L, m);
        const cam = camera(scene, pose, m);
        const { below, above, eyeAbove } = paintOrder(scene, cam);
        const order = eyeAbove ? [...below, ...above] : [...above, ...below];
        const rank = new Map(order.map((b, i) => [b, i]));
        // Rays from the eye through a grid of points on the pivot's plane (view space z = 0), turned into world space.
        const [ct, st, cp, sp] = [Math.cos(rad(pose.yaw)), Math.sin(rad(pose.yaw)), Math.cos(rad(pose.tilt)), Math.sin(rad(pose.tilt))];
        const toWorld = (u: number, v: number): V3 => {
          // Undo Rx(tilt) then Ry(yaw) for the view-space point (u, v, 0).
          const y1 = v * cp;
          const z1 = -v * sp;
          return [scene.pivot[0] + u * ct - z1 * st, scene.pivot[1] + y1, scene.pivot[2] + u * st + z1 * ct];
        };
        const R = scene.radius * 1.2;
        for (let u = -R; u <= R; u += R / 24)
          for (let v = -R; v <= R; v += R / 24) {
            const p = toWorld(u, v);
            const dir: V3 = [p[0] - cam.eye[0], p[1] - cam.eye[1], p[2] - cam.eye[2]];
            const hits = order.map((b) => ({ b, t: enter(cam.eye, dir, b) })).filter((h): h is { b: Box; t: number } => h.t !== null);
            for (const a of hits)
              for (const b of hits) if (a.t < b.t - 1e-6) expect(rank.get(a.b)!).toBeGreaterThan(rank.get(b.b)!);
          }
      }
    });
  }

  it('hit testing finds the bar under a point and nothing on the empty floor', () => {
    const L = layout2D(chart());
    const pose = { yaw: -30, tilt: 24 };
    const m = morph(poseToT(pose));
    const scene = buildScene(L, m);
    const cam = camera(scene, pose, m);
    const { below } = paintOrder(scene, cam);
    for (const b of scene.boxes) {
      const front = cam.project([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z1]);
      expect(hitTest(below, cam, front)).toBe(b.datum);
    }
    expect(hitTest(below, cam, [2, 2])).toBe(-1);
  });
});

describe('turned charts keep every label on stage', () => {
  for (const [name, c] of [...SCENES, ['narrow coverage', coverage] as [string, ChartData]]) {
    it(name, () => {
      const L = layout2D(c, undefined, name.startsWith('narrow'));
      for (const pose of [
        { yaw: 0, tilt: 30 },
        { yaw: 0, tilt: 62 },
        { yaw: -50, tilt: 62 },
        { yaw: 50, tilt: 62 },
        { yaw: -50, tilt: 0 },
        { yaw: 50, tilt: 10 },
        { yaw: -30, tilt: 24 },
      ]) {
        const m = morph(poseToT(pose));
        expect(m.fit).toBe(1);
        const scene = buildScene(L, m);
        const cam = camera(scene, pose, m);
        for (const l of scene.labels) {
          // The chip drawFrame puts behind the label (text measured at 6.7 units a character).
          const [ax, ay] = cam.project(l.p);
          const size = l.kind === 'tick' ? 11 : 12;
          const w = l.text.length * 6.7 * (size / 12);
          const x = ax + l.dx;
          const y = ay + l.dy;
          const x0 = l.anchor === 'middle' ? x - w / 2 : l.anchor === 'end' ? x - w : x;
          const where = `${l.kind} "${l.text}" at yaw ${pose.yaw} tilt ${pose.tilt}`;
          expect(x0 - 3, where).toBeGreaterThanOrEqual(0);
          expect(x0 + w + 3, where).toBeLessThanOrEqual(L.vw);
          expect(y - size * 0.85, where).toBeGreaterThanOrEqual(0);
          expect(y + size * 0.3, where).toBeLessThanOrEqual(L.vh);
        }
      }
    });
  }
});

describe('hit testing near edges', () => {
  it("a bar's own outline always wins over a neighbour's few units of slack", () => {
    for (const c of [owners(8), grouped]) {
      const L = layout2D(c);
      const pose = { yaw: -30, tilt: 24 };
      const m = morph(poseToT(pose));
      const scene = buildScene(L, m);
      const cam = camera(scene, pose, m);
      const { below, above, eyeAbove } = paintOrder(scene, cam);
      const order = eyeAbove ? [...below, ...above] : [...above, ...below];
      let checked = 0;
      for (let x = 0; x < L.vw; x += 1.5)
        for (let y = 0; y < L.vh; y += 1.5) {
          const exact = hitTest(order, cam, [x, y], 0);
          if (exact < 0) continue;
          checked++;
          expect(hitTest(order, cam, [x, y]), `${x},${y}`).toBe(exact);
        }
      expect(checked).toBeGreaterThan(100);
    }
  });
});

describe('drag physics', () => {
  it('a click with a wobble does not fling the graphs; a real flick is capped', () => {
    const at = (ms: number, yaw: number, tilt = 0) => ({ at: ms, yaw, tilt });
    // The 4px threshold move and the release a moment later: microseconds apart, so no speed can be measured.
    expect(releaseVelocity(at(1000, 0), at(1000.1, 2))).toBeNull();
    expect(releaseVelocity(at(1000, 0), at(1020, 9))).toBeNull();
    expect(releaseVelocity(at(1000, 0), at(1000, 0))).toBeNull();
    const v = releaseVelocity(at(1000, 0, 0), at(1050, 10, -5))!;
    expect(v.yaw).toBeCloseTo(200, 9);
    expect(v.tilt).toBeCloseTo(-100, 9);
    const fast = releaseVelocity(at(1000, 0, 0), at(1040, 80, -80))!;
    expect(fast).toEqual({ yaw: MAX_RELEASE, tilt: -MAX_RELEASE });
  });

  it('grabbing a chart past a limit starts the hand exactly where the rubber band put it', () => {
    for (const p of [-62, -55.5, -50, -20, 0, 33, 50, 51, 58, 61.9]) expect(rubberBand(unRubberBand(p, -50, 50), -50, 50)).toBeCloseTo(p, 5);
    for (const p of [-11.9, -3, 0, 40, 62, 70, 73.9]) expect(rubberBand(unRubberBand(p, 0, 62), 0, 62)).toBeCloseTo(p, 5);
  });

  it('past a limit the pose follows at 30%, never more than 12 degrees beyond', () => {
    expect(rubberBand(20, -50, 50)).toBe(20);
    expect(rubberBand(60, -50, 50)).toBeCloseTo(53, 9);
    expect(rubberBand(500, -50, 50)).toBe(50 + LIMITS.over);
    expect(rubberBand(-500, 0, 62)).toBe(-LIMITS.over);
  });

  it('springs settle on the target without overshooting from rest; coasting stops', () => {
    for (const omega of [12, 18]) {
      let x = 30;
      let v = 0;
      for (let i = 0; i < 120; i++) {
        [x, v] = springStep(x, v, 0, omega, 1 / 60);
        expect(x).toBeGreaterThanOrEqual(-1e-9);
      }
      expect(Math.abs(x)).toBeLessThan(0.02);
    }
    let x = 0;
    let v = 200;
    let steps = 0;
    while (Math.abs(v) >= 3 && steps < 1000) {
      [x, v] = coastStep(x, v, 1 / 60);
      steps++;
    }
    expect(steps / 60).toBeLessThan(1.5);
    expect(x).toBeCloseTo(200 * 0.25 * (1 - Math.exp(-steps / 60 / 0.25)), 6);
  });
});
