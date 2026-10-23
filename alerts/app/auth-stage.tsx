'use client';

// Interactive sign-in. Behind the form is a floor of anonymous glass identity cards. While someone types a username
// the cards rush and ripple; when they pause, one card under the name card's spot lights up and lifts out of the
// floor as the name card. Clicking the card submits the form. The card is built in the browser from what was typed
// and nothing else: no lookup, so it rises for any name and never tells anyone whether an account exists.
import { useActionState, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { logInAction, signUpAction, type AuthState } from './auth-actions';
import { AuthForm, formAction, type InviteField } from './auth-form';
import { TILE_ASPECT, TileFloor, newFloorSignal, type CardLabel, type FloorPhase, type ScreenRect } from './tile-floor';
import './auth-stage.css';

/** What the page may show before sign-in: how the product is built, never data. See auth-info.ts. */
export type StageInfo = {
  product: string;
  hub: { title: string; sources: string[]; count: number; unit: string; items: string[] };
  promises: string[];
  cards: CardLabel[];
};

const FORM_ID = 'auth-form';
const STILL_KEY = 'auth-stage-still'; // remembers "Pause motion" in this browser
const PAUSE_MS = 550; // typing pause before the floor picks a card
const MIN_CHARS = 3; // the username field's minimum, so the card only rises for a name the form accepts

const parts = (username: string) => username.trim().split(/[._\-\s]+/).filter(Boolean);
const displayName = (username: string) => parts(username).slice(0, 3).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
const initials = (username: string) => parts(username).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// The name card's moves are one transform shape (move, size, perspective, tilt about its bottom edge), so every keyframe
// blends smoothly into the next. Lying down it has next to no perspective, so it is drawn square-cornered like the floor's
// own cards; the perspective deepens as it stands up.
const DEPTH = 900; // perspective standing, px
const FLAT_DEPTH = 100000; // perspective lying
const pose = (x: number, y: number, sx: number, sy: number, tilt: number, depth = DEPTH) => `translate(${x}px, ${y}px) scale(${sx}, ${sy}) perspective(${depth}px) rotateX(${tilt}deg)`;
type Lie = { x: number; y: number; sx: number; sy: number; tilt: number };
const STAND_MS = 1250;
const SWING = 0.6; // when the stand-up has swung furthest past upright, as a fraction of STAND_MS
const sourceList = (sources: string[]) => new Intl.ListFormat('en', { type: 'conjunction' }).format(sources);

function Hub({ info }: { info: StageInfo }) {
  const { title, sources, count, unit, items } = info.hub;
  const width = 560;
  const chip = Math.min(128, width / sources.length - 14);
  return (
    <figure className="auth-hub">
      <svg viewBox="0 0 560 252" aria-hidden="true" focusable="false">
        {sources.map((source, i) => {
          const x = (width * (i + 0.5)) / sources.length;
          const d = `M ${x} 44 C ${x} 118, 280 104, 280 150`;
          return (
            <g key={source} className="hub-source">
              <path className="hub-track" d={d} />
              <path className="hub-flow" d={d} style={{ animationDelay: `${-i * 0.41}s` }} />
              <rect x={x - chip / 2} y={12} width={chip} height={32} rx={16} />
              <text x={x} y={32.5}>{source}</text>
            </g>
          );
        })}
        <circle className="hub-halo" cx="280" cy="196" r="60" />
        <circle className="hub-core" cx="280" cy="196" r="46" />
        <text className="hub-count" x="280" y="209">{count}</text>
      </svg>
      <figcaption>
        <span className="visually-hidden">Built from {sourceList(sources)}.</span>
        <strong>{count} {unit}</strong>
        <span className="hub-title">{title}</span>
        <ul className="hub-items">{items.map((item) => <li key={item}>{item}</li>)}</ul>
        <ul className="hub-promises">{info.promises.map((p) => <li key={p}>{p}</li>)}</ul>
      </figcaption>
    </figure>
  );
}

export function AuthStage({ mode, info, badge, title, intro, foot, signupEnabled = true, disabledNote }: {
  mode: 'login' | 'signup';
  info: StageInfo;
  badge: ReactNode;
  title: string;
  intro: string;
  foot: ReactNode;
  signupEnabled?: boolean;
  disabledNote?: string;
}) {
  const [loginState, loginAction, loginPending] = useActionState<AuthState, FormData>(logInAction, null);
  const [signupState, signupAction, signupPending] = useActionState<AuthState, FormData>(signUpAction, null);
  const enabled = mode === 'login' || signupEnabled;
  // The log-in page carries the invite code box too: filled in, the same form creates the account instead.
  const invite: InviteField = mode === 'signup' ? 'required' : signupEnabled ? 'optional' : 'off';
  const [username, setUsername] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [ready, setReady] = useState(false);
  const [typing, setTyping] = useState(false);
  const [phase, setPhase] = useState<FloorPhase>('idle');
  const [sinking, setSinking] = useState(false);
  const [error, setError] = useState<string>();
  const [denied, setDenied] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [still, setStill] = useState(false);
  const hasInvite = inviteCode.trim() !== '';
  const action = formAction(mode, inviteCode, { logIn: loginAction, signUp: signupAction });
  const creating = action === signupAction; // the button, the card and the password rules follow the action posted
  const pending = loginPending || signupPending;

  const signal = useRef(newFloorSignal());
  const slot = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLButtonElement>(null);
  const stillRef = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const phaseRef = useRef<FloorPhase>('idle');
  const usernameRef = useRef('');
  const from = useRef<ScreenRect | null>(null);
  const rising = useRef<Animation[]>([]);
  const standing = useRef(false); // phase 'up' has been drawn, so there is a card to lay back down
  const typingTimer = useRef<number | undefined>(undefined);
  const pauseTimer = useRef<number | undefined>(undefined);

  const go = (next: FloorPhase) => {
    if (next !== 'up') standing.current = false;
    phaseRef.current = next;
    signal.current.phase = next;
    if (next === 'pick') signal.current.picked = false;
    signal.current.poke?.();
    setPhase(next);
  };

  const calm = () => stillRef.current || prefersReducedMotion();

  // Pause motion: the floor stops and draws only on change, and the CSS animations stop, as with reduced motion.
  const pause = (next: boolean) => {
    stillRef.current = next;
    signal.current.still = next;
    signal.current.poke?.();
    setStill(next);
    if (!next) return;
    // A stand-up under way jumps to its end, and a lie-down under way ends hidden, as if they had happened without motion.
    rising.current.forEach((a) => a.playState === 'running' && a.finish());
    setSinking(false);
  };
  const togglePause = () => {
    pause(!stillRef.current);
    try {
      localStorage.setItem(STILL_KEY, stillRef.current ? '1' : '0');
    } catch {}
  };
  useEffect(() => {
    try {
      if (localStorage.getItem(STILL_KEY) === '1') pause(true);
    } catch {}
  }, []);

  // The floor says where the chosen card lies; the name card lifts out of exactly that spot.
  useEffect(() => {
    signal.current.onPicked = (rect) => {
      if (phaseRef.current !== 'pick') return;
      from.current = rect;
      go('up');
    };
  }, []);

  useEffect(() => {
    signal.current.busy = pending;
    signal.current.poke?.();
  }, [pending]);

  // Where the card lies on the floor: over the floor card, edge to edge, tilted back as far as the floor is seen (a floor
  // card looks shallower than it is by the cosine of that angle), and stretched to the floor card's depth, because the
  // name card is a wider shape than a floor card.
  const lying = (rect: ScreenRect): Lie => {
    const to = slot.current!.getBoundingClientRect(); // the card's own place, whatever it is doing now
    const tilt = Math.acos(Math.min(1, Math.max(0.2, rect.height / rect.width / TILE_ASPECT)));
    const deep = (to.height * Math.cos(tilt) * FLAT_DEPTH) / (FLAT_DEPTH + to.height * Math.sin(tilt)); // its height, tilted, unscaled
    return {
      x: rect.left + rect.width / 2 - (to.left + to.width / 2),
      y: rect.top + rect.height - to.bottom,
      sx: rect.width / to.width,
      sy: rect.height / deep,
      tilt: (tilt * 180) / Math.PI,
    };
  };

  // Rise: the card lies flat in the floor card's place, then stands up around its bottom edge, slowly at first, swinging a
  // little past upright before it settles, while the name fades in.
  useLayoutEffect(() => {
    const el = card.current;
    const rect = from.current;
    if (phase !== 'up' || !el) return;
    from.current = null;
    standing.current = true;
    rising.current.forEach((a) => a.cancel());
    rising.current = [];
    if (!rect || calm()) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
      return;
    }
    const { x, y, sx, sy, tilt } = lying(rect);
    // fill: backwards holds the flat pose when an edit plays the rise in reverse (see Sink).
    const stand = el.animate(
      [
        { transform: pose(x, y, sx, sy, tilt, FLAT_DEPTH), easing: 'cubic-bezier(.4, 0, .3, 1)' },
        { transform: pose(x * 0.08, y * 0.08 - 14, 1.015, 1.015, -7), offset: SWING, easing: 'cubic-bezier(.45, 0, .55, 1)' },
        { transform: pose(0, -2, 1.003, 1.003, 2.5), offset: 0.8, easing: 'cubic-bezier(.3, 0, .4, 1)' },
        { transform: pose(0, 0, 1, 1, 0) },
      ],
      { duration: STAND_MS, fill: 'backwards' },
    );
    const name = el.querySelector('.hero-content')?.animate([{ opacity: 0.5, easing: 'ease-in-out' }, { opacity: 1, offset: 0.55 }, { opacity: 1 }], { duration: STAND_MS, fill: 'backwards' });
    rising.current = name ? [stand, name] : [stand];
  }, [phase]);

  // Sink: editing the username after the card is up lays it back down in the floor card's place, and the floor searches again.
  useLayoutEffect(() => {
    const el = card.current;
    if (!sinking || !el) return;
    const stand = rising.current.filter((a) => a.playState === 'running');
    if (calm()) {
      stand.forEach((a) => a.cancel());
      setSinking(false);
      return;
    }
    // Where it lies down: measured now, before the floor moves on, rather than when it stood up (the window may have
    // changed since, and the floor with it).
    const slotRect = signal.current.slot?.();
    const { x, y, sx, sy, tilt } = slotRect ? lying(slotRect) : { x: 0, y: 60, sx: 0.55, sy: 0.55, tilt: 56 };
    let anims: Animation[] = [];
    let over = false;
    const play = (list: Animation[], then: () => void) => {
      anims = list;
      Promise.all(list.map((a) => a.finished)).then(() => over || then(), () => {});
    };
    const lieDown = () => {
      if (calm()) return setSinking(false);
      play([el.animate(
        [
          { transform: pose(0, 0, 1, 1, 0), opacity: 1, easing: 'cubic-bezier(.5, 0, .75, .4)' },
          { transform: pose(x, y, sx, sy, tilt, FLAT_DEPTH), opacity: 0.6, offset: 0.85 },
          { transform: pose(x, y, sx, sy, tilt, FLAT_DEPTH), opacity: 0 },
        ],
        { duration: 340, fill: 'forwards' },
      )], () => setSinking(false));
    };
    const t = stand[0]?.currentTime;
    const at = typeof t === 'number' ? t : 0;
    if (stand.length && at < STAND_MS * SWING) {
      // Edited while it was still standing up: it lies back down the way it came, faster, and fades out.
      stand.forEach((a) => a.updatePlaybackRate(-2.5));
      play([...stand, el.animate([{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: at / 2.5, fill: 'forwards' })], () => setSinking(false));
    } else if (stand.length) {
      // Past its swing it already looks upright: it settles, quickly, then lies down from there.
      stand.forEach((a) => a.updatePlaybackRate(4));
      play(stand, lieDown);
    } else lieDown();
    // Let go of the held poses in the same commit that hides the card, so it never shows upright for a frame.
    return () => {
      over = true;
      anims.forEach((a) => a.cancel());
    };
  }, [sinking]);

  // A refused attempt: the card shakes and its slot flashes. Same for a wrong username and a wrong password.
  const refuse = (state: AuthState) => {
    if (!state) return;
    setError(state.error);
    if (!state.error) return;
    signal.current.deniedAt = performance.now();
    signal.current.poke?.();
    // When still, the floor draws only on request: redraw once the slot's error flash is over.
    window.setTimeout(() => signal.current.poke?.(), 950);
    setDenied((n) => n + 1);
    setAttempt((n) => n + 1);
  };
  useEffect(() => refuse(loginState), [loginState]);
  useEffect(() => refuse(signupState), [signupState]);
  useEffect(() => {
    if (!denied) return;
    const t = window.setTimeout(() => setDenied(0), 700);
    return () => window.clearTimeout(t);
  }, [denied]);

  useEffect(() => () => {
    window.clearTimeout(typingTimer.current);
    window.clearTimeout(pauseTimer.current);
  }, []);

  // Whether the form would pass the browser's checks, so the card can say what is still missing. Rechecked after
  // render too, because filling in the invite code raises the password's minimum length.
  const recheck = () => setReady(Boolean(form.current?.checkValidity()));
  useLayoutEffect(recheck, [hasInvite]);

  const onUsername = (value: string) => {
    usernameRef.current = value;
    setUsername(value);
    const now = performance.now();
    signal.current.lastKey = now;
    signal.current.ripples = [...signal.current.ripples.slice(-5), now];
    setTyping(true);
    window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => setTyping(false), 450);
    if (standing.current) setSinking(true);
    go(value.trim() ? 'search' : 'idle');
    window.clearTimeout(pauseTimer.current);
    if (value.trim().length >= MIN_CHARS) pauseTimer.current = window.setTimeout(() => go('pick'), PAUSE_MS);
  };

  // Text can reach the fields without a change event: typed before hydration, or filled by a password manager or a
  // script. Pick it up on mount and on any input in the form, so the card and the form's mode always match the fields.
  const field = (name: string) => {
    const el = form.current?.elements.namedItem(name);
    return el instanceof HTMLInputElement ? el : undefined;
  };
  useEffect(() => {
    const value = field('username')?.value;
    if (value) onUsername(value);
    setInviteCode(field('invite')?.value ?? '');
  }, []);

  const onInput = () => {
    const invite = field('invite');
    if (invite) setInviteCode(invite.value);
    const value = field('username')?.value;
    if (value !== undefined && value !== usernameRef.current) onUsername(value);
    recheck();
  };
  // React resets the form after each attempt: the password empties; the username and invite code stay (their defaultValue).
  const onReset = () => setReady(false);

  const up = enabled && phase === 'up';
  const shown = up || sinking;
  const cta = pending
    ? creating ? 'Creating account…' : 'Signing in…'
    : ready
      ? creating ? 'Click to create account' : 'Click to sign in'
      : !creating ? 'Enter your password' : mode === 'signup' ? 'Add a password (12+) and invite code' : 'Add a password (12+ characters)';
  const classes = ['hero-card', !shown && 'is-hidden', typing && 'is-typing', pending && 'is-busy', denied > 0 && 'is-denied', ready && 'is-ready'];

  return (
    <main className={`auth-stage${typing || pending ? ' is-active' : ''}${still ? ' is-still' : ''}`}>
      <TileFloor labels={info.cards} signal={signal} anchor={slot} />
      <div className="auth-stage-inner">
        <header className="auth-top">
          <span className="mark" aria-hidden="true" />
          <div className="auth-brand">
            <strong>{info.product}</strong>
            <span>Team ALTO PALS</span>
          </div>
          <button type="button" className="motion-toggle" onClick={togglePause}>
            <span className={still ? 'icon-play' : 'icon-pause'} aria-hidden="true" />
            <span className="motion-label">{still ? 'Play motion' : 'Pause motion'}</span>
          </button>
          {badge}
        </header>
        <section className="auth-panel" aria-labelledby="auth-title">
          <div className="page-head">
            <h1 id="auth-title">{title}</h1>
            <p>{intro}</p>
          </div>
          {enabled ? (
            <AuthForm
              ref={form}
              id={FORM_ID}
              invite={invite}
              creating={creating}
              action={action}
              pending={pending}
              error={error}
              errorKey={attempt}
              username={username}
              inviteCode={inviteCode}
              onUsername={onUsername}
              onInput={onInput}
              onReset={onReset}
            />
          ) : (
            <p className="auth-error">{disabledNote}</p>
          )}
          <p className="hint">{foot}</p>
        </section>
        <div className="auth-side">
          <Hub info={info} />
          <div className="hero-slot" ref={slot}>
            {/* A second way to submit, for the pointer. Keyboard and screen-reader users have the form's own button; preventDefault
                on mouse down keeps focus in the form rather than on this hidden button. */}
            <button ref={card} type="submit" form={FORM_ID} tabIndex={-1} aria-hidden="true" disabled={!up || pending} className={classes.filter(Boolean).join(' ')} onMouseDown={(e) => e.preventDefault()}>
              <span className="hero-content">
                <span className="hero-avatar">{initials(username)}</span>
                <span className="hero-id">
                  <span className="hero-name">{displayName(username) || username}</span>
                  <span className="hero-handle">@{username.trim().toLowerCase()}</span>
                </span>
                <span className="hero-pills">
                  <span>{creating ? 'New account' : 'Demo account'}</span>
                  <span>{creating ? 'Role comes from your invite' : 'Role and scope load after sign-in'}</span>
                </span>
                <span className="hero-cta">
                  {cta}
                  <span aria-hidden="true">→</span>
                </span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
