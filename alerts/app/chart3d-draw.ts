// Draws one frame of a turned chart on a canvas: the dark stage, grid floor, back glass panel, glass bars in paint
// order, the target plane, a bloom built from a downsample chain (no ctx.filter or shadowBlur, so it looks the same
// in every browser), and labels on backing chips so they stay readable at every angle. Colours come only from
// chart3d-math (PANW tokens and their mixes). Shared byte-for-byte by both apps.
import { paintOrder, rgba, mix, SERIES_TONES, TOKENS as T, type Box, type Camera, type Layout, type Morph, type Scene, type SeriesTone, type V3 } from './chart3d-math';

export interface DrawOptions {
  unit: number; // CSS pixels per viewBox unit
  dpr: number;
  hover: number; // datum under the pointer, or -1
  font: string; // font family of the page
  quality: 0 | 1 | 2; // 0 full; 1 drops light pools; 2 also drops the bloom
}

/** Offscreen buffers, owned by one chart and reused every frame. */
export interface Scratch {
  layer: HTMLCanvasElement; // the bars alone, the source of the bloom
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
  pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
  c.closePath();
}

function drawBox(c: CanvasRenderingContext2D, b: Box, cam: Camera, tone: SeriesTone, m: Morph, form: Layout['form'], px: number, hot: number) {
  const P: Pt[] = [];
  const W: V3[] = [];
  for (let i = 0; i < 8; i++) {
    const w: V3 = [i & 1 ? b.x1 : b.x0, i & 2 ? b.y1 : b.y0, i & 4 ? b.z1 : b.z0];
    W.push(w);
    P.push(cam.project(w));
  }
  const g = m.glass;
  const thick = b.z1 - b.z0 > 0.05;
  const flat = mix(tone.flat, tone.hover, hot > 1 ? 1 - g : 0);
  const visible = (f: (typeof FACES)[number]) => {
    const cx = (W[f.loop[0]]![0] + W[f.loop[2]]![0]) / 2;
    const cy = (W[f.loop[0]]![1] + W[f.loop[2]]![1]) / 2;
    const cz = (W[f.loop[0]]![2] + W[f.loop[2]]![2]) / 2;
    return f.n[0] * (cam.eye[0] - cx) + f.n[1] * (cam.eye[1] - cy) + f.n[2] * (cam.eye[2] - cz) > 0;
  };

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

  const shown = thick ? FACES.filter(visible) : [FACES[0]!];
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
      // Columns round their two top corners; rows round all four, as the flat charts do.
      const radii = form === 'columns' ? [0, 0, r, r] : [r, r, r, r];
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
    const lam = Math.max(0, f.n[0] * LIGHT[0] + f.n[1] * LIGHT[1] + f.n[2] * LIGHT[2]);
    poly(c, pts);
    const isTop = f.n[1] > 0.5;
    c.fillStyle = isTop ? rgba(mix(flat, tone.cap, g), Math.min(1, (0.35 + 0.43 * g) * hot)) : rgba(mix(tone.shade, tone.rim, lam), Math.min(1, (0.3 + 0.25 * lam) * Math.max(g, 0.6) * hot));
    c.fill();
    c.strokeStyle = rgba(tone.edge, Math.min(1, 0.9 * g * hot));
    c.lineWidth = 1.1 * px;
    c.stroke();
  }
}

function drawLabel(c: CanvasRenderingContext2D, text: string, x: number, y: number, anchor: CanvasTextAlign, color: string, m: Morph, size: number, font: string) {
  c.font = `${size}px ${font}`;
  c.textAlign = anchor;
  c.textBaseline = 'alphabetic';
  if (m.chips > 0.01) {
    const w = c.measureText(text).width;
    const x0 = anchor === 'center' ? x - w / 2 : anchor === 'right' ? x - w : x;
    c.beginPath();
    c.roundRect(x0 - 3, y - size * 0.82, w + 6, size * 1.1, 3);
    c.fillStyle = m.dark ? rgba(T.stageTop, 0.72 * m.chips) : rgba(T.white, 0.85 * m.chips);
    c.fill();
  }
  c.fillStyle = color;
  c.fillText(text, x, y);
}

const ALIGN = { start: 'left', middle: 'center', end: 'right' } as const;

/**
 * One frame. The canvas is sized in device pixels; drawing happens in viewBox units. Returns the boxes in paint order
 * (far to near), for hit testing.
 */
