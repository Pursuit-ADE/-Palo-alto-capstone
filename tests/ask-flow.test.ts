// The ask panel's browser-free rules (app/ask-flow.ts), from the UX review of Nov 2.
import { describe, expect, it, vi } from 'vitest';
import { addTurn, AskTimeout, GIVE_UP_MS, keepQuestion, MAX_TURNS_SHOWN, SLOW_MS, takeKeptQuestion, withTimeout } from '../app/ask-flow';

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

describe('the question kept across a new sign-in (row 7)', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), size: () => m.size };
  };

  it('gives the question back once, to the same user, within half an hour', () => {
    const store = memory();
    keepQuestion(store, 'u_ts_west', 'open pipeline by stage', 1_000);
    expect(takeKeptQuestion(store, 'u_ts_west', 1_000 + 29 * 60_000)).toBe('open pipeline by stage');
    expect(takeKeptQuestion(store, 'u_ts_west', 1_000 + 29 * 60_000)).toBeNull(); // taken once
  });

  it("doesn't give it to someone else signing in on the same tab, or after half an hour, and drops it either way", () => {
    const store = memory();
    keepQuestion(store, 'u_ts_west', 'q', 0);
    expect(takeKeptQuestion(store, 'u_ts_east', 1)).toBeNull();
    expect(store.size()).toBe(0);
    keepQuestion(store, 'u_ts_west', 'q', 0);
    expect(takeKeptQuestion(store, 'u_ts_west', 31 * 60_000)).toBeNull();
    expect(store.size()).toBe(0);
  });

  it('survives storage that throws or holds something else', () => {
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => {} };
    expect(() => keepQuestion(throwing, 'u', 'q')).not.toThrow();
    expect(takeKeptQuestion(throwing, 'u')).toBeNull();
    expect(takeKeptQuestion(null, 'u')).toBeNull();
    const store = memory();
    store.setItem('copilot.unsent-question', 'not json');
    expect(takeKeptQuestion(store, 'u')).toBeNull();
    store.setItem('copilot.unsent-question', JSON.stringify({ user: 'u', question: 42, at: 0 }));
    expect(takeKeptQuestion(store, 'u', 1)).toBeNull();
  });
});

describe('a reply that never comes (REC)', () => {
  it('stops waiting after the limit, and passes a reply or an error through before it', async () => {
    vi.useFakeTimers();
    try {
      const never = withTimeout(new Promise<string>(() => {}), GIVE_UP_MS);
      const caught = never.catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(GIVE_UP_MS);
      expect(await caught).toBeInstanceOf(AskTimeout);

      await expect(withTimeout(Promise.resolve('answer'), GIVE_UP_MS)).resolves.toBe('answer');
      const offline = new TypeError('Failed to fetch');
      await expect(withTimeout(Promise.reject(offline), GIVE_UP_MS)).rejects.toBe(offline);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives a working server its whole model time limit first', () => {
    // CLAUDE_TIMEOUT_MS is capped at 60 s (src/semantic/model.ts); the slow notice comes well before the limit.
    expect(GIVE_UP_MS).toBeGreaterThan(60_000);
    expect(SLOW_MS).toBeLessThan(GIVE_UP_MS);
  });
});
