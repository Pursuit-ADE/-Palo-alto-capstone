// The Graphs view's data (app/chart-data.ts): every graph is built from the same governed rows and the same text as
// the Numbers view, missing values stay missing, and the dashboard's stage split never widens scope.
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { queryAudit } from '@/db/schema';
import { demoUsers } from '@/db/seed';
import { loadRegistry } from '@/registry/load';
import { answerIntent, ask, type Answer } from '@/semantic/answer';
import { answerCharts, breakdownQuestions, coverageRegionCharts, kpiStageChart, MAX_CATEGORIES, reconciles } from '../app/chart-data';
import { format } from '../app/format';

const reg = loadRegistry();
let database: Database;

beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

async function answer(userId: string, phrase: string, previous?: unknown): Promise<Answer> {
  const r = await ask(database, reg, userId, phrase, previous ? { previous } : {});
  if (r.kind !== 'answer') throw new Error(`expected an answer, got ${r.kind}`);
  return r;
}

const intent = (userId: string, metric: string, groupBy: string[], period?: string) =>
  answerIntent(database, reg, userId, { metric, filters: period ? { period } : {}, groupBy }, 'dashboard_graph');

describe('copilot answers as graphs', () => {
  it('a breakdown graph carries exactly the rows the table shows, with the same text', async () => {
    const a = await answer('u_analyst', 'open pipeline by owner');
    const [c] = answerCharts(a, 'x')!;
    expect(c!.form).toBe('rows');
    expect(c!.data).toHaveLength(a.rows.length);
    // Same labels and values as the bar chart spec that travels with the answer.
    const spec = (a.chart!.data.values as { owner: string; value: number }[]).map((v) => `${v.owner}=${v.value}`).sort();
    const drawn = c!.data.map((d) => `${c!.categories.find((k) => k.key === d.category)!.label}=${d.value}`).sort();
    expect(drawn).toEqual(spec);
    for (const d of c!.data) expect(d.display).toBe(format(d.value, 'currency'));
    // Largest first, as the spec's sort says.
    const values = c!.categories.map((k) => c!.data.find((d) => d.category === k.key)!.value!);
    expect([...values].sort((x, y) => y - x)).toEqual(values);
  });

  it('a single money or count answer is one column, with break-down chips that only the metric allows', async () => {
    const a = await answer('u_analyst', 'What is our open pipeline?');
    const [c] = answerCharts(a, 'x')!;
    expect(c!.data).toEqual([{ category: 'total', series: 0, value: Number(a.rows[0]!.value), display: format(Number(a.rows[0]!.value), 'currency') }]);
    const dims = Object.fromEntries([...reg.metrics.values()].map((m) => [m.id, m.dimensions]));
    expect(breakdownQuestions(a, dims).map((b) => b.label)).toEqual(reg.metrics.get('open_pipeline')!.dimensions.map((d) => `By ${d}`));
    expect(breakdownQuestions(await answer('u_analyst', 'open pipeline by stage'), dims)).toEqual([]);
  });

  it('a break-down chip is a follow-up: it keeps the number\'s region, stage and quarter, and its parts add up to it', async () => {
    const dims = Object.fromEntries([...reg.metrics.values()].map((m) => [m.id, m.dimensions]));
    for (const phrase of ['open pipeline in west next quarter', 'open pipeline in east this quarter', 'open opportunities in prospecting']) {
      const a = await answer('u_analyst', phrase);
      expect(a.rows).toHaveLength(1);
      for (const b of breakdownQuestions(a, dims)) {
        const r = await answer('u_analyst', b.question, a.intent);
        const where = `${phrase} -> ${b.question}`;
        expect(r.metric.id, where).toBe(a.metric.id);
        expect(r.filters.groupBy, where).toEqual([b.label.slice(3)]);
        expect(r.filters.regions, where).toEqual(a.filters.regions);
        expect(r.filters.stages, where).toEqual(a.filters.stages);
        expect(r.filters.period, where).toEqual(a.filters.period);
        expect(r.scope, where).toBe(a.scope);
        expect(r.rows.reduce((s, row) => s + Number(row.value ?? 0), 0), where).toBeCloseTo(Number(a.rows[0]!.value), 2);
      }
    }
    // Coverage keeps its quarter, so its chip gets the breakdown, not a question back.
    const cov = await answer('u_analyst', 'pipeline coverage this quarter');
    const [chip] = breakdownQuestions(cov, dims);
    expect(chip!.label).toBe('By region');
    const byRegion = await answer('u_analyst', chip!.question, cov.intent);
    expect(byRegion.metric.id).toBe('pipeline_coverage');
    expect(byRegion.filters.period).toEqual(cov.filters.period);
    expect(byRegion.filters.groupBy).toEqual(['region']);
  });

  it('single coverage shows what it divides: pipeline next to quota, as currency', async () => {
    const a = await answer('u_ts_east', 'pipeline coverage this quarter');
    const [c] = answerCharts(a, 'x')!;
    expect(c!.unit).toBe('currency');
    expect(c!.data.map((d) => d.value)).toEqual([Number(a.rows[0]!.numerator), Number(a.rows[0]!.denominator)]);
    expect(c!.data.map((d) => d.display)).toEqual([format(Number(a.rows[0]!.numerator), 'currency'), format(Number(a.rows[0]!.denominator), 'currency')]);
  });

  it('coverage by region keeps a region with no quota as n/a in both graphs, never as 0', () => {
    const a = {
      metric: { id: 'pipeline_coverage', name: 'Pipeline coverage', unit: 'ratio' },
      filters: { groupBy: ['region'], period: { label: 'FY27-Q1' } },
      rows: [
        { region: 'central', numerator: 762599, denominator: 1003000, value: 0.76 },
        { region: 'east', numerator: 394634, denominator: null, value: null },
      ],
      narrative: 'n',
      ownerNames: null,
    } as unknown as Answer;
    const [ratio, money] = answerCharts(a, 'x')!;
    expect(ratio!.target).toEqual({ value: 1, label: '1.00x = quota' });
    expect(ratio!.data.find((d) => d.category === 'east')).toMatchObject({ value: null, display: 'n/a' });
    expect(money!.data.find((d) => d.category === 'east' && d.series === 1)).toMatchObject({ value: null, display: 'No quota' });
    expect(money!.data.find((d) => d.category === 'east' && d.series === 0)).toMatchObject({ value: 394634, display: '$394,634' });
    const dash = coverageRegionCharts(a, 'FY27-Q1', 'c');
    expect(dash.map((c) => c.tab)).toEqual(['Coverage', 'Pipeline vs quota']);
    expect(dash[0]!.data.find((d) => d.category === 'east')!.value).toBeNull();
    expect(dash[0]!.data[0]!.detail).toBe('$762,599 closing in FY27-Q1 vs $1,003,000 quota');
  });

  it('coverage names its numerator one way everywhere: pipeline closing in the quota period, never "Open pipeline"', () => {
    const rows = [
      { region: 'central', numerator: 762599, denominator: 1003000, value: 0.76 },
      { region: 'east', numerator: 394634, denominator: null, value: null },
    ];
    const metric = { id: 'pipeline_coverage', name: 'Pipeline coverage', unit: 'ratio' };
    const period = { label: 'FY27-Q1' };
    const byRegion = { metric, filters: { groupBy: ['region'], period }, rows, narrative: 'n', ownerNames: null } as unknown as Answer;
    const single = { metric, filters: { groupBy: [], period }, rows: [{ numerator: 762599, denominator: 1003000, value: 0.76 }], narrative: 'n', ownerNames: null } as unknown as Answer;
    const [ratio, money] = answerCharts(byRegion, 'x')!;
    const dash = coverageRegionCharts(byRegion, 'FY27-Q1', 'c');
    const [one] = answerCharts(single, 'y')!;
    const names = ['Pipeline closing in FY27-Q1', 'Quota for FY27-Q1'];
    expect(money!.series).toEqual(names);
    expect(dash[1]!.series).toEqual(names);
    expect(one!.categories.map((c) => c.label)).toEqual(names);
    for (const s of [money!.summary, dash[1]!.summary]) expect(s).toMatch(/^Pipeline closing in FY27-Q1 and quota for FY27-Q1, by region: Central \$762,599 vs \$1,003,000/);
    // The ratio's detail keeps the period, in the answer as on the dashboard.
    expect(ratio!.data.map((d) => d.detail)).toEqual(dash[0]!.data.map((d) => d.detail));
    expect(ratio!.data[0]!.detail).toBe('$762,599 closing in FY27-Q1 vs $1,003,000 quota');
    expect(JSON.stringify([ratio, money, one, ...dash])).not.toMatch(/Open pipeline/);
  });

  it('two breakdowns: the smaller one (at most three values) becomes the series; missing pairs stay missing', () => {
    const a = {
      metric: { id: 'open_pipeline', name: 'Open pipeline', unit: 'currency' },
      filters: { groupBy: ['region', 'stage'] },
      rows: [
        { region: 'central', stage: 'Engaging', value: 10 },
        { region: 'central', stage: 'Prospecting', value: 5 },
        { region: 'east', stage: 'Engaging', value: 7 },
        { region: 'west', stage: 'Prospecting', value: 2 },
      ],
      narrative: 'n',
      ownerNames: null,
    } as unknown as Answer;
    const [c] = answerCharts(a, 'x')!;
    expect(c!.series).toEqual(['Prospecting', 'Engaging']);
    expect(c!.categories.map((k) => k.key)).toEqual(['central', 'east', 'west']);
    expect(c!.data).toHaveLength(4); // east has no Prospecting row and west no Engaging row: nothing is made up
  });

  it('huge breakdowns stay a table', () => {
    const rows = Array.from({ length: MAX_CATEGORIES + 1 }, (_, i) => ({ owner: `o${i}`, value: i }));
    const a = { metric: { id: 'open_pipeline', name: 'Open pipeline', unit: 'currency' }, filters: { groupBy: ['owner'] }, rows, narrative: 'n', ownerNames: {} } as unknown as Answer;
    expect(answerCharts(a, 'x')).toBeNull();
  });
});

