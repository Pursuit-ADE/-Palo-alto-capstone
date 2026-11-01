// "Read as" on a live answer (receipts design, Nov 1): how the question was read, after the sentence and before the number.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { loadRegistry } from '@/registry/load';
import { ask, type Answer } from '@/semantic/answer';
import { narrowerSlice, readAs, readingParts } from '../app/reading';

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
    expect(readAs(a)).toBe([`${a.metric.name} v${a.metric.version}`, ...readingParts(a).map((p, i) => (i === 1 && narrowerSlice(a.scope) ? `${narrowerSlice(a.scope)}, ${p}` : p))].join(' · '));
    expect(html).toContain(`<p class="read-as"><span>Read as:</span> ${htmlEscaped(readAs(a))}</p>`);
    const at = html.indexOf('class="read-as"');
    expect(html.indexOf('class="narrative narrative-lead"')).toBeLessThan(at);
    for (const later of ['class="answer-value', '<table', 'class="chart"', 'class="provenance"']) {
      const next = html.indexOf(later);
      if (next >= 0) expect(at).toBeLessThan(next);
    }
  });

  it('names the reading, not the words typed', async () => {
    const { html } = await render('u_analyst', 'what is the OPEN PIPELINE for deals bigger than 50k?');
    expect(html).toContain('Read as:</span> Open pipeline v1 · any expected close date · all regions · over $50,000');
    expect(html).not.toContain('OPEN PIPELINE');
    expect(html).not.toContain('50k');
  });
});

describe('Read as names a slice narrower than its region (review, Nov 1)', () => {
  // The number right under the line is the slice's, not the region's: East coverage is 0.43x, Cara Losch's team 0.52x.
  it.each([
    ['u_ts_east', 'pipeline coverage this quarter', "Pipeline coverage v1 · FY27-Q1 (Aug 1 to Oct 31, 2026) · Cara Losch's team (6 reps), East region"],
    ['u_mgr_melvin_marxen', 'open pipeline', "Open pipeline v1 · any expected close date · Melvin Marxen's team (6 reps), Central region"],
    ['u_darcel_schlecht', 'open pipeline', 'Open pipeline v1 · any expected close date · your own deals, Central region'],
    ['u_analyst', 'open pipeline in east', 'Open pipeline v1 · any expected close date · East region'],
  ])('%s: "%s"', async (user, q, line) => {
    const { a } = await render(user, q);
    expect(readAs(a)).toBe(line);
  });

  it('reads the slice from the scope sentence, and leaves out the whole company', () => {
    expect(narrowerSlice("Scope: East region, Cara Losch's team (6 reps).")).toBe("Cara Losch's team (6 reps)");
    expect(narrowerSlice('Scope: Central region, your own deals.')).toBe('your own deals');
    expect(narrowerSlice('Scope: Central, East and West regions, all teams.')).toBeNull();
    expect(narrowerSlice('Scope: East and West regions, all teams.')).toBeNull();
  });
});
