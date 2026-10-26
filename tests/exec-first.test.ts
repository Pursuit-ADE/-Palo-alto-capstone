// Executive-first answers (client feedback, Oct 24): an answer opens with its one-sentence narrative, before the
// big number, the scope chips and any chart, so a leader can read one line and stop.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { loadRegistry } from '@/registry/load';
import { ask, type Answer } from '@/semantic/answer';

// The panel imports its server action; the render never calls it.
vi.mock('../app/actions', () => ({ askCopilot: async () => null }));

const reg = loadRegistry();
let database: Database;
beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

async function answer(user: string, q: string): Promise<Answer> {
  const r = await ask(database, reg, user, q);
  if (r.kind !== 'answer') throw new Error(`expected an answer, got ${r.kind}`);
  return r;
}

describe('answers lead with one sentence', () => {
  it.each([
    ['u_analyst', 'what is our open pipeline?'],
    ['u_analyst', 'open pipeline by stage'],
    ['u_ts_east', 'pipeline coverage this quarter'],
  ])('%s: "%s" puts the narrative before the number and the chart', async (user, q) => {
    const { AnswerView } = await import('../app/ask-panel');
    const a = await answer(user, q);
    const html = renderToStaticMarkup(createElement(AnswerView, { a, graphs: { id: 'g', metricDims: {}, ask: null, busy: false } }));
    const lead = html.indexOf('class="narrative narrative-lead"');
    expect(lead).toBeGreaterThan(-1);
    for (const later of ['class="answer-value"', 'class="c3d', '<table']) {
      const at = html.indexOf(later);
      if (at >= 0) expect(lead).toBeLessThan(at);
    }
    expect(html).toContain(a.narrative.replace(/&/g, '&amp;').slice(0, 20));
  });
});

describe('a breakdown with one row reads as a sentence', () => {
  it('says the only stage, not "highest" and "1 stages"', async () => {
    const a = await answer('u_ts_east', 'open pipeline by stage');
    expect(a.rows).toHaveLength(1); // the East seller's scope has one open stage in the seed
    expect(a.narrative).toMatch(/is the only stage, at \$/);
    expect(a.narrative).not.toMatch(/1 stages|highest/);
  });
});
