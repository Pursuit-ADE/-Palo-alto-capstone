'use client';

// Sign-in background: thousands of glass identity cards on a perspective floor, drawn on one canvas. Every card is
// anonymous (a silhouette, blurred name bars, and a role and region label from the demo's role model), so the page
// shows no person, account or number before sign-in. Purely decorative: the canvas is hidden from screen readers.
import { useEffect, useRef, type RefObject } from 'react';

/**
 * Where the name card is in its life: idle (no username), search (typing: the floor rushes and ripples), pick (typing
 * paused: the floor settles and one card under the name card's spot lights up), up (that card has lifted out and
 * left an empty slot).
 */
export type FloorPhase = 'idle' | 'search' | 'pick' | 'up';

export type ScreenRect = { left: number; top: number; width: number; height: number };

/** What the sign-in form tells the floor. Changed in place, so typing never re-renders the canvas. */
export type FloorSignal = {
  phase: FloorPhase;
  lastKey: number; // performance.now() of the last keystroke in the username field
  ripples: number[]; // start times of rings sent out from the name card's spot
  busy: boolean; // sign-in in progress
  deniedAt: number; // last refused sign-in
  picked: boolean; // onPicked already called for this pick
  still: boolean; // the person paused the motion; drawn like reduced motion
  onPicked?: (card: ScreenRect) => void; // the lit card's place on screen, so the name card can lift out of it
  slot?: () => ScreenRect | null; // while the name card is up, where the empty slot it came out of is on screen now
  poke?: () => void; // draw one frame (when still, the floor only draws on request); also picks up a change to still
};

export const newFloorSignal = (): FloorSignal => ({ phase: 'idle', lastKey: -1e9, ripples: [], busy: false, deniedAt: -1e9, picked: false, still: false });

export type CardLabel = { role: string; region: string };

// World units: the camera sits CAM_H above the floor; cards are TW wide and TD deep, on a SX by SZ grid.
const CAM_H = 1;
const SX = 0.36;
const SZ = 0.34;
const TW = 0.31;
const TD = 0.27;
export const TILE_ASPECT = TD / TW; // a floor card's depth over its width, lying on the floor
const SPRITE_W = 300;
const SPRITE_H = 190;
const PICK_HOLD_MS = 400; // how long the chosen card glows on the floor before it lifts

type Tone = { avatar: string; pill: string; text: string };
// PANW palette only: charcoal, greys, the signature orange (dark orange where it carries white text).
const TONES: Record<string, Tone> = {
  'Sales rep': { avatar: '#4a505a', pill: '#3a3f48', text: '#e9ebee' },
  'Sales manager': { avatar: '#7a3420', pill: '#c23b16', text: '#ffffff' },
  'Technical seller': { avatar: '#5d6470', pill: '#f5f6f7', text: '#1b1d21' },
};
const OTHER_TONE: Tone = { avatar: '#3f444c', pill: '#9aa1ab', text: '#1b1d21' };

