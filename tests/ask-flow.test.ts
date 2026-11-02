// The ask panel's browser-free rules (app/ask-flow.ts), from the UX review of Nov 2.
import { describe, expect, it } from 'vitest';
import { addTurn, MAX_TURNS_SHOWN } from '../app/ask-flow';

describe('the turn cap (REC)', () => {
  it('keeps the last MAX_TURNS_SHOWN turns and counts the ones that drop off', () => {
    let shown = { turns: [] as number[], dropped: 0 };
    for (let i = 1; i <= MAX_TURNS_SHOWN; i++) shown = addTurn(shown, i);
    expect(shown).toEqual({ turns: Array.from({ length: MAX_TURNS_SHOWN }, (_, i) => i + 1), dropped: 0 });
    shown = addTurn(shown, MAX_TURNS_SHOWN + 1);
    shown = addTurn(shown, MAX_TURNS_SHOWN + 2);
    expect(shown.turns).toHaveLength(MAX_TURNS_SHOWN);
    expect(shown.turns[0]).toBe(3);
    expect(shown.turns.at(-1)).toBe(MAX_TURNS_SHOWN + 2);
    expect(shown.dropped).toBe(2);
  });
});
