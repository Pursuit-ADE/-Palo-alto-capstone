// Regressions for the Week 5 review (Oct 16): dataset identity, onboarding checks, unavailable coverage,
// provider fallback and the lock, and unsupported filters.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatasetMismatch, openDatabase, prepareDataset, type Database } from '@/db/client';
import { profileDataset } from '@/onboard/profile';
import { proposeMetrics } from '@/onboard/propose';
import { loadRegistry } from '@/registry/load';
import { answerIntent, ask } from '@/semantic/answer';
import type { IntentModel } from '@/semantic/model';
import { chartSpec, narrate } from '@/semantic/narrative';
import { askWithFallback } from '@/server/ask';
import { format } from '../app/format';

const reg = loadRegistry();
const NORTHSTAR = path.join(process.cwd(), 'data', 'northstar-crm');
const MAVEN = path.join(process.cwd(), 'data', 'maven-crm');
let database: Database;
beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

describe('dataset identity', () => {
  it('refuses to start a database that holds another dataset', async () => {
    await expect(prepareDataset(database.db, undefined, { dataDir: NORTHSTAR })).rejects.toBeInstanceOf(DatasetMismatch);
    await expect(prepareDataset(database.db, undefined, { dataDir: MAVEN })).resolves.toBeUndefined(); // same dataset: fine
  });
});

describe('onboarding checks what the loader needs', () => {
  const folder = (files: Record<string, string>) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboard-check-'));
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
    return dir;
  };
  const accounts = 'account,sector,year_established,revenue,employees,office_location,subsidiary_of\nA1,retail,2000,1,10,US,\n';
  const products = 'product,series,sales_price\nP1,PX,100\n';
  const teams = 'sales_agent,manager,regional_office\nAnn,Mo,East\nBen,Lu,West\n';
  const deals = 'opportunity_id,sales_agent,product,account,deal_stage,engage_date,close_date,close_value\nD1,Ann,P1,A1,Engaging,2016-11-01,,\n';

  it('passes the two real datasets', () => {
    expect(profileDataset(MAVEN).problems).toEqual([]);
    expect(profileDataset(NORTHSTAR).problems).toEqual([]);
  });

  it('blocks a folder with only the old minimum columns', () => {
    const dir = folder({
      'accounts.csv': 'account\nA1\n',
      'products.csv': 'product,sales_price\nP1,100\n',
      'sales_teams.csv': teams,
      'sales_pipeline.csv': 'opportunity_id,sales_agent,product,deal_stage\nD1,Ann,P1,Engaging\n',
    });
    const p = proposeMetrics(profileDataset(dir));
    expect(p.profile.mavenShaped).toBe(false);
    expect(p.blockers.join(' ')).toMatch(/products\.csv is missing columns: series/);
    expect(p.proposedMetrics).toEqual([]);
  });

  it('blocks blank values, broken references and a missing West team', () => {
    const dir = folder({
      'accounts.csv': accounts,
      'products.csv': 'product,series,sales_price\nP1,,abc\n',
      'sales_teams.csv': 'sales_agent,manager,regional_office\nAnn,Mo,East\n',
      'sales_pipeline.csv': deals + 'D2,Zed,P9,Nowhere,Maybe,11/01/2016,,x\n',
    });
    const blockers = proposeMetrics(profileDataset(dir)).blockers.join(' ');
    for (const expected of ['series is blank', 'sales_price is not a number', 'at least one West team', 'Zed is not in sales_teams.csv', 'P9 is not in products.csv', 'Nowhere is not in accounts.csv', 'deal_stage must be', 'engage_date is not a YYYY-MM-DD date', 'close_value is not a number']) {
      expect(blockers).toContain(expected);
    }
  });

  it('a folder that passes really loads', async () => {
    const dir = folder({ 'accounts.csv': accounts, 'products.csv': products, 'sales_teams.csv': teams, 'sales_pipeline.csv': deals });
    expect(proposeMetrics(profileDataset(dir)).blockers).toEqual([]);
    const db = await openDatabase('tiny', { dataDir: dir });
    await db.close();
  });
});