export function drawFrame(ctx: CanvasRenderingContext2D, scene: Scene, L: Layout, cam: Camera, m: Morph, opt: DrawOptions, s: Scratch): Box[] {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const k = opt.unit * opt.dpr;
  const px = 1 / opt.unit; // one CSS pixel in viewBox units
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const { vw, vh } = scene;

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
      const f = scene.floor;
      const [gx, gy] = cam.project([(f.x0 + f.x1) / 2, f.y, (f.z0 + f.z1) / 2]);
      const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, 0.65 * Math.hypot(vw, vh));
      glow.addColorStop(0, rgba(T.orange, 0.16 * m.glow));
      glow.addColorStop(1, rgba(T.orange, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, vw, vh);
    }
  }

  // Grid floor.
  if (m.floor > 0) {
    const f = scene.floor;
    poly(ctx, [cam.project([f.x0, f.y, f.z0]), cam.project([f.x1, f.y, f.z0]), cam.project([f.x1, f.y, f.z1]), cam.project([f.x0, f.y, f.z1])]);
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
    // Light pools under the bars that stand on the floor, and their reflections, both kept inside the floor's edges.
    if (opt.quality === 0 && m.glow > 0) {
      ctx.save();
      poly(ctx, [cam.project([f.x0, f.y, f.z0]), cam.project([f.x1, f.y, f.z0]), cam.project([f.x1, f.y, f.z1]), cam.project([f.x0, f.y, f.z1])]);
      ctx.clip();
      for (const b of scene.boxes) {
        if (b.part === 'above' || Math.abs(b.y0 - f.y) > 0.5) continue;
        const tone = SERIES_TONES[b.series] ?? SERIES_TONES[0]!;
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
      // Reflections: each bar mirrored in the floor, fading out with depth the way a polished floor does.
      const fade = 0.25 * vh;
      for (const b of scene.boxes) {
        const y1 = 2 * f.y - b.y0;
        const y0 = Math.max(2 * f.y - b.y1, f.y - fade);
        if (y1 - y0 < 0.5 || b.y0 < f.y - 0.01) continue;
        const tone = SERIES_TONES[b.series] ?? SERIES_TONES[0]!;
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
      ctx.restore();
    }
  }

  // Back glass panel, carrying the value gridlines (in the bars' plane when flat, so they are the 2D gridlines).
  const pn = scene.panel;
  if (m.glass > 0) {
    const quad = [cam.project([pn.x0, pn.y0, pn.z]), cam.project([pn.x1, pn.y0, pn.z]), cam.project([pn.x1, pn.y1, pn.z]), cam.project([pn.x0, pn.y1, pn.z])] as Pt[];
    poly(ctx, quad);
    const pf = ctx.createLinearGradient(quad[3]![0], quad[3]![1], quad[0]![0], quad[0]![1]);
    pf.addColorStop(0, rgba(T.chrome2, 0.55 * m.glass));
    pf.addColorStop(1, rgba(T.chrome, 0.2 * m.glass));
    ctx.fillStyle = pf;
    ctx.fill();
    ctx.strokeStyle = rgba(T.line, 0.16 * m.glass);
    ctx.lineWidth = px;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(...quad[3]!);
    ctx.lineTo(...quad[2]!);
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

  // The bars, on their own layer so the bloom can be made from them.
  fitScratch(s, cw, ch);
  const lc = s.layer.getContext('2d')!;
  lc.setTransform(1, 0, 0, 1, 0, 0);
  lc.clearRect(0, 0, cw, ch);
  lc.setTransform(k, 0, 0, k, 0, 0);
  const { below, above, eyeAbove } = paintOrder(scene, cam);
  const hotFor = (b: Box) => (opt.hover < 0 ? 1 : b.datum === opt.hover ? 1.5 : 0.7);
  const drawAll = (list: Box[]) => list.forEach((b) => drawBox(lc, b, cam, SERIES_TONES[b.series] ?? SERIES_TONES[0]!, m, L.form, px, hotFor(b)));
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
  if (eyeAbove) {
    drawAll(below);
    plane();
    drawAll(above);
  } else {
    drawAll(above);
    plane();
    drawAll(below);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(s.layer, 0, 0);

  // Bloom: the bar layer, downsampled three times and added back as light.
  if (opt.quality < 2 && m.glow > 0.01) {
    let src: HTMLCanvasElement = s.layer;
    for (const mip of s.mips) {
      const mc = mip.getContext('2d')!;
      mc.setTransform(1, 0, 0, 1, 0, 0);
      mc.clearRect(0, 0, mip.width, mip.height);
      mc.imageSmoothingEnabled = true;
      mc.imageSmoothingQuality = 'high';
      mc.drawImage(src, 0, 0, src.width, src.height, 0, 0, mip.width, mip.height);
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

  // Labels last, on chips. Turned, labels can collide: the target line's label wins (it is the only label not in the
  // table), then value labels (nearest first), categories, "n/a" and ticks; a label that would overlap one already
  // placed is left out (it is in the table).
  const RANK = { target: 0, value: 1, category: 2, na: 3, tick: 4 } as const;
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const labels = scene.labels
    .map((l) => ({ l, at: cam.project(l.p), depth: cam.depth(l.p) }))
    .sort((a, b) => RANK[a.l.kind] - RANK[b.l.kind] || b.depth - a.depth);
  for (const { l, at } of labels) {
    const x = at[0] + l.dx;
    const y = at[1] + l.dy;
    const size = l.kind === 'tick' ? 11 : 12;
    if (m.t > 0.05) {
      ctx.font = `${size}px ${opt.font}`;
      const w = ctx.measureText(l.text).width;
      const x0 = l.anchor === 'middle' ? x - w / 2 : l.anchor === 'end' ? x - w : x;
      const r = { x0: x0 - 3, y0: y - size * 0.85, x1: x0 + w + 3, y1: y + size * 0.3 };
      if (placed.some((d) => r.x0 < d.x1 && d.x0 < r.x1 && r.y0 < d.y1 && d.y0 < r.y1)) continue;
      placed.push(r);
    }
    const color =
      l.kind === 'category' || l.kind === 'target'
        ? m.dark ? T.chromeFg : T.chrome
        : m.dark ? (l.kind === 'value' ? T.white : T.stageMuted) : T.muted;
    drawLabel(ctx, l.text, x, y, ALIGN[l.anchor], color, m, size, opt.font);
  }
  return eyeAbove ? [...below, ...above] : [...above, ...below];
}