describe('dashboard tiles split by stage', () => {
  it('reconciles to the cent for money and exactly for counts', () => {
    expect(reconciles([0.1, 0.2], 0.3, 'currency')).toBe(true);
    expect(reconciles([100, 200], 300.01, 'currency')).toBe(false);
    expect(reconciles([1, 2], 3, 'count')).toBe(true);
    expect(reconciles([1, null], 1, 'count')).toBe(false);
  });

  for (const u of demoUsers()) {
    it(`${u.displayName}: the split adds up to the tile, in funnel order, with the same scope, and is audited as a graph`, async () => {
      for (const metric of ['open_pipeline', 'open_opportunity_count']) {
        const total = await answerIntent(database, reg, u.id, { metric, filters: {}, groupBy: [] }, 'dashboard');
        const split = await intent(u.id, metric, ['stage']);
        expect(split.scope).toBe(total.scope);
        expect(split.filters.regions).toEqual(total.filters.regions);
        const c = kpiStageChart(total, split, 'k', 't');
        expect(c.note).toBeUndefined(); // the split was drawn, not the fallback
        expect(c.data.reduce((s, d) => s + (d.value ?? 0), 0)).toBeCloseTo(Number(total.rows[0]!.value), 2);
        const order = c.categories.map((k) => k.key);
        expect(order).toEqual(['Prospecting', 'Engaging'].filter((s) => order.includes(s)));
        const [row] = await database.db.select().from(queryAudit).where(eq(queryAudit.id, split.provenance.auditId));
        expect(row?.source).toBe('dashboard_graph');
      }
    });
  }

  it('falls back to the total, saying so, when the split is missing, from another snapshot, or does not add up', async () => {
    const total = await answerIntent(database, reg, 'u_analyst', { metric: 'open_pipeline', filters: {}, groupBy: [] }, 'dashboard');
    const split = await intent('u_analyst', 'open_pipeline', ['stage']);
    const off = { ...split, rows: split.rows.map((r, i) => (i === 0 ? { ...r, value: Number(r.value) + 1 } : r)) };
    const other = { ...split, provenance: { ...split.provenance, snapshotId: 'another' } };
    for (const bad of [null, off, other]) {
      const c = kpiStageChart(total, bad, 'k', 't');
      expect(c.categories).toEqual([{ key: 'all', label: 'All open deals' }]);
      expect(c.data[0]!.value).toBe(Number(total.rows[0]!.value));
      expect(c.note).toMatch(/not available/);
    }
    // No open deals: an empty split of a $0 total is an answer, and the note says so instead of "not available".
    const zero = { ...total, rows: [{ value: 0 }] };
    const empty = { ...split, rows: [] };
    expect(kpiStageChart(zero, empty, 'k', 't').note).toBe('There are no open deals in your scope, so there is nothing to split by stage.');
  });

  it('the Numbers view makes no extra calls: the split is asked for only in the Graphs view', () => {
    const page = readFileSync('app/page.tsx', 'utf8');
    expect(page).toMatch(/graphs \? answerIntent\([^)]*groupBy: \['stage'\][^)]*'dashboard_graph'/);
  });
});

