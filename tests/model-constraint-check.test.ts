// ask() cross-checks more than the model's metric: when the question states a region, a quarter or a breakdown in words
// code can read, a proposal that contradicts it is asked about, not answered (project review, Nov 1, finding 1).
// The model's schema and the asker's permissions can both be valid while the interpretation is wrong: the analyst may
// see West, but asked about East. Proposals go through followUpRule exactly as a Claude response would.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import cases from '../registry/golden/metamorphic.json';
import { openDatabase, type Database } from '@/db/client';
import { loadRegistry } from '@/registry/load';
import type { Intent } from '@/registry/types';
import { ask } from '@/semantic/answer';
import { followUpRule, type IntentModel } from '@/semantic/model';

const reg = loadRegistry();
let database: Database;
beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

const OPEN: Intent = { metric: 'open_pipeline', filters: {}, groupBy: [] };
const proposing = (intent: Intent): IntentModel => ({
  name: 'stub',
  propose: async (question, registry, _asOf, previous) => followUpRule({ kind: 'intent', intent }, question, registry, previous),
});
const intent = (filters: Intent['filters'], groupBy: Intent['groupBy'] = []): Intent => ({ ...OPEN, filters, groupBy });

describe('a model proposal that contradicts the question is asked about', () => {
  const EAST_Q1 = 'open pipeline in East this quarter';

  it('asks which region when the model answers West for a question about East, with the quarter wrong too', async () => {
    const r = await ask(database, reg, 'u_analyst', EAST_Q1, { model: proposing(intent({ regions: ['west'], period: 'FY27-Q2' })) });
    expect(r).toEqual({ kind: 'clarify', question: 'Do you mean East or West?' });
  });

  it('asks which quarter when only the quarter is wrong', async () => {
    const r = await ask(database, reg, 'u_analyst', EAST_Q1, { model: proposing(intent({ regions: ['east'], period: 'FY27-Q2' })) });
    expect(r).toEqual({ kind: 'clarify', question: 'Do you mean FY27-Q1 or FY27-Q2?' });
  });

  it('asks when the model drops a region or a quarter the question named', async () => {
    const noRegion = await ask(database, reg, 'u_analyst', EAST_Q1, { model: proposing(intent({ period: 'FY27-Q1' })) });
    expect(noRegion).toEqual({ kind: 'clarify', question: 'Do you mean East or all regions?' });
    const noQuarter = await ask(database, reg, 'u_analyst', EAST_Q1, { model: proposing(intent({ regions: ['east'] })) });
    expect(noQuarter).toEqual({ kind: 'clarify', question: 'Do you mean FY27-Q1 or any quarter?' });
  });

  it('asks when the model changes the breakdown the question named', async () => {
    const r = await ask(database, reg, 'u_analyst', 'open pipeline by stage in East this quarter', {
      model: proposing(intent({ regions: ['east'], period: 'FY27-Q1' }, ['region'])),
    });
    expect(r).toEqual({ kind: 'clarify', question: 'Do you mean by stage or by region?' });
  });

  it('asks the East seller too, before any scope refusal, and the reply is a fixed sentence', async () => {
    const r = await ask(database, reg, 'u_ts_east', EAST_Q1, { model: proposing(intent({ regions: ['west'], period: 'FY27-Q1' })) });
    expect(r).toEqual({ kind: 'clarify', question: 'Do you mean East or West?' });
  });

  it('keeps the audit reason a fingerprint of the sentence, never the model text', async () => {
    await ask(database, reg, 'u_analyst', EAST_Q1, { model: proposing(intent({ regions: ['west'], period: 'FY27-Q1' })) });
    const [last] = (await database.db.query.queryAudit.findMany({ orderBy: (t, { desc }) => [desc(t.at)], limit: 1 })) as { outcome: string; reason: string | null }[];
    expect(last).toMatchObject({ outcome: 'clarify' });
    expect(last!.reason).toMatch(/^clarify:[0-9a-f]{16}$/);
  });
});

describe('a model proposal that matches the question is answered, as before', () => {
  it('answers the same number as the deterministic reading when region and quarter agree', async () => {
    const plain = await ask(database, reg, 'u_analyst', 'open pipeline in East this quarter');
    const viaModel = await ask(database, reg, 'u_analyst', 'open pipeline in East this quarter', { model: proposing(intent({ regions: ['east'], period: 'FY27-Q1' })) });
    if (plain.kind !== 'answer' || viaModel.kind !== 'answer') throw new Error(`${plain.kind} / ${viaModel.kind}`);
    expect(viaModel.rows).toEqual(plain.rows);
  });

  it('ignores the order of regions', async () => {
    const r = await ask(database, reg, 'u_analyst', 'open pipeline in East and West this quarter', { model: proposing(intent({ regions: ['west', 'east'], period: 'FY27-Q1' })) });
    expect(r.kind).toBe('answer');
  });

  it('keeps the model free to add a constraint the question does not state in words code can read', async () => {
    // The reading finds no region in "open pipeline", so it cannot say the model is wrong. The model keeps its broader language.
    const r = await ask(database, reg, 'u_analyst', 'open pipeline', { model: proposing(intent({ regions: ['east'] })) });
    expect(r.kind).toBe('answer');
  });

  it('still answers the correct reading of every equivalent wording in the golden set', async () => {
    for (const group of cases.equivalent) {
      for (const phrase of group.phrases) {
        const r = await ask(database, reg, 'u_analyst', phrase, { model: proposing(group.intent as Intent) });
        expect(r.kind, phrase).not.toBe('clarify');
      }
    }
  });
});
