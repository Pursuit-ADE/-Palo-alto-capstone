// The ask panel's rules that need no browser to test (UX review, Nov 2).

/** The panel shows at most this many turns. Older ones drop off the page; follow-ups only use the last answer anyway. */
export const MAX_TURNS_SHOWN = 20;

/** Adds a turn, keeps the last MAX_TURNS_SHOWN, and counts how many have dropped off, so the panel can say so. */
export function addTurn<T>(shown: { turns: T[]; dropped: number }, turn: T): { turns: T[]; dropped: number } {
  const all = [...shown.turns, turn];
  const over = Math.max(0, all.length - MAX_TURNS_SHOWN);
  return { turns: all.slice(over), dropped: shown.dropped + over };
}
