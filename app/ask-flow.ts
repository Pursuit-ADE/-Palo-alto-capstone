// The ask panel's rules that need no browser to test (UX review, Nov 2).

/** The panel shows at most this many turns. Older ones drop off the page; follow-ups only use the last answer anyway. */
export const MAX_TURNS_SHOWN = 20;

/** Adds a turn, keeps the last MAX_TURNS_SHOWN, and counts how many have dropped off, so the panel can say so. */
export function addTurn<T>(shown: { turns: T[]; dropped: number }, turn: T): { turns: T[]; dropped: number } {
  const all = [...shown.turns, turn];
  const over = Math.max(0, all.length - MAX_TURNS_SHOWN);
  return { turns: all.slice(over), dropped: shown.dropped + over };
}

const KEPT = 'copilot.unsent-question';
/** A kept question older than this isn't put back: it belongs to a sign-in that never happened. */
const KEEP_MS = 30 * 60_000;

type KeepStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Keeps a question the server turned away because the session ended, in this tab only (sessionStorage), so it's back in
 * the box after signing in again (row 7). It's tied to the user id: someone else signing in on the same tab doesn't get it.
 */
export function keepQuestion(store: KeepStore | null, user: string, question: string, now = Date.now()): void {
  try {
    store?.setItem(KEPT, JSON.stringify({ user, question, at: now }));
  } catch {}
}

/** The kept question for this user, once: reading it removes it. Null if there's none, it's someone else's, or it's stale. */
export function takeKeptQuestion(store: KeepStore | null, user: string, now = Date.now()): string | null {
  try {
    const raw = store?.getItem(KEPT);
    if (!raw) return null;
    store?.removeItem(KEPT);
    const kept: unknown = JSON.parse(raw);
    if (!kept || typeof kept !== 'object') return null;
    const { user: owner, question, at } = kept as Record<string, unknown>;
    if (owner !== user || typeof question !== 'string' || typeof at !== 'number' || now < at || now - at > KEEP_MS) return null;
    return question;
  } catch {
    return null;
  }
}

/** sessionStorage, or null where the browser blocks it (some private modes throw on access). */
export function tabStore(): KeepStore | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** After this long the waiting line says it's slow. The model's own limit is 8 s by default (src/semantic/model.ts). */
export const SLOW_MS = 15_000;
/** After this long the panel stops waiting. CLAUDE_TIMEOUT_MS is at most 60 s, so a working server has answered by then. */
export const GIVE_UP_MS = 90_000;

export class AskTimeout extends Error {}

/** The reply, or an AskTimeout after `ms`. The request itself isn't cancelled; a reply that comes later is dropped. */
export function withTimeout<T>(reply: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new AskTimeout()), ms);
    reply.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