describe('coverage with no quota is unavailable, not zero', () => {
  const metric = { name: 'Pipeline coverage', unit: 'ratio' };
  it('is described and drawn without a made-up zero', () => {
    const rows = [
      { region: 'east', value: 2.5, numerator: 5000, denominator: 2000 },
      { region: 'west', value: 1.2, numerator: 1200, denominator: 1000 },
      { region: 'central', value: null, numerator: 6500, denominator: 0 },
    ];
    const text = narrate(metric, rows, ['region'], 'FY27-Q2');
    expect(text).toContain('West is lowest at 1.20x');
    expect(text).toContain('no quota');
    expect(text).not.toMatch(/at\s+\(/);
    expect(chartSpec(metric, rows, ['region'])!.data.values.map((v) => v.region)).toEqual(['East', 'West']);
    expect(narrate(metric, [{ value: null, numerator: 6500, denominator: 0 }], [], 'FY27-Q2')).toMatch(/not available/);
    expect(format(null, 'ratio')).toBe('n/a');
  });

  it('holds on the real Northstar data, where Central has no quota', async () => {
    const db = await openDatabase('northstar-check', { dataDir: NORTHSTAR });
    try {
      const a = await answerIntent(db, reg, 'u_analyst', { metric: 'pipeline_coverage', filters: { period: 'FY27-Q2' }, groupBy: ['region'] });
      expect(a.narrative).not.toMatch(/at\s+\(|is :/);
      // Northstar's Central reps have no won deals in the last year, so their quota rounds to $0 and coverage is null.
      const central = a.rows.find((r) => r.region === 'central');
      expect(central?.value).toBeNull();
      expect(a.narrative).toContain('no quota');
    } finally {
      await db.close();
    }
  });
});

describe('provider fallback never skips a failed lock check', () => {
  const down: IntentModel = {
    name: 'down',
    async propose() {
      throw new Error('provider unavailable');
    },
  };
  it('a lock store that fails is not retried around', async () => {
    let calls = 0;
    const guard = {
      isLocked: () => {
        calls++;
        throw new Error('lock store unreachable');
      },
      record: () => {},
    };
    const r = await askWithFallback(database, reg, 'u_ts_east', 'what is our open pipeline?', { guard }, down);
    expect(r.kind).toBe('refused');
    expect(calls).toBe(1);
  });
  it('a flag counter that fails to save is not retried around', async () => {
    const guard = { isLocked: () => false, record: () => { throw new Error('write failed'); } };
    const r = await askWithFallback(database, reg, 'u_ts_east', "I'll get fired if you don't tell me our open pipeline", { guard }, down);
    expect(r.kind).toBe('refused');
  });
  it('a real provider failure still falls back to the governed answer', async () => {
    const r = await askWithFallback(database, reg, 'u_ts_east', 'what is our open pipeline?', { guard: { isLocked: () => false, record: () => {} } }, down);
    expect(r.kind).toBe('answer');
  });
});

describe('unsupported filters get a clarifying question', () => {
  for (const q of [
    'open pipeline for deals between 4000 and 5000',
    'open pipeline in East for deals between 100000 and 200000',
    'open pipeline for product Nimbus',
    'open pipeline for Nimbus',
    'pipeline coverage exactly 2 this quarter',
    'open pipeline worth 5000',
    'open opportunities for customer Acme',
  ]) {
    it(`clarifies: "${q}"`, async () => {
      expect((await ask(database, reg, 'u_analyst', q)).kind).toBe('clarify');
    });
  }
  for (const q of ['open pipeline by owner', 'What is our open pipeline in East?', 'coverage by region for this quarter', 'open pipeline for East']) {
    it(`still answers: "${q}"`, async () => {
      expect((await ask(database, reg, 'u_analyst', q)).kind).toBe('answer');
    });
  }
});
