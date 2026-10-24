// Draws one frame of a turned chart on a canvas: the dark stage, grid floor, back glass panel, glass marks in paint
// order (bars, a donut's ring, a line's ribbon, an area's slab, a heatmap's towers), the target plane, a bloom built
// from a downsample chain (no ctx.filter or shadowBlur, so it looks the same in every browser), and labels on backing
// chips so they stay readable at every angle. Colours come only from chart3d-math (PANW tokens and their mixes).
// Shared byte-for-byte by both apps.
import {
  dotRadius,
  isPrism,
  labelSize,
  localCamera,
  mix,
  paintOrder,
  rgba,
  SERIES_TONES,
  TOKENS as T,
  type Box,
  type Camera,
  type Dot,
  type Layout,
  type Mark,
  type Morph,
  type Prism,
  type Scene,
  type SeriesTone,
  type V3,
} from './chart3d-math';

export interface DrawOptions {
  unit: number; // CSS pixels per viewBox unit
  dpr: number;
  hover: number; // datum under the pointer, or -1
  font: string; // font family of the page
  quality: 0 | 1 | 2; // 0 full; 1 drops light pools and reflections; 2 also drops the bloom
}

/** Offscreen buffers, owned by one chart and reused every frame. */
export interface Scratch {
  layer: HTMLCanvasElement; // the marks alone, the source of the bloom
  mips: HTMLCanvasElement[]; // 1/4, 1/8 and 1/16 of the layer
}

export function makeScratch(): Scratch {
  return { layer: document.createElement('canvas'), mips: [document.createElement('canvas'), document.createElement('canvas'), document.createElement('canvas')] };
}

function fitScratch(s: Scratch, w: number, h: number) {
  if (s.layer.width !== w || s.layer.height !== h) {
    s.layer.width = w;
    s.layer.height = h;
    s.mips.forEach((c, i) => {
      const f = 4 << i;
      c.width = Math.max(1, Math.ceil(w / f));
      c.height = Math.max(1, Math.ceil(h / f));
    });
  }
}

/** Frees the buffers' memory while the chart is flat. */
export function releaseScratch(s: Scratch) {
  for (const c of [s.layer, ...s.mips]) {
    c.width = 0;
    c.height = 0;
  }
}

const LIGHT: V3 = (() => {
  const v: V3 = [-0.45, 0.75, 0.48];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
})();

// Box corner i has x1 if bit 1, y1 if bit 2, z1 if bit 4. Faces as corner loops with their outward normals.
const FACES: { loop: [number, number, number, number]; n: V3; front?: boolean }[] = [
  { loop: [4, 5, 7, 6], n: [0, 0, 1], front: true },
  { loop: [1, 0, 2, 3], n: [0, 0, -1] },
  { loop: [0, 4, 6, 2], n: [-1, 0, 0] },
  { loop: [5, 1, 3, 7], n: [1, 0, 0] },
  { loop: [6, 7, 3, 2], n: [0, 1, 0] },
  { loop: [0, 1, 5, 4], n: [0, -1, 0] },
];

type Pt = [number, number];

/** A polygon path with rounded corners (radius per corner), drawn with arcTo so it works for any projected quad. */
function roundedPath(c: CanvasRenderingContext2D, pts: Pt[], radii: number[]) {
  const n = pts.length;
  c.beginPath();
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const prev = pts[(i + n - 1) % n]!;
    const next = pts[(i + 1) % n]!;
    const r = Math.min(radii[i] ?? 0, Math.hypot(p[0] - prev[0], p[1] - prev[1]) / 2, Math.hypot(p[0] - next[0], p[1] - next[1]) / 2);
    if (i === 0) {
      const m: Pt = [(prev[0] + p[0]) / 2, (prev[1] + p[1]) / 2];
      c.moveTo(m[0], m[1]);
    }
    if (r > 0.05) c.arcTo(p[0], p[1], next[0], next[1], r);
    else c.lineTo(p[0], p[1]);
  }
  c.closePath();
}

function poly(c: CanvasRenderingContext2D, pts: Pt[]) {
  c.beginPath();
  pts.forEach((p, i) => {
    if (i) c.lineTo(p[0], p[1]);
    else c.moveTo(p[0], p[1]);
  });
  c.closePath();
}

function line(c: CanvasRenderingContext2D, pts: Pt[]) {
  c.beginPath();
  pts.forEach((p, i) => {
    if (i) c.lineTo(p[0], p[1]);
    else c.moveTo(p[0], p[1]);
  });
}

/** A side face's fill: tops catch the light like a cap, the rest are shaded by how they face the light. */
function sideFill(n: V3, tone: SeriesTone, flat: string, g: number, hot: number): string {
  const lam = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
  return n[1] > 0.5
    ? rgba(mix(flat, tone.cap, g), Math.min(1, (0.35 + 0.43 * g) * hot))
    : rgba(mix(tone.shade, tone.rim, lam), Math.min(1, (0.3 + 0.25 * lam) * Math.max(g, 0.6) * hot));
}

