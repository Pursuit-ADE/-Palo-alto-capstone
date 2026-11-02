// The ask panel's rules that need no browser to test (UX review, Nov 2).
import { CONVERSATION_KEY } from './auth-form';

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

/** A kept conversation older than a session (SESSION_HOURS, src/server/auth.ts) isn't put back. */
const CONVERSATION_MS = 8 * 3_600_000;
/** Bump when a turn's shape changes in a way an older kept copy couldn't render. */
const CONVERSATION_VERSION = 1;

export interface KeptConversation<T> {
  turns: T[];
  dropped: number;
  previous: unknown;
}

/**
 * Whose a kept conversation is: the user and the scope the server applied to them on this page load. A promotion or a
 * demotion changes the scope, and answers from the old scope must not come back (UX review, Nov 2, D1).
 */
export const conversationOwner = (user: string, scope: string) => JSON.stringify([user, scope]);

/**
 * Keeps the conversation in this tab (sessionStorage), so a reload or a trip to /trends and back doesn't lose it (BH 7,
 * REC). Answers are what the server already sent this user in this scope, and follow-ups still go through the server's
 * scope checks. Too big to keep means not kept, rather than an old copy.
 */
export function saveConversation<T>(store: KeepStore | null, owner: string, conversation: KeptConversation<T>, now = Date.now()): void {
  try {
    store?.setItem(CONVERSATION_KEY, JSON.stringify({ owner, version: CONVERSATION_VERSION, at: now, ...conversation }));
  } catch {
    try {
      store?.removeItem(CONVERSATION_KEY);
    } catch {}
  }
}

/** A kept turn the panel can render: an id, the question, and a reply of a known kind (or none). */
function isTurn(t: unknown): boolean {
  if (!t || typeof t !== 'object') return false;
  const { id, question, result } = t as Record<string, unknown>;
  if (typeof id !== 'number' || typeof question !== 'string') return false;
  if (result === null) return true;
  const kind = (result as { kind?: unknown } | undefined)?.kind;
  return typeof kind === 'string' && ['answer', 'explanation', 'clarify', 'unsupported', 'refused'].includes(kind);
}

/**
 * This owner's kept conversation, or null. Another user's or another scope's, a stale one, one from an older version or
 * a malformed one is removed, not shown.
 */
export function loadConversation<T>(store: KeepStore | null, owner: string, now = Date.now()): KeptConversation<T> | null {
  try {
    const raw = store?.getItem(CONVERSATION_KEY);
    if (!raw) return null;
    const kept = JSON.parse(raw) as Record<string, unknown> | null;
    const fresh = kept?.owner === owner && kept.version === CONVERSATION_VERSION && typeof kept.at === 'number' && now >= kept.at && now - kept.at <= CONVERSATION_MS;
    if (!kept || !fresh || !Array.isArray(kept.turns) || !kept.turns.every(isTurn) || typeof kept.dropped !== 'number') {
      store?.removeItem(CONVERSATION_KEY);
      return null;
    }
    return { turns: kept.turns as T[], dropped: kept.dropped, previous: kept.previous ?? null };
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

/**
 * Whether a new turn needs scrolling to (row 6): it starts above the window, or it runs past the bottom and starts lower
 * than the top quarter. A turn that fits where it is, or starts near the top, stays put.
 */
export function offScreen(turn: { top: number; bottom: number }, viewport: number): boolean {
  return turn.top < 0 || (turn.bottom > viewport && turn.top > viewport * 0.25);
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
