// The explanation panel shows what each figure was filtered to and where each figure came from (review on #50):
// named regions appear in the side-by-side table, and each figure of a comparison gets its own provenance panel.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExplanationView } from '../app/explanation-panel';
import { openDatabase, type Database } from '@/db/client';
import { loadRegistry } from '@/registry/load';
import { ask } from '@/semantic/answer';
import type { Explanation } from '@/semantic/explain';

const reg = loadRegistry();
let database: Database;

beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

async function render(userId: string, phrase: string): Promise<{ e: Explanation; html: string }> {
  const r = await ask(database, reg, userId, phrase);
  if (r.kind !== 'explanation') throw new Error(`expected an explanation, got ${r.kind}`);
  return { e: r, html: renderToStaticMarkup(createElement(ExplanationView, { e: r })) };
}

/** The "Filtered to" row of the side-by-side table, as [class, first figure, second figure]. */
function filteredRow(html: string) {
  const m = html.match(/<tr( class="differs")?><th scope="row">Filtered to<\/th><td>([^<]*)<\/td><td>([^<]*)<\/td><\/tr>/);
  if (!m) throw new Error('no Filtered to row');
  return { differs: Boolean(m[1]), first: m[2], second: m[3] };
}

describe('two figures side by side', () => {
  it('East against West: the regions are in the Filtered to row, marked as the difference', async () => {
    const { html } = await render('u_analyst', 'explain why coverage is higher in east than west');
    expect(filteredRow(html)).toEqual({ differs: true, first: 'East region', second: 'West region' });
    expect(html).toContain('Why these two coverage figures differ');
  });

  it("two named teams: each team is in the Filtered to row", async () => {
    const { html } = await render('u_analyst', "Why is Cara Losch's team's pipeline coverage higher than Celia Rouche's team's?");
    expect(filteredRow(html)).toEqual({ differs: true, first: "Cara Losch&#x27;s team", second: "Celia Rouche&#x27;s team" });
  });

  it('each figure gets its own provenance panel, with its own audit id', async () => {
    const { e, html } = await render('u_analyst', 'explain why coverage is higher in east than west');
    expect(html.match(/Where this number came from/g)).toHaveLength(2);
    expect(html).toContain('First figure');
    expect(html).toContain('Second figure');
    const [first, second] = [e.answer.provenance.auditId, e.other!.provenance.auditId];
    expect(first).not.toEqual(second);
    expect(html).toContain(first);
    expect(html).toContain(second);
  });
});

describe('one figure', () => {
  it("the seller's own figure: one panel, and a heading that doesn't promise a reason for the other number", async () => {
    const { html } = await render('u_ts_east', 'why does marketing say coverage is 3x when mine is 0.5x?');
    expect(html).toContain('Your coverage, and what can make another figure differ');
    expect(html).not.toContain('Why these two coverage figures differ');
    expect(html.match(/Where this number came from/g)).toHaveLength(1);
    expect(html).not.toContain('Second figure');
    expect(html).not.toMatch(/1,963,909|3,001,000|0\.65|3x/);
  });

  it('leads with the one-sentence summary, before the ratio and the chips', async () => {
    const { html } = await render('u_ts_east', 'why does marketing say coverage is 3x when mine is 0.5x?');
    const at = (s: string) => html.indexOf(s);
    expect(at('class="narrative"')).toBeGreaterThan(at('<h3>'));
    expect(at('class="narrative"')).toBeLessThan(at('class="answer-value"'));
    expect(at('class="answer-value"')).toBeLessThan(at('Scope and data date'));
  });
});

describe('PR #50 review, Oct 31: the heading matches the figures', () => {
  it('two figures that are the same are not headed as differing', async () => {
    const { e, html } = await render('u_ts_east', "why is Cara Losch's team coverage different from mine this quarter?");
    expect(e.other).not.toBeNull();
    expect(html).not.toContain('Why these two coverage figures differ');
    expect(html).toContain('These two coverage figures are the same');
  });
});