function boxCorners(b: Box, cam: Camera): { P: Pt[]; W: V3[] } {
  const P: Pt[] = [];
  const W: V3[] = [];
  for (let i = 0; i < 8; i++) {
    const w: V3 = [i & 1 ? b.x1 : b.x0, i & 2 ? b.y1 : b.y0, i & 4 ? b.z1 : b.z0];
    W.push(w);
    P.push(cam.project(w));
  }
  return { P, W };
}

const faceVisible = (f: (typeof FACES)[number], W: V3[], eye: V3) => {
  const cx = (W[f.loop[0]]![0] + W[f.loop[2]]![0]) / 2;
  const cy = (W[f.loop[0]]![1] + W[f.loop[2]]![1]) / 2;
  const cz = (W[f.loop[0]]![2] + W[f.loop[2]]![2]) / 2;
  return f.n[0] * (eye[0] - cx) + f.n[1] * (eye[1] - cy) + f.n[2] * (eye[2] - cz) > 0;
};

function drawBox(c: CanvasRenderingContext2D, b: Box, cam: Camera, tone: SeriesTone, m: Morph, form: Layout['form'], px: number, hot: number) {
  const { P, W } = boxCorners(b, cam);
  const g = m.glass;
  const thick = b.z1 - b.z0 > 0.05;
  const flat = mix(tone.flat, tone.hover, hot > 1 ? 1 - g : 0);

  if (b.y1 - b.y0 < 0.5 && form === 'columns') {
    // A real zero: a thin line on the baseline, a flat footprint in 3D.
    c.strokeStyle = rgba(tone.flat, 1);
    c.lineWidth = 1.5 * px;
    c.beginPath();
    c.moveTo(...P[4]!);
    c.lineTo(...P[5]!);
    if (thick) {
      c.lineTo(...P[1]!);
      c.lineTo(...P[0]!);
      c.closePath();
    }
    c.stroke();
    return;
  }

  const shown = thick ? FACES.filter((f) => faceVisible(f, W, cam.eye)) : [FACES[0]!];
  if (thick && g > 0) {
    // The far faces first, faintly: the glass's thickness seen through the front.
    for (const f of FACES) {
      if (shown.includes(f)) continue;
      poly(c, f.loop.map((i) => P[i]!));
      c.fillStyle = rgba(tone.core, 0.08 * g * hot);
      c.fill();
      c.strokeStyle = rgba(tone.edge, 0.3 * g * hot);
      c.lineWidth = px;
      c.stroke();
    }
  }
  for (const f of shown) {
    const pts = f.loop.map((i) => P[i]!);
    if (f.front) {
      const r = 3 * (1 - g);
      // Columns round their two top corners and bars all four, as the flat charts do; a stack only its last part.
      const radii = b.round === 'none' ? [0, 0, 0, 0] : b.round === 'all' ? [r, r, r, r] : b.round === 'end' && form === 'rows' ? [0, r, r, 0] : form === 'columns' ? [0, 0, r, r] : [r, r, r, r];
      roundedPath(c, pts, radii);
      const top = [(pts[2]![0] + pts[3]![0]) / 2, (pts[2]![1] + pts[3]![1]) / 2];
      const bot = [(pts[0]![0] + pts[1]![0]) / 2, (pts[0]![1] + pts[1]![1]) / 2];
      const fill = c.createLinearGradient(top[0]!, top[1]!, bot[0]!, bot[1]!);
      const col = mix(flat, tone.core, g);
      fill.addColorStop(0, rgba(col, Math.min(1, (1 - 0.5 * g) * (g > 0 ? hot : 1))));
      fill.addColorStop(1, rgba(col, Math.min(1, (1 - 0.78 * g) * (g > 0 ? hot : 1))));
      c.fillStyle = fill;
      c.fill();
      if (g > 0.02) {
        // A specular streak down the glass, like the sign-in cards' sheen.
        const a = pts[3]!;
        const bR = pts[2]!;
        const c0 = pts[0]!;
        const at = (u: number, v: number): Pt => [a[0] + (bR[0] - a[0]) * u + (c0[0] - a[0]) * v, a[1] + (bR[1] - a[1]) * u + (c0[1] - a[1]) * v];
        poly(c, [at(0.14, 0.02), at(0.22, 0.02), at(0.22, 0.98), at(0.14, 0.98)]);
        const streak = c.createLinearGradient(top[0]!, top[1]!, bot[0]!, bot[1]!);
        streak.addColorStop(0, rgba(T.white, 0.28 * g));
        streak.addColorStop(1, rgba(T.white, 0));
        c.fillStyle = streak;
        c.fill();
        roundedPath(c, pts, radii);
        c.strokeStyle = rgba(tone.edge, Math.min(1, 0.9 * g * hot));
        c.lineWidth = 1.1 * px;
        c.stroke();
      }
      continue;
    }
    poly(c, pts);
    c.fillStyle = sideFill(f.n, tone, flat, g, hot);
    c.fill();
    c.strokeStyle = rgba(tone.edge, Math.min(1, 0.9 * g * hot));
    c.lineWidth = 1.1 * px;
    c.stroke();
  }
}

