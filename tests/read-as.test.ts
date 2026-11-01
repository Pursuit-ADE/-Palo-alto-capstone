// "Read as" on a live answer (receipts design, Nov 1): how the question was read, after the sentence and before the number.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { loadRegistry } from '@/registry/load';
import { ask, type Answer } from '@/semantic/answer';
import { readingParts } from '../app/reading';

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

async function render(user: string, q: string): Promise<{ a: Answer; html: string }> {
  const r = await ask(database, reg, user, q);
  if (r.kind !== 'answer') throw new Error(`expected an answer, got ${r.kind}`);
  const { AnswerView } = await import('../app/ask-panel');
  return { a: r, html: renderToStaticMarkup(createElement(AnswerView, { a: r, graphs: { id: 'g', metricDims: {}, ask: null, busy: false } })) };
}

const htmlEscaped = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;');

describe('Read as on the live answer', () => {
  it.each([
    ['u_ts_east', 'pipeline coverage this quarter'],
    ['u_analyst', 'open pipeline over $50,000 by stage'],
    ['u_mgr_melvin_marxen', 'open pipeline by owner'],
  ])('%s: "%s" shows the metric, its version and the reading, after the sentence and before the number', async (user, q) => {
    const { a, html } = await render(user, q);
    const line = `${a.metric.name} v${a.metric.version} · ${readingParts(a).join(' · ')}`;
    expect(html).toContain(`<p class="read-as"><span>Read as</span>${htmlEscaped(line)}</p>`);
    const readAs = html.indexOf('class="read-as"');
    expect(html.indexOf('class="narrative narrative-lead"')).toBeLessThan(readAs);
    for (const later of ['class="answer-value', '<table', 'class="chart"', 'class="provenance"']) {
      const at = html.indexOf(later);
      if (at >= 0) expect(readAs).toBeLessThan(at);
    }
  });

  it('names the reading, not the words typed', async () => {
    const { html } = await render('u_analyst', 'what is the OPEN PIPELINE for deals bigger than 50k?');
    expect(html).toContain('Open pipeline v1 · any expected close date · all regions · over $50,000');
    expect(html).not.toContain('OPEN PIPELINE');
    expect(html).not.toContain('50k');
  });
});
