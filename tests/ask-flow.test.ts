// The ask panel's browser-free rules (app/ask-flow.ts), from the UX review of Nov 2.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { addTurn, AskTimeout, conversationOwner, GIVE_UP_MS, keepQuestion, loadConversation, MAX_TURNS_SHOWN, offScreen, saveConversation, SLOW_MS, takeKeptQuestion, withTimeout } from '../app/ask-flow';
import { CONVERSATION_KEY } from '../app/auth-form';

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

describe('scrolling to a new turn (row 6)', () => {
  it('scrolls when the turn starts above the window or runs off the bottom from low down, and not when it fits', () => {
    expect(offScreen({ top: -3700, bottom: -2900 }, 768)).toBe(true); // the old case: the answer started far above
    expect(offScreen({ top: 542, bottom: 1543 }, 768)).toBe(true); // measured on the branch: most of it below the fold
    expect(offScreen({ top: 900, bottom: 1400 }, 768)).toBe(true); // entirely below
    expect(offScreen({ top: 562, bottom: 700 }, 768)).toBe(false); // short, fits where it is
    expect(offScreen({ top: 59, bottom: 2000 }, 768)).toBe(false); // starts near the top: reading down is natural
  });
});

// A kept answer with every field the panel reads, and kept turns it can't render (checked per kind).
const answer = {
  kind: 'answer',
  narrative: 'Open pipeline is $1,004,925.',
  scope: "West region, Celia Rouche's team (6 reps)",
  intent: { metric: 'open_pipeline', filters: {}, groupBy: [] },
  rows: [{ value: 1004925 }],
  metric: { id: 'open_pipeline', name: 'Open pipeline', unit: 'usd', version: 1 },
  filters: { groupBy: [], regions: ['west'] },
  provenance: { asOfDate: '2026-10-08', snapshotId: 'snap' },
};

const hollow = [
  'nope',
  [{ id: 1, question: 'q', result: { kind: 'something else' } }],
  [{ id: '1', question: 'q', result: null }],
  [{ id: 1, question: 'hollow', result: { kind: 'answer' } }], // passed the first check, then crashed AnswerView (R4)
  [{ id: 1, question: 'q', result: { ...answer, metric: { name: 'Open pipeline' } } }],
  [{ id: 1, question: 'q', result: { kind: 'explanation', answer: { kind: 'answer' }, other: null, summary: 's', reasons: [], checks: [] } }],
  [{ id: 1, question: 'q', result: { kind: 'clarify' } }],
  // The explanation panel reads the answer's intent (review, R4).
  [{ id: 1, question: 'q', result: { kind: 'explanation', answer: { ...answer, intent: undefined }, other: null, summary: 's', reasons: [], checks: [] } }],
  [{ id: 1, question: 'q', result: { ...answer, rows: [null] } }],
  [{ id: 1, question: 'q', result: { ...answer, chart: { data: {} } } }],
  [{ id: 1, question: 'q', result: { ...answer, chart: { data: { values: [] } } } }], // no encoding.y.field for the bars
];

describe('the conversation kept in the tab (BH 7, REC)', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), size: () => m.size };
  };
  const conversation = {
    turns: [
      { id: 1, question: 'open pipeline', result: answer },
      { id: 2, question: 'why is mine different?', result: { kind: 'explanation', answer, other: null, summary: 'One figure.', reasons: [], checks: [] } },
      { id: 3, question: 'coverage', result: { kind: 'clarify', question: 'Which quarter?' } },
      { id: 4, question: 'East?', result: { kind: 'refused', message: 'No access.' } },
      { id: 5, question: 'q', result: null },
    ],
    dropped: 0,
    previous: { metric: 'open_pipeline' },
  };
  const sam = conversationOwner('u_ts_west', "West region, Celia Rouche's team (6 reps)");

  it('comes back for the same user in the same scope within a session, as it was', () => {
    const store = memory();
    saveConversation(store, sam, conversation, 0);
    expect(loadConversation(store, sam, 8 * 3_600_000)).toEqual(conversation);
  });

  it("is removed, not shown, for another user, after a session's length, or when it's malformed", () => {
    const store = memory();
    saveConversation(store, sam, conversation, 0);
    expect(loadConversation(store, conversationOwner('u_ts_east', "West region, Celia Rouche's team (6 reps)"), 1)).toBeNull();
    expect(store.size()).toBe(0);
    saveConversation(store, sam, conversation, 0);
    expect(loadConversation(store, sam, 8 * 3_600_000 + 1)).toBeNull();
    expect(store.size()).toBe(0);
    for (const turns of hollow) {
      store.setItem(CONVERSATION_KEY, JSON.stringify({ owner: sam, version: 1, at: 0, turns, dropped: 0 }));
      expect(loadConversation(store, sam, 1)).toBeNull();
      expect(store.size()).toBe(0);
    }
    store.setItem(CONVERSATION_KEY, JSON.stringify({ owner: sam, version: 0, at: 0, ...conversation }));
    expect(loadConversation(store, sam, 1)).toBeNull(); // an older version
  });

  it('is removed when the same user comes back with a different scope (UX review, Nov 2, D1)', () => {
    // Promoted to all regions, asked, demoted: a reload must not show the all-regions answer to the seller.
    const store = memory();
    saveConversation(store, conversationOwner('u_ts_east', 'all regions'), conversation, 0);
    expect(loadConversation(store, conversationOwner('u_ts_east', "East region, Cara Losch's team (6 reps)"), 1)).toBeNull();
    expect(store.size()).toBe(0);
  });

  it('is dropped rather than left stale when the tab is full', () => {
    const store = memory();
    saveConversation(store, sam, conversation, 0);
    const full = { ...store, setItem: () => { throw new Error('QuotaExceededError'); } };
    saveConversation(full, sam, { ...conversation, dropped: 1 }, 1);
    expect(store.size()).toBe(0);
  });

  it('is forgotten by both sign-in forms (signed out means the conversation ends)', () => {
    for (const file of ['app/auth-form.tsx', 'alerts/app/auth-form.tsx']) {
      const form = readFileSync(file, 'utf8');
      expect(form).toContain('sessionStorage.removeItem(CONVERSATION_KEY)');
      expect(form).toMatch(/<form [^>]*>\n\s*<ForgetConversation \/>/);
    }
  });
});