/**
 * A bullet's target: flat, a pale case with a grey outline (open at the baseline), the bar inside drawn over it; in 3D
 * a clear glass case, its far faces behind the bar and its near faces in front of it.
 */
function drawCase(c: CanvasRenderingContext2D, b: Box, cam: Camera, m: Morph, form: Layout['form'], px: number, hot: number, inner: () => void) {
  const { P, W } = boxCorners(b, cam);
  const g = m.glass;
  const thick = b.z1 - b.z0 > 0.05;
  const front = FACES[0]!.loop.map((i) => P[i]!);
  poly(c, front);
  c.fillStyle = rgba(T.line, 0.55 * (1 - g));
  c.fill();
  const shown = thick ? FACES.filter((f) => faceVisible(f, W, cam.eye)) : [FACES[0]!];
  if (thick && g > 0) {
    for (const f of FACES) {
      if (shown.includes(f)) continue;
      poly(c, f.loop.map((i) => P[i]!));
      c.fillStyle = rgba(T.line, 0.05 * g);
      c.fill();
      c.strokeStyle = rgba(T.chromeFg, 0.22 * g * hot);
      c.lineWidth = px;
      c.stroke();
    }
  }
  inner();
  for (const f of shown) {
    const pts = f.loop.map((i) => P[i]!);
    if (g > 0) {
      poly(c, pts);
      c.fillStyle = rgba(f.n[1] > 0.5 ? T.white : T.line, (f.front ? 0.06 : 0.1) * g);
      c.fill();
    }
    if (f.front) {
      // Open at the baseline: the bottom edge for columns, the left edge for bars (the front loop is BL, BR, TR, TL).
      line(c, form === 'rows' ? [pts[3]!, pts[2]!, pts[1]!, pts[0]!] : [pts[0]!, pts[3]!, pts[2]!, pts[1]!]);
      c.strokeStyle = rgba(mix(T.field, T.chromeFg, g), Math.min(1, (1 - 0.4 * g) * hot));
      // In viewBox units, like the flat case's stroke, so the outline keeps its width at the hand-off.
      c.lineWidth = 1.5 - 0.4 * g;
      c.stroke();
    } else if (g > 0) {
      poly(c, pts);
      c.strokeStyle = rgba(T.chromeFg, Math.min(1, 0.45 * g * hot));
      c.lineWidth = px;
      c.stroke();
    }
  }
}

/** A marker: flat, a dot with a white ring that parts it from the line; in 3D a glass bead with a highlight. */
function drawDot(c: CanvasRenderingContext2D, d: Dot, cam: Camera, tone: SeriesTone, m: Morph, hot: number) {
  const [x, y] = cam.project(d.c);
  const rs = dotRadius(cam, d.c, d.r);
  const g = m.glass;
  const col = mix(mix(tone.flat, tone.hover, hot > 1 ? 1 - g : 0), tone.core, g);
  c.beginPath();
  c.arc(x, y, rs, 0, Math.PI * 2);
  if (g > 0) {
    const fill = c.createRadialGradient(x - rs * 0.35, y - rs * 0.35, 0, x, y, rs);
    fill.addColorStop(0, rgba(mix(col, T.white, 0.55 * g), Math.min(1, hot)));
    fill.addColorStop(0.55, rgba(col, Math.min(1, hot)));
    fill.addColorStop(1, rgba(mix(col, tone.shade, 0.5 * g), Math.min(1, hot)));
    c.fillStyle = fill;
  } else c.fillStyle = col;
  c.fill();
  c.strokeStyle = mix(T.white, T.stageTop, m.stage);
  c.lineWidth = 2 - 0.8 * g;
  c.stroke();
  if (g > 0.02) {
    c.beginPath();
    c.arc(x - rs * 0.35, y - rs * 0.4, rs * 0.28, 0, Math.PI * 2);
    c.fillStyle = rgba(T.white, 0.5 * g);
    c.fill();
  }
}

/**
 * An outline pushed out in depth: the far face faintly, the sides that face the eye far to near (a curve's sides as
 * one shaded surface, so no seams show), then the front. A line's ribbon also has a glow down to the floor, and an
 * area its top line along the front. Markers go on last.
 */