function hash(i: number, k: number, salt = 0): number {
  let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(k + salt * 7919, 0xc2b2ae35);
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  x = Math.imul(x, 0x297a2d39);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

// One card face, drawn as frosted glass: a translucent body, a bright top edge and a diagonal sheen.
function drawCard(c: CanvasRenderingContext2D, label: CardLabel, lit: boolean, seed: number, font: string) {
  const tone = TONES[label.role] ?? OTHER_TONE;
  const shape = () => {
    c.beginPath();
    c.roundRect(3, 3, SPRITE_W - 6, SPRITE_H - 6, 18);
  };
  const body = c.createLinearGradient(0, 0, SPRITE_W, SPRITE_H);
  body.addColorStop(0, lit ? 'rgba(250,88,45,0.34)' : 'rgba(255,255,255,0.17)');
  body.addColorStop(0.55, lit ? 'rgba(250,88,45,0.12)' : 'rgba(255,255,255,0.06)');
  body.addColorStop(1, lit ? 'rgba(250,88,45,0.2)' : 'rgba(255,255,255,0.1)');
  shape();
  c.fillStyle = 'rgba(20,21,24,0.55)';
  c.fill();
  c.fillStyle = body;
  c.fill();
  c.save();
  shape();
  c.clip();
  const sheen = c.createLinearGradient(0, 0, SPRITE_W * 0.7, SPRITE_H);
  sheen.addColorStop(0, 'rgba(255,255,255,0.18)');
  sheen.addColorStop(0.45, 'rgba(255,255,255,0.02)');
  sheen.addColorStop(0.46, 'rgba(255,255,255,0)');
  c.fillStyle = sheen;
  c.fillRect(0, 0, SPRITE_W, SPRITE_H);
  c.fillStyle = lit ? 'rgba(255,190,170,0.85)' : 'rgba(255,255,255,0.5)';
  c.fillRect(20, 4, SPRITE_W - 40, 2);
  c.restore();
  shape();
  c.lineWidth = lit ? 5 : 2;
  c.strokeStyle = lit ? '#fa582d' : 'rgba(255,255,255,0.26)';
  c.stroke();

  // Avatar: a silhouette, never a face or initials.
  c.save();
  c.beginPath();
  c.arc(54, 62, 30, 0, Math.PI * 2);
  c.fillStyle = tone.avatar;
  c.fill();
  c.clip();
  c.fillStyle = 'rgba(245,246,247,0.78)';
  c.beginPath();
  c.arc(54, 55, 11, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.arc(54, 90, 21, Math.PI, 0);
  c.fill();
  c.restore();

  // Masked name and email.
  c.fillStyle = 'rgba(245,246,247,0.8)';
  c.beginPath();
  c.roundRect(100, 42, 110 + seed * 70, 16, 8);
  c.fill();
  c.fillStyle = 'rgba(190,196,204,0.45)';
  c.beginPath();
  c.roundRect(100, 70, 80 + ((seed * 7) % 1) * 60, 11, 6);
  c.fill();

  // Padlock: the identity stays private until sign-in.
  c.strokeStyle = lit ? '#fa582d' : 'rgba(190,196,204,0.8)';
  c.lineWidth = 3;
  c.beginPath();
  c.arc(SPRITE_W - 34, 36, 6, Math.PI, 0);
  c.stroke();
  c.fillStyle = c.strokeStyle;
  c.fillRect(SPRITE_W - 43, 36, 18, 13);

  // Role pill and region.
  c.font = `700 19px ${font}`;
  const textW = c.measureText(label.role).width;
  c.fillStyle = lit ? '#fa582d' : tone.pill;
  c.beginPath();
  c.roundRect(22, 124, textW + 30, 36, 18);
  c.fill();
  c.fillStyle = lit ? '#1b1d21' : tone.text;
  c.textBaseline = 'middle';
  c.fillText(label.role, 37, 143);
  c.font = `600 17px ${font}`;
  c.fillStyle = '#b4bac3';
  c.textAlign = 'right';
  c.fillText(label.region, SPRITE_W - 24, 143);
  c.textAlign = 'left';
}

function makeSprites(labels: CardLabel[], font: string) {
  const plain: HTMLCanvasElement[] = [];
  const lit: HTMLCanvasElement[] = [];
  labels.forEach((label, n) => {
    for (const seed of [0.15, 0.62, 0.93]) {
      for (const [list, on] of [[plain, false], [lit, true]] as const) {
        const canvas = document.createElement('canvas');
        canvas.width = SPRITE_W;
        canvas.height = SPRITE_H;
        const c = canvas.getContext('2d');
        if (!c) continue;
        drawCard(c, label, on, (seed + n * 0.37) % 1, font);
        list.push(canvas);
      }
    }
  });
  return { plain, lit };
}

function makeBeam() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 256;
  const c = canvas.getContext('2d');
  if (!c) return canvas;
  const up = c.createLinearGradient(0, 256, 0, 0);
  up.addColorStop(0, 'rgba(250,88,45,0.9)');
  up.addColorStop(0.35, 'rgba(250,88,45,0.35)');
  up.addColorStop(1, 'rgba(250,88,45,0)');
  const side = c.createLinearGradient(0, 0, 32, 0);
  side.addColorStop(0, 'rgba(0,0,0,1)');
  side.addColorStop(0.5, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(0,0,0,1)');
  c.fillStyle = up;
  c.fillRect(0, 0, 32, 256);
  c.globalCompositeOperation = 'destination-out';
  c.fillStyle = side;
  c.fillRect(0, 0, 32, 256);
  return canvas;
}

export function TileFloor({ labels, signal, anchor }: { labels: CardLabel[]; signal: RefObject<FloorSignal>; anchor: RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Rebuild only when the labels change, not when the parent re-renders with an equal list.
  const key = labels.map((l) => `${l.role}|${l.region}`).join(',');

  useEffect(() => {
    const labels = key.split(',').map((pair) => {
      const [role = '', region = ''] = pair.split('|');
      return { role, region };
    });
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d', { alpha: false });
    if (!canvas || !ctx || !key) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const isStill = () => reduced.matches || signal.current.still;
    let sprites = makeSprites(labels, getComputedStyle(canvas).fontFamily || 'sans-serif');
    const beam = makeBeam();
    let live = true;
    document.fonts?.ready.then(() => {
      if (!live) return;
      sprites = makeSprites(labels, getComputedStyle(canvas).fontFamily || 'sans-serif');
      signal.current.poke?.();
    });

    let W = 0;
    let H = 0;
    let dpr = 1;
    let horizon = 0.5;
    let focal = 0.78;
    let zMax = 24;
    let backdrop: CanvasGradient | null = null;
    let glow: CanvasGradient | null = null;
    let shade: CanvasGradient | null = null;
    let ax = 0; // anchor: where the name card stands, in canvas pixels
    let ay = 0;

    const locate = () => {
      const box = canvas.getBoundingClientRect();
      const slot = anchor.current?.getBoundingClientRect();
      if (slot && slot.width > 0) {
        ax = slot.left + slot.width / 2 - box.left;
        ay = slot.bottom - box.top + 34;
      } else {
        ax = W * 0.68;
        ay = H * 0.82;
      }
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      W = Math.max(1, rect.width);
      H = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      const narrow = W < 900;
      horizon = narrow ? 0.3 : 0.5;
      focal = narrow ? 0.62 : 0.78;
      const hy = H * horizon;
      backdrop = ctx.createLinearGradient(0, 0, 0, H);
      backdrop.addColorStop(0, '#111215');
      backdrop.addColorStop(horizon, '#1b1d21');
      backdrop.addColorStop(1, '#15171a');
      glow = ctx.createRadialGradient(W / 2, hy, 0, W / 2, hy, Math.max(W, H) * 0.7);
      glow.addColorStop(0, 'rgba(250,88,45,0.2)');
      glow.addColorStop(0.4, 'rgba(250,88,45,0.06)');
      glow.addColorStop(1, 'rgba(250,88,45,0)');
      // Far rows dissolve into the horizon instead of ending on a hard line.
      shade = ctx.createLinearGradient(0, hy, 0, hy + H * 0.14);
      shade.addColorStop(0, 'rgba(27,29,33,1)');
      shade.addColorStop(1, 'rgba(27,29,33,0)');
      locate();
      // Setting the size clears the canvas; draw now, or the page flashes black until the next frame.
      draw(performance.now());
    };

    let cam = 0;
    let camX = 0;
    let speed = 0.35;
    let energy = 0;
    let last = performance.now();
    let slow = 0;
    let raf = 0;
    let lastPing = 0;
    let settledAt = 0;
    let upSlot: [number, number, number, number] | null = null; // the empty slot, in canvas pixels, as last drawn

    const draw = (now: number) => {
      const s = signal.current;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const hy = H * horizon;
      const f = H * focal;
      const cx = W / 2;
      const still = isStill();
      const settle = s.phase === 'pick' || s.phase === 'up';

      // Where the name card stands, on the floor.
      const z0 = ay > hy + 12 ? (f * CAM_H) / (ay - hy) : 3;
      const x0 = ((ax - cx) * z0) / f;
      const wantX = settle ? x0 - Math.round(x0 / SX) * SX : 0;
      // The row the floor settles on, just ahead of the name card's spot (a little slack so a settled floor stays put).
      const row = () => Math.ceil((cam + z0) / SZ - 0.02);

      if (!still) {
        const typing = now - s.lastKey < 450;
        if (settle && !typing && !(s.busy && s.phase === 'pick')) {
          // Settle so a row of cards lies exactly under the name card's spot: the card it lifts out of.
          const snap = row() * SZ - z0;
          const step = (snap - cam) * (1 - Math.exp(-dt * 7));
          speed = step / Math.max(dt, 1e-3);
          cam += step;
          camX += (wantX - camX) * (1 - Math.exp(-dt * 7));
          const settled = Math.abs(snap - cam) < 0.006 && Math.abs(wantX - camX) < 0.006;
          settledAt = settled ? settledAt || now : 0;
        } else {
          const target = typing ? 4.5 : s.busy ? 0.5 : 0.35;
          speed += (target - speed) * (1 - Math.exp(-dt * (target > speed ? 7 : 2)));
          cam += speed * dt;
          camX += (wantX - camX) * (1 - Math.exp(-dt * 4));
          settledAt = 0;
        }
        energy += ((typing ? 1 : s.busy ? 0.5 : 0) - energy) * (1 - Math.exp(-dt * 4));
        if (s.busy && now - lastPing > 520) {
          s.ripples.push(now);
          lastPing = now;
        }
        s.ripples = s.ripples.filter((t) => now - t < 2200).slice(-6);
        // Slow machine: draw fewer far rows.
        slow = slow * 0.95 + (dt > 0.026 ? 1 : 0) * 0.05;
        if (slow > 0.6 && zMax > 12) {
          zMax -= 2;
          slow = 0;
        }
      } else {
        camX = wantX;
        cam = Math.round((cam + z0) / SZ) * SZ - z0;
        energy = 0;
        settledAt = settle ? Math.min(settledAt || Infinity, now - PICK_HOLD_MS) : 0;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = backdrop ?? '#1b1d21';
      ctx.fillRect(0, 0, W, H);

      const zMin = ((f * CAM_H) / (H - hy)) * 0.9;
      const zFade = zMax * 0.42;
      const kMin = Math.ceil((cam + zMin) / SZ);
      const kMax = Math.floor((cam + zMax) / SZ);
      const kSlot = row();
      const iSlot = Math.round((x0 - camX) / SX);
      const denied = now - s.deniedAt < 900;
      const ripples = still ? [] : s.ripples;
      let slotBox: [number, number, number, number] | null = null;
      let pickedSprite: HTMLCanvasElement | null = null;
      const bucket = Math.floor(now / 140);

      for (let k = kMax; k >= kMin; k--) {
        const z = k * SZ - cam;
        const fog = z > zFade ? Math.max(0, 1 - (z - zFade) / (zMax - zFade)) : 1;
        if (fog <= 0.02) continue;
        const scale = f / z;
        const yNear = hy + (f * CAM_H) / (z - TD / 2);
        const yFar = hy + (f * CAM_H) / (z + TD / 2);
        const th = yNear - yFar;
        const tw = TW * scale;
        const half = (cx + tw) / scale;
        const iMin = Math.ceil((-half - camX) / SX);
        const iMax = Math.floor((half - camX) / SX);
        for (let i = iMin; i <= iMax; i++) {
          const wx = i * SX + camX;
          const x = cx + wx * scale - tw / 2;
          const h = hash(i, k);
          if (settle && i === iSlot && k === kSlot) {
            slotBox = [x, yFar, tw, th];
            pickedSprite = sprites.lit[Math.floor(h * 997) % sprites.lit.length] ?? null;
            continue;
          }
          let lift = 0;
          let heat = 0;
          for (const t of ripples) {
            const age = (now - t) / 1000;
            const d = Math.hypot(wx - x0, z - z0) - age * 5.5;
            const a = Math.exp(-(d * d) / 0.12) * Math.exp(-age / 0.9);
            lift += a * 0.07;
            heat = Math.max(heat, a);
          }
          if (energy > 0.01) lift += 0.022 * energy * (0.5 + 0.5 * Math.sin(now * 0.008 + h * 40));
          const sparkle = energy > 0.05 && hash(i, k, bucket) < 0.03 * energy;
          const lit = h > 0.965 || sparkle || heat > 0.45;
          const y = yFar - lift * scale;
          ctx.globalAlpha = fog;
          if (tw < 14) {
            ctx.fillStyle = lit ? '#fa582d' : 'rgba(255,255,255,0.1)';
            ctx.fillRect(x, y, tw, Math.max(1, th));
            continue;
          }
          const pool = lit ? sprites.lit : sprites.plain;
          const sprite = pool[Math.floor(h * 997) % pool.length];
          if (sprite) ctx.drawImage(sprite, x, y, tw, th);
          if (h > 0.965 && z < zMax * 0.6) {
            const pulse = still ? 0.4 : 0.3 + 0.2 * Math.sin(now * 0.002 + h * 60);
            ctx.globalAlpha = fog * pulse;
            const bh = 0.9 * scale;
            ctx.drawImage(beam, x + tw * 0.3, y + th * 0.4 - bh, tw * 0.4, bh);
          }
        }
      }

      upSlot = s.phase === 'up' ? slotBox : null;
      ctx.globalAlpha = 1;
      ctx.fillStyle = shade ?? 'transparent';
      ctx.fillRect(0, hy - 1, W, H * 0.14 + 1);
      ctx.fillStyle = glow ?? 'transparent';
      ctx.fillRect(0, 0, W, H);

      if (slotBox) {
        const [x, y, tw, th] = slotBox;
        if (s.phase === 'pick') {
          // The chosen card: lit and stirring in its place, with light under it, until the name card stands up out of it.
          const t = settledAt ? Math.min(1, (now - settledAt) / PICK_HOLD_MS) : 0;
          const lift = (still ? 0.004 : 0.003 + 0.004 * t + 0.003 * Math.sin(now * 0.012)) * (f / (kSlot * SZ - cam));
          ctx.globalAlpha = 0.5 + 0.4 * t;
          ctx.drawImage(beam, x + tw * 0.2, y - th * 3, tw * 0.6, th * 3.6);
          ctx.globalAlpha = 1;
          if (pickedSprite) ctx.drawImage(pickedSprite, x, y - lift, tw, th);
          if (settledAt && now - settledAt >= PICK_HOLD_MS && !s.picked) {
            s.picked = true;
            const box = canvas.getBoundingClientRect();
            s.onPicked?.({ left: box.left + x, top: box.top + y - lift, width: tw, height: th });
          }
        } else {
          // The empty slot the name card came out of, with light rising to the card.
          ctx.fillStyle = 'rgba(8,9,10,0.85)';
          ctx.beginPath();
          ctx.roundRect(x, y, tw, th, Math.min(10, th / 4));
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = denied ? '#ff8f7a' : '#fa582d';
          ctx.stroke();
          ctx.globalAlpha = still ? 0.6 : 0.55 + 0.25 * Math.sin(now * 0.004);
          const top = Math.min(ay - 34, y + th * 0.5) - 90;
          ctx.drawImage(beam, x + tw * 0.15, top, tw * 0.7, y + th * 0.6 - top);
          ctx.globalAlpha = 1;
        }
      }
    };

    const loop = (now: number) => {
      draw(now);
      if (isStill()) start();
      else raf = requestAnimationFrame(loop);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      if (isStill()) {
        signal.current.poke = () => {
          if (!isStill()) return start();
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(draw);
        };
        signal.current.poke();
      } else {
        signal.current.poke = undefined;
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };

    // Moving the window to a screen with another pixel density changes no CSS size, so watch the density too.
    let density: MediaQueryList | null = null;
    const onDensity = () => {
      density?.removeEventListener('change', onDensity);
      density = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      density.addEventListener('change', onDensity);
      resize();
    };

    signal.current.slot = () => {
      if (!upSlot) return null;
      const [x, y, tw, th] = upSlot;
      const box = canvas.getBoundingClientRect();
      return { left: box.left + x, top: box.top + y, width: tw, height: th };
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const relocate = window.setInterval(locate, 1000);
    reduced.addEventListener('change', start);
    onDensity();
    start();
    return () => {
      live = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.clearInterval(relocate);
      reduced.removeEventListener('change', start);
      density?.removeEventListener('change', onDensity);
      signal.current.poke = undefined;
      signal.current.slot = undefined;
    };
  }, [key, signal, anchor]);

  // biome-ignore lint/a11y/noAriaHiddenOnFocusable: decorative background canvas; it never takes focus
  return <canvas ref={ref} className="tile-floor" aria-hidden="true" />;
}
