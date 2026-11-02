// Real replies from the reader survive the kept conversation's shape check (app/ask-flow.ts), so a reload keeps them.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { loadRegistry } from '@/registry/load';
import { ask } from '@/semantic/answer';
import { conversationOwner, loadConversation, saveConversation } from '../app/ask-flow';

const reg = loadRegistry();
let database: Database;
beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

it('keeps an answer, an explanation, an ask-back and a refusal as they were', async () => {
  const asked = [
    ['u_ts_east', 'Pipeline coverage this quarter'],
    ['u_ts_east', 'open pipeline by owner'],
    ['u_ts_east', 'Why does marketing say 3x when mine is 0.5x?'],
    ['u_analyst', "Why is Cara Losch's team coverage lower than the company's?"],
    ['u_ts_east', "What's my pipeline coverage?"],
    ['u_ts_east', 'What about West?'],
    ['u_ts_east', 'what can you do?'],
  ] as const;
  const turns = [];
  for (const [i, [user, q]] of asked.entries()) turns.push({ id: i + 1, question: q, result: JSON.parse(JSON.stringify(await ask(database, reg, user, q))) });
  const kinds = new Set(turns.map((t) => t.result.kind));
  for (const kind of ['answer', 'explanation', 'clarify']) expect(kinds).toContain(kind);
  expect(kinds.has('refused') || kinds.has('unsupported')).toBe(true);
  const m = new Map<string, string>();
  const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  const owner = conversationOwner('u_ts_east', 'East');
  saveConversation(store, owner, { turns, dropped: 0, previous: null }, 0);
  expect(loadConversation(store, owner, 1)?.turns).toEqual(turns);
}, 120_000);