function drawPrism(c: CanvasRenderingContext2D, pr: Prism, cam: Camera, m: Morph, px: number, hot: number, lift: Pt) {
  const g = m.glass;
  const tone = pr.tone;
  const flat = mix(tone.flat, tone.hover, hot > 1 ? 1 - g : 0);
  const col = mix(flat, tone.core, g);
  const pts: Pt[] = pr.pts.map(([x, y]) => [x + lift[0], y + lift[1]]);
  const n = pts.length;
  const thick = pr.z1 - pr.z0 > 0.05;
  const F = pts.map(([x, y]) => cam.project([x, y, pr.z1]));
  const B = pts.map(([x, y]) => cam.project([x, y, pr.z0]));

  if (pr.curtain && g > 0) {
    const zc = (pr.z0 + pr.z1) / 2;
    const q = pr.curtain.map(([x, y]) => cam.project([x, y, zc]));
    const ys = pr.curtain.map((p) => p[1]);
    const xm = (Math.min(...pr.curtain.map((p) => p[0])) + Math.max(...pr.curtain.map((p) => p[0]))) / 2;
    const [tx, ty] = cam.project([xm, Math.max(...ys), zc]);
    const [bx, by] = cam.project([xm, Math.min(...ys), zc]);
    const glow = c.createLinearGradient(tx, ty, bx, by);
    glow.addColorStop(0, rgba(tone.core, 0.26 * g * hot));
    glow.addColorStop(1, rgba(tone.core, 0));
    poly(c, q);
    c.fillStyle = glow;
    c.fill();
  }

  if (n >= 3) {
    let area2 = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % n]!;
      area2 += a[0] * b[1] - b[0] * a[1];
    }
    const sign = area2 >= 0 ? 1 : -1;
    if (thick && g > 0 && pr.look !== 'ribbon') {
      poly(c, B);
      c.fillStyle = rgba(tone.core, 0.08 * g * hot);
      c.fill();
    }
    if (thick) {
      // Outward normal of each edge, and whether it faces the eye.
      const zm = (pr.z0 + pr.z1) / 2;
      const edges = pts.map((a, i) => {
        const b = pts[(i + 1) % n]!;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const l = Math.hypot(dx, dy) || 1;
        const nn: V3 = [(sign * dy) / l, (-sign * dx) / l, 0];
        const mx = (a[0] + b[0]) / 2;
        const my = (a[1] + b[1]) / 2;
        const vis = nn[0] * (cam.eye[0] - mx) + nn[1] * (cam.eye[1] - my) > 0 && l > 1e-6;
        return { i, nn, vis, dist: Math.hypot(mx - cam.eye[0], my - cam.eye[1], zm - cam.eye[2]) };
      });
      // Runs: neighbouring visible edges of one curve.
      const runs: number[][] = [];
      for (const e of edges) {
        if (!e.vis) continue;
        const last = runs[runs.length - 1];
        const prev = last?.[last.length - 1];
        if (last && prev === e.i - 1 && pr.smooth[prev] && pr.smooth[e.i]) last.push(e.i);
        else runs.push([e.i]);
      }
      // A run that wraps past the last edge joins the first one.
      if (runs.length > 1) {
        const first = runs[0]!;
        const last = runs[runs.length - 1]!;
        if (first[0] === 0 && last[last.length - 1] === n - 1 && pr.smooth[n - 1] && pr.smooth[0]) {
          runs[0] = [...last, ...first];
          runs.pop();
        }
      }
      runs.sort((a, b) => edges[b[Math.floor(b.length / 2)]!]!.dist - edges[a[Math.floor(a.length / 2)]!]!.dist);
      for (const run of runs) {
        const idx = [...run.map((i) => i), (run[run.length - 1]! + 1) % n];
        const top = idx.map((i) => F[i]!);
        const bottom = idx.map((i) => B[i]!).reverse();
        poly(c, [...top, ...bottom]);
        if (run.length === 1) c.fillStyle = sideFill(edges[run[0]!]!.nn, tone, flat, g, hot);
        else {
          const mid = (i: number): Pt => [(F[i]![0] + F[(i + 1) % n]![0] + B[i]![0] + B[(i + 1) % n]![0]) / 4, (F[i]![1] + F[(i + 1) % n]![1] + B[i]![1] + B[(i + 1) % n]![1]) / 4];
          const a = mid(run[0]!);
          const b = mid(run[run.length - 1]!);
          const grad = c.createLinearGradient(a[0], a[1], b[0], b[1]);
          run.forEach((i, k) => {
            grad.addColorStop(k / (run.length - 1), sideFill(edges[i]!.nn, tone, flat, g, hot));
          });
          c.fillStyle = grad;
        }
        c.fill();
        if (g > 0.02) {
          c.strokeStyle = rgba(tone.edge, Math.min(1, (pr.look === 'ribbon' ? 0.5 : 0.9) * g * hot));
          c.lineWidth = 1.1 * px;
          line(c, top);
          c.stroke();
          line(c, bottom);
          c.stroke();
        }
      }
    }
    poly(c, F);
    if (pr.look === 'ribbon') c.fillStyle = rgba(col, Math.min(1, hot));
    else {
      const ys = F.map((p) => p[1]);
      const xm = F.reduce((s, p) => s + p[0], 0) / n;
      const grad = c.createLinearGradient(xm, Math.min(...ys), xm, Math.max(...ys));
      if (pr.look === 'area') {
        grad.addColorStop(0, rgba(col, Math.min(1, 0.22 + 0.3 * g)));
        grad.addColorStop(1, rgba(col, Math.min(1, 0.22 - 0.08 * g)));
      } else {
        grad.addColorStop(0, rgba(col, Math.min(1, (1 - 0.5 * g) * (g > 0 ? hot : 1))));
        grad.addColorStop(1, rgba(col, Math.min(1, (1 - 0.75 * g) * (g > 0 ? hot : 1))));
      }
      c.fillStyle = grad;
    }
    c.fill();
    if (g > 0.02 && pr.look !== 'ribbon') {
      c.strokeStyle = rgba(tone.edge, Math.min(1, 0.9 * g * hot));
      c.lineWidth = 1.1 * px;
      c.stroke();
    }
  }
  if (pr.edge && pr.edge.length > 1) {
    // The area's line, along the top of its front.
    line(c, pr.edge.map(([x, y]) => cam.project([x + lift[0], y + lift[1], pr.z1])));
    c.strokeStyle = rgba(mix(flat, tone.edge, g), Math.min(1, hot));
    c.lineWidth = 2 - 0.8 * g;
    c.lineJoin = 'round';
    c.stroke();
  }
  for (const d of pr.dots) drawDot(c, d, cam, tone, m, hot);
}

