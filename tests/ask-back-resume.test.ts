// After an ask-back about a name or a breakdown, the reply finishes that question instead of getting the generic
// refusal (UX round 1, BH 4, Nov 2). The resumed question is validated and scoped afresh, like any follow-up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { loadRegistry } from '@/registry/load';
import { ask, type Reply } from '@/semantic/answer';
import { ScopeViolation } from '@/semantic/scope';

const reg = loadRegistry();
let database: Database;
beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

const MELVIN = 'u_mgr_melvin_marxen';
const DARCEL = 'u_darcel_schlecht';

/** One conversation, as the panel holds it: an answer's intent, or a clarification's resume, is the next previous. */
async function chat(user: string, questions: string[]): Promise<Reply[]> {
  const out: Reply[] = [];
  let previous: unknown;
  for (const q of questions) {
    const r = await ask(database, reg, user, q, { previous });
    out.push(r);
    previous = r.kind === 'answer' ? r.intent : r.kind === 'clarify' ? r.resume : undefined;
  }
  return out;
}

const narrative = (r: Reply | undefined) => (r?.kind === 'answer' ? r.narrative : `(${r?.kind})`);

describe('a reply to an ask-back continues the question', () => {
  it('a full name after "use the full name" answers for that rep', async () => {
    const [asked, done] = await chat(MELVIN, ['open pipeline for Darcel', 'Darcel Schlecht']);
    expect(asked?.kind).toBe('clarify');
    expect(narrative(done)).toContain('$656,040');
  });

  it('"what about <rep>?" after the ask-back answers for that rep', async () => {
    const [, done] = await chat(MELVIN, ['open pipeline for Darcel', 'what about Gladys Colclough?']);
    expect(narrative(done)).toContain('$192,142');
  });

  it('the corrected name after a typo answers', async () => {
    const [asked, done] = await chat(MELVIN, ['open pipeline for Darcel Schlect', 'Darcel Schlecht']);
    expect(asked?.kind).toBe('clarify');
    expect(narrative(done)).toContain('$656,040');
  });

  it('keeps the quarter and region the first question named', async () => {
    const [asked, done] = await chat(MELVIN, ['open pipeline for Darcel in Central next quarter', 'Darcel Schlecht']);
    expect(asked?.kind === 'clarify' && asked.resume?.filters).toMatchObject({ regions: ['central'] });
    expect(done?.kind === 'answer' && done.filters.period?.label).toBe('FY27-Q2');
  });

  it('"what about next quarter?" after "can\'t be broken down by product" answers', async () => {
    const [asked, done] = await chat(DARCEL, ['open pipeline by product', 'what about next quarter?']);
    expect(asked?.kind).toBe('clarify');
    expect(done?.kind).toBe('answer');
  });

  it('a resumed question is scoped afresh: a name outside scope is still refused', async () => {
    await expect(chat(DARCEL, ['open pipeline for Darcel', 'Gladys Colclough'])).rejects.toBeInstanceOf(ScopeViolation);
  });

  it('a metric ask-back carries nothing forward', async () => {
    const [asked] = await chat(MELVIN, ['what is the pipeline count?']);
    expect(asked?.kind === 'clarify' ? asked.resume : 'not a clarify').toBeUndefined();
  });
});