describe('shared files', () => {
  it('both apps carry byte-identical copies of the graph, view-switch and sign-in files', () => {
    const graphs = ['chart3d-math.ts', 'chart3d-draw.ts', 'chart3d.tsx', 'chart3d.css', 'view-mode.ts', 'view-actions.ts', 'view-switch.tsx'];
    // auth-info.ts is not shared: each app describes itself (registry metrics or alert rules) before sign-in.
    const signIn = ['auth-stage.tsx', 'auth-stage.css', 'auth-form.tsx', 'tile-floor.tsx'];
    for (const f of [...graphs, ...signIn]) {
      expect(readFileSync(`alerts/app/${f}`, 'utf8'), f).toBe(readFileSync(`app/${f}`, 'utf8'));
    }
  });

  // Optimization review, Oct 31: these security rules were copied into alerts with nothing checking the copies, so a
  // fix to one app's password, HTTPS, config or identity rule could miss the other.
  it('both apps carry byte-identical copies of the shared server rules and the synthetic-data badge', () => {
    const server = ['require-user.ts', 'identity.ts', 'passwords.ts', 'client-address.ts', 'https.ts', 'config.ts'];
    for (const f of server) {
      expect(readFileSync(`alerts/src/server/${f}`, 'utf8'), f).toBe(readFileSync(`src/server/${f}`, 'utf8'));
    }
    expect(readFileSync('alerts/app/synthetic-badge.tsx', 'utf8')).toBe(readFileSync('app/synthetic-badge.tsx', 'utf8'));
  });
});