function drawLabel(c: CanvasRenderingContext2D, text: string, x: number, y: number, anchor: CanvasTextAlign, color: string, chip: string | null, m: Morph, size: number, font: string, weight: number) {
  c.font = `${weight} ${size}px ${font}`;
  c.textAlign = anchor;
  c.textBaseline = 'alphabetic';
  if (m.chips > 0.01 && chip) {
    const w = c.measureText(text).width;
    const x0 = anchor === 'center' ? x - w / 2 : anchor === 'right' ? x - w : x;
    c.beginPath();
    c.roundRect(x0 - 3, y - size * 0.82, w + 6, size * 1.1, 3);
    c.fillStyle = chip;
    c.fill();
  }
  c.fillStyle = color;
  c.fillText(text, x, y);
}

const ALIGN = { start: 'left', middle: 'center', end: 'right' } as const;

const quad = (cam: Camera, x0: number, x1: number, y0: number, y1: number, z: number): Pt[] => [cam.project([x0, y0, z]), cam.project([x1, y0, z]), cam.project([x1, y1, z]), cam.project([x0, y1, z])];

/**
 * One frame. The canvas is sized in device pixels; drawing happens in viewBox units. Returns the marks in paint order
 * (far to near) and the camera they were drawn with, for hit testing.
 */
export function drawFrame(ctx: CanvasRenderingContext2D, scene: Scene, L: Layout, cam: Camera, m: Morph, opt: DrawOptions, s: Scratch): { order: Mark[]; cam: Camera } {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const k = opt.unit * opt.dpr;
  const px = 1 / opt.unit; // one CSS pixel in viewBox units
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const { vw, vh } = scene;
  const f = scene.floor;
  const hotFor = (datum: number) => (opt.hover < 0 ? 1 : datum === opt.hover ? 1.5 : 0.7);

  // The stage: the card's white gives way to the dark PANW stage.
  if (m.stage > 0) {
    ctx.globalAlpha = m.stage;
    const bg = ctx.createLinearGradient(0, 0, 0, vh);
    bg.addColorStop(0, T.stageTop);
    bg.addColorStop(0.55, T.chrome);
    bg.addColorStop(1, T.stageBottom);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, vw, vh);
    ctx.globalAlpha = 1;
    if (m.glow > 0) {
      const { min, max } = scene.bounds;
      const [gx, gy] = f ? cam.project([(f.x0 + f.x1) / 2, f.y, (f.z0 + f.z1) / 2]) : cam.project([(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2]);
      const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, 0.65 * Math.hypot(vw, vh));
      glow.addColorStop(0, rgba(T.orange, 0.16 * m.glow));
      glow.addColorStop(1, rgba(T.orange, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, vw, vh);
    }
  }

  // Grid floor.
  if (f && m.floor > 0) {
    poly(ctx, quad3(cam, f));
    ctx.fillStyle = rgba(T.chrome2, 0.35 * m.floor);
    ctx.fill();
    const step = 28;
    ctx.lineWidth = px;
    let n = 0;
    for (let x = Math.ceil(f.x0 / step) * step; x <= f.x1; x += step, n++) {
      ctx.strokeStyle = rgba(T.chromeMuted, (n % 5 === 0 ? 0.26 : 0.14) * m.floor);
      ctx.beginPath();
      ctx.moveTo(...cam.project([x, f.y, f.z0]));
      ctx.lineTo(...cam.project([x, f.y, f.z1]));
      ctx.stroke();
    }
    n = 0;
    for (let z = f.z1; z >= f.z0; z -= step, n++) {
      ctx.strokeStyle = rgba(T.chromeMuted, (n % 5 === 0 ? 0.26 : 0.14) * m.floor);
      ctx.beginPath();
      ctx.moveTo(...cam.project([f.x0, f.y, z]));
      ctx.lineTo(...cam.project([f.x1, f.y, z]));
      ctx.stroke();
    }
    // Light pools under the bars that stand on the floor, and reflections, both kept inside the floor's edges.
    if (opt.quality === 0 && m.glow > 0) {
      ctx.save();
      poly(ctx, quad3(cam, f));
      ctx.clip();
      // A case is clear glass: it gives no light; the bar inside it does.
      const lit = scene.boxes.flatMap((b) => (b.inner ? [b.inner] : b.role === 'case' ? [] : [b]));
      for (const b of lit) {
        if (b.part === 'above' || Math.abs(b.y0 - f.y) > 0.5) continue;
        const tone = b.tone ?? SERIES_TONES[b.series] ?? SERIES_TONES[0]!;
        const [cx, cy] = cam.project([(b.x0 + b.x1) / 2, f.y, (b.z0 + b.z1) / 2]);
        const [ex] = cam.project([b.x1 + (b.x1 - b.x0) * 0.7, f.y, (b.z0 + b.z1) / 2]);
        const [, ey] = cam.project([(b.x0 + b.x1) / 2, f.y, b.z1 + (b.z1 - b.z0) * 0.7]);
        const rx = Math.max(2, Math.abs(ex - cx));
        const ry = Math.max(1, Math.abs(ey - cy));
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, ry / rx);
        const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
        pool.addColorStop(0, rgba(tone.core, 0.45 * m.glow * tone.glow));
        pool.addColorStop(1, rgba(tone.core, 0));
        ctx.fillStyle = pool;
        ctx.beginPath();
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // Reflections: each mark mirrored in the floor, fading out with depth the way a polished floor does.
      const fade = 0.25 * vh;
      for (const b of lit) {
        const y1 = 2 * f.y - b.y0;
        const y0 = Math.max(2 * f.y - b.y1, f.y - fade);
        if (y1 - y0 < 0.5 || b.y0 < f.y - 0.01) continue;
        const tone = b.tone ?? SERIES_TONES[b.series] ?? SERIES_TONES[0]!;
        const [sx, sy] = cam.project([(b.x0 + b.x1) / 2, f.y, b.z1]);
        const [ex, ey] = cam.project([(b.x0 + b.x1) / 2, f.y - fade, b.z1]);
        const shine = ctx.createLinearGradient(sx, sy, ex, ey);
        shine.addColorStop(0, rgba(tone.core, 0.3 * m.glow * m.glass * tone.glow));
        shine.addColorStop(1, rgba(tone.core, 0));
        ctx.fillStyle = shine;
        const faces: [number, number, number, number][] = [[b.x0, b.x1, b.z1, b.z1]];
        // The side facing the eye, so a turned bar's reflection has depth too.
        if (cam.eye[0] > b.x1) faces.push([b.x1, b.x1, b.z1, b.z0]);
        else if (cam.eye[0] < b.x0) faces.push([b.x0, b.x0, b.z1, b.z0]);
        for (const [xa, xb, za, zb] of faces) {
          poly(ctx, [cam.project([xa, y1, za]), cam.project([xb, y1, zb]), cam.project([xb, y0, zb]), cam.project([xa, y0, za])]);
          ctx.fill();
        }
      }
      for (const p of scene.prisms) {
        if (p.look === 'ribbon' || p.pts.length < 3 || p.y0 > f.y + 4) continue;
        const [sx, sy] = cam.project([(p.x0 + p.x1) / 2, f.y, p.z1]);
        const [ex, ey] = cam.project([(p.x0 + p.x1) / 2, f.y - fade, p.z1]);
        const shine = ctx.createLinearGradient(sx, sy, ex, ey);
        shine.addColorStop(0, rgba(p.tone.core, (p.look === 'area' ? 0.18 : 0.26) * m.glow * m.glass * p.tone.glow));
        shine.addColorStop(1, rgba(p.tone.core, 0));
        ctx.fillStyle = shine;
        poly(ctx, p.pts.map(([x, y]) => cam.project([x, 2 * f.y - y, p.z1])));
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // A heatmap's grid: a dark glass table top in 3D; flat, the empty cells' pale squares.
  if (scene.board && scene.frame) {
    const lc = localCamera(cam, scene.frame);
    const b = scene.board;
    if (m.glass > 0) {
      poly(ctx, quad(lc, b.x0 - 6, b.x1 + 6, b.y0 - 6, b.y1 + 6, 0));
      ctx.fillStyle = rgba(T.chrome2, 0.6 * m.glass);
      ctx.fill();
      ctx.strokeStyle = rgba(T.line, 0.2 * m.glass);
      ctx.lineWidth = px;
      ctx.stroke();
    }
    for (const e of b.empty) {
      // Flat, the same rounded pale square as the SVG; the dashed outline comes in with the glass.
      const r = 3 * (1 - m.glass);
      roundedPath(ctx, quad(lc, e.x0, e.x1, e.y0, e.y1, 0), [r, r, r, r]);
      ctx.fillStyle = rgba(mix(T.line, T.white, 0.5), 1 - m.glass);
      ctx.fill();
      if (m.glass > 0) {
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = rgba(T.line, (m.dark ? 0.4 : 1) * m.glass);
        ctx.lineWidth = px;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  // Back glass panel, carrying the value gridlines (in the bars' plane when flat, so they are the 2D gridlines).
  const pn = scene.panel;
  if (pn && m.glass > 0) {
    const q = quad(cam, pn.x0, pn.x1, pn.y0, pn.y1, pn.z);
    poly(ctx, q);
    const pf = ctx.createLinearGradient(q[3]![0], q[3]![1], q[0]![0], q[0]![1]);
    pf.addColorStop(0, rgba(T.chrome2, 0.55 * m.glass));
    pf.addColorStop(1, rgba(T.chrome, 0.2 * m.glass));
    ctx.fillStyle = pf;
    ctx.fill();
    ctx.strokeStyle = rgba(T.line, 0.16 * m.glass);
    ctx.lineWidth = px;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(...q[3]!);
    ctx.lineTo(...q[2]!);
    ctx.strokeStyle = rgba(T.white, 0.22 * m.glass);
    ctx.stroke();
  }
  const gridAlpha = L.form === 'columns' ? 1 - 0.84 * m.stage : 0.16 * m.floor;
  if (gridAlpha > 0.005) {
    scene.grid.forEach((g, i) => {
      const zero = L.form === 'columns' && i === 0;
      ctx.strokeStyle = zero ? rgba(T.field, 1 - 0.65 * m.stage) : rgba(T.line, gridAlpha);
      ctx.lineWidth = px;
      ctx.beginPath();
      ctx.moveTo(...cam.project(g.a));
      ctx.lineTo(...cam.project(g.b));
      ctx.stroke();
    });
  }

  // Missing values: a dashed footprint on the baseline, never a bar.
  for (const gh of scene.ghosts) {
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = m.dark ? rgba(T.line, 0.45) : rgba(T.field, 1);
    if (gh.z1 - gh.z0 > 0.05) poly(ctx, [cam.project([gh.x0, gh.y0, gh.z0]), cam.project([gh.x1, gh.y1, gh.z0]), cam.project([gh.x1, gh.y1, gh.z1]), cam.project([gh.x0, gh.y0, gh.z1])]);
    else {
      ctx.beginPath();
      ctx.moveTo(...cam.project([gh.x0, gh.y0, gh.z1]));
      ctx.lineTo(...cam.project([gh.x1, gh.y1, gh.z1]));
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // A donut's legend keys.
  for (const sw of scene.swatches) {
    const [x, y, z] = sw.p;
    poly(ctx, quad(cam, x, x + sw.s, y - sw.s, y, z));
    ctx.fillStyle = mix(sw.tone.flat, sw.tone.core, m.glass);
    ctx.fill();
  }

  // The marks, on their own layer so the bloom can be made from them.
  fitScratch(s, cw, ch);
  const lc = s.layer.getContext('2d')!;
  lc.setTransform(1, 0, 0, 1, 0, 0);
  lc.clearRect(0, 0, cw, ch);
  lc.setTransform(k, 0, 0, k, 0, 0);
  const po = paintOrder(scene, cam);
  const mc = po.cam;
  const drawMark = (b: Mark) => {
    if (isPrism(b)) {
      // A hovered wedge slides out a little, in 3D.
      const out = b.out && b.datum === opt.hover ? 6 * m.glass : 0;
      drawPrism(lc, b, mc, m, px, b.datum >= 0 ? hotFor(b.datum) : opt.hover < 0 ? 1 : b.dots.some((d) => d.datum === opt.hover) ? 1.2 : 0.8, b.out ? [b.out[0] * out, b.out[1] * out] : [0, 0]);
      return;
    }
    const tone = b.tone ?? SERIES_TONES[b.series] ?? SERIES_TONES[0]!;
    if (b.role === 'case') {
      drawCase(lc, b, mc, m, L.form, px, hotFor(b.datum), () => {
        if (b.inner) drawBox(lc, b.inner, mc, SERIES_TONES[b.inner.series] ?? SERIES_TONES[0]!, m, L.form, px, hotFor(b.inner.datum));
      });
      return;
    }
    drawBox(lc, b, mc, tone, m, L.form, px, hotFor(b.datum));
    if (b.cap) drawDot(lc, { datum: b.datum, c: b.cap.c, r: b.cap.r }, mc, tone, m, hotFor(b.datum));
  };
  const plane = () => {
    const t = scene.target;
    if (!t) return;
    if (m.glass > 0) {
      poly(lc, [cam.project([t.x0, t.y, t.z0]), cam.project([t.x1, t.y, t.z0]), cam.project([t.x1, t.y, t.z1]), cam.project([t.x0, t.y, t.z1])]);
      lc.fillStyle = rgba(T.line, 0.07 * m.glass);
      lc.fill();
      lc.strokeStyle = rgba(T.chromeFg, 0.25 * m.glass);
      lc.lineWidth = px;
      lc.beginPath();
      lc.moveTo(...cam.project([t.x0, t.y, t.z0]));
      lc.lineTo(...cam.project([t.x1, t.y, t.z0]));
      lc.stroke();
    }
    // Flat, the plane is seen edge-on: the 2px charcoal 1.00x line.
    lc.strokeStyle = mix(T.chrome, T.chromeFg, m.stage);
    lc.lineWidth = (2 - 0.5 * m.glass) * px;
    lc.beginPath();
    lc.moveTo(...cam.project([t.x0, t.y, t.z1]));
    lc.lineTo(...cam.project([t.x1, t.y, t.z1]));
    lc.stroke();
  };
  if (po.eyeAbove) {
    po.below.forEach(drawMark);
    plane();
    po.above.forEach(drawMark);
  } else {
    po.above.forEach(drawMark);
    plane();
    po.below.forEach(drawMark);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(s.layer, 0, 0);

  // Bloom: the mark layer, downsampled three times and added back as light.
  if (opt.quality < 2 && m.glow > 0.01) {
    let src: HTMLCanvasElement = s.layer;
    for (const mip of s.mips) {
      const mcx = mip.getContext('2d')!;
      mcx.setTransform(1, 0, 0, 1, 0, 0);
      mcx.clearRect(0, 0, mip.width, mip.height);
      mcx.imageSmoothingEnabled = true;
      mcx.imageSmoothingQuality = 'high';
      mcx.drawImage(src, 0, 0, src.width, src.height, 0, 0, mip.width, mip.height);
      src = mip;
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    [0.55, 0.45, 0.35].forEach((a, i) => {
      ctx.globalAlpha = a * m.glow;
      ctx.drawImage(s.mips[i]!, 0, 0, cw, ch);
    });
    ctx.restore();
  }

  // Vignette.
  ctx.setTransform(k, 0, 0, k, 0, 0);
  if (m.stage > 0) {
    const v = ctx.createRadialGradient(vw / 2, vh / 2, 0.55 * Math.hypot(vw, vh) * 0.5, vw / 2, vh / 2, 0.5 * Math.hypot(vw, vh));
    v.addColorStop(0, rgba(T.black, 0));
    v.addColorStop(1, rgba(T.black, 0.38 * m.stage));
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, vw, vh);
  }

  // Labels last, on chips. Turned, labels can collide: the target line's label and a donut's total win (they are the
  // only labels not in the table), then value labels (nearest first), categories, "n/a" and ticks; a label that would
  // overlap one already placed is left out (it is in the table). A heatmap's row and column names come before its
  // values: without them no cell can be read.
  const RANK =
    scene.kind === 'heatmap'
      ? ({ target: 0, total: 0, category: 1, value: 2, na: 3, tick: 4 } as const)
      : ({ target: 0, total: 0, value: 1, category: 2, na: 3, tick: 4 } as const);
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const labels = scene.labels
    .map((l) => ({ l, at: cam.project(l.p), depth: cam.depth(l.p) }))
    .sort((a, b) => RANK[a.l.kind] - RANK[b.l.kind] || b.depth - a.depth);
  for (const { l, at } of labels) {
    const x = at[0] + l.dx;
    const y = at[1] + l.dy;
    const size = labelSize(l.kind);
    const weight = l.kind === 'total' ? 700 : 400;
    if (m.t > 0.05) {
      ctx.font = `${weight} ${size}px ${opt.font}`;
      const w = ctx.measureText(l.text).width;
      const x0 = l.anchor === 'middle' ? x - w / 2 : l.anchor === 'end' ? x - w : x;
      const r = { x0: x0 - 3, y0: y - size * 0.85, x1: x0 + w + 3, y1: y + size * 0.3 };
      if (placed.some((d) => r.x0 < d.x1 && d.x0 < r.x1 && r.y0 < d.y1 && d.y0 < r.y1)) continue;
      placed.push(r);
    }
    // A label inside a coloured mark keeps its ink on the light card; on the stage every value is white on a chip.
    const color =
      l.ink && !m.dark
        ? l.ink === 'light' ? T.white : T.chrome
        : l.kind === 'category' || l.kind === 'target' || l.kind === 'total'
          ? m.dark ? T.chromeFg : T.chrome
          : m.dark ? (l.kind === 'value' ? T.white : T.stageMuted) : T.muted;
    const chip = m.dark || l.ink === 'light' ? rgba(T.stageTop, 0.72 * m.chips) : l.ink ? null : rgba(T.white, 0.85 * m.chips);
    drawLabel(ctx, l.text, x, y, ALIGN[l.anchor], color, chip, m, size, opt.font, weight);
  }
  return { order: po.eyeAbove ? [...po.below, ...po.above] : [...po.above, ...po.below], cam: mc };
}

const quad3 = (cam: Camera, f: NonNullable<Scene['floor']>): Pt[] => [cam.project([f.x0, f.y, f.z0]), cam.project([f.x1, f.y, f.z0]), cam.project([f.x1, f.y, f.z1]), cam.project([f.x0, f.y, f.z1])];
