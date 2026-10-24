// Semantic invariance (report Issue 5): equivalent wordings give the same request and the same governed result;
// a change of meaning changes the request; what can't be read exactly is asked about, never guessed. Cases live in
// registry/golden/metamorphic.json. A valid but wrong metric is a semantic failure even when authorization and SQL
// both succeed, so it is checked separately from the access tests.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import cases from '../registry/golden/metamorphic.json';
import { openDatabase, type Database } from '@/db/client';
import { loadRegistry } from '@/registry/load';
import type { Intent } from '@/registry/types';
import { ask, type Answer } from '@/semantic/answer';
import { validateIntent } from '@/semantic/compile';
import { followUpRule, type IntentModel } from '@/semantic/model';
import { normalize, type NormalizeResult } from '@/semantic/normalize';

const reg = loadRegistry();
const AS_OF = cases.asOfDate;
let database: Database;

beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

type Expect = Intent | { clarify: true };
const read = (phrase: string, previous?: Intent) => normalize(phrase, reg, AS_OF, previous);

/** Same request: metric, filters (key order ignored, region order ignored) and breakdown. */
function sameIntent(a: Intent, b: Intent): boolean {
  const norm = (i: Intent) => JSON.stringify({ m: i.metric, g: [...i.groupBy].sort(), f: Object.fromEntries(Object.entries(i.filters).map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v]).sort()) });
  return norm(a) === norm(b);
}

/**
 * How a result compares with what the question meant. Only "correct" and "asked" are acceptable for a case that
 * expects an intent; "wrong_metric" and "wrong_filters" are semantic failures whatever the scope and SQL checks said.
 */
function semanticVerdict(expected: Intent, actual: NormalizeResult | { kind: 'intent'; intent: Intent }) {
  if (actual.kind === 'clarify') return 'asked';
  if (actual.kind === 'unsupported') return 'declined';
  if (actual.intent.metric !== expected.metric) return 'wrong_metric';
  return sameIntent(actual.intent, expected) ? 'correct' : 'wrong_filters';
}

function expectResult(phrase: string, r: NormalizeResult, expected: Expect) {
  if ('clarify' in expected) return expect(r.kind, `"${phrase}" should ask`).toBe('clarify');
  expect(r.kind, `"${phrase}"`).toBe('intent');
  if (r.kind === 'intent') expect(semanticVerdict(expected, r), `"${phrase}" read as ${JSON.stringify(r.intent)}`).toBe('correct');
}

/** Rows, result hash and metric version for an answer; the kind of reply or refusal otherwise. */
async function governedOutcome(userId: string, phrase: string): Promise<unknown> {
  try {
    const r = await ask(database, reg, userId, phrase);
    return r.kind === 'answer' ? { rows: r.rows, hash: r.provenance.resultHash, version: r.metric.version } : { kind: r.kind };
  } catch (e) {
    return { refused: (e as Error).constructor.name };
  }
}

/** The part of an intent a contrast says must change. */
function field(i: Intent, name: string): unknown {
  if (name === 'metric') return i.metric;
  if (name === 'groupBy') return i.groupBy;
  if (name === 'filters') return i.filters;
  return i.filters[name as keyof Intent['filters']];
}

describe('the case file', () => {
  it('every expected intent is valid against the registry, and the set covers all three metrics', () => {
    // JSON imports type groupBy as string[]; the registry check below is what proves each one is a real Intent.
    const expectations = cases.contrasts.flatMap((c) => [c.a.expect, c.b.expect]) as unknown as Expect[];
    const intents = [
      ...cases.equivalent.map((g) => g.intent),
      ...expectations.filter((e) => !('clarify' in e)),
      ...cases.followUps.flatMap((f) => [f.previous, f.expect]),
      ...cases.safeGaps.map((g) => g.intended),
    ] as unknown as Intent[];
    for (const i of intents) expect(() => validateIntent(i, reg), JSON.stringify(i)).not.toThrow();
    expect(new Set(intents.map((i) => i.metric))).toEqual(new Set(reg.metrics.keys()));
  });
});

describe('equivalent wordings', () => {
  for (const group of cases.equivalent) {
    it(`${group.name}: every wording gives the same request`, () => {
      for (const phrase of group.phrases) expectResult(phrase, read(phrase), group.intent as Intent);
    });

    it(`${group.name}: the same person gets the same governed result for every wording`, async () => {
      for (const userId of ['u_analyst', 'u_ts_east']) {
        const outcomes = [];
        for (const phrase of group.phrases) outcomes.push(await governedOutcome(userId, phrase));
        for (const [i, o] of outcomes.entries()) expect(o, `${userId}: "${group.phrases[i]}"`).toEqual(outcomes[0]);
      }
    });
  }
});

describe('a change of meaning changes the request', () => {
  for (const c of cases.contrasts) {
    it(`${c.change} (${c.differsIn})`, () => {
      const [ra, rb] = [read(c.a.phrase), read(c.b.phrase)];
      expectResult(c.a.phrase, ra, c.a.expect as Expect);
      expectResult(c.b.phrase, rb, c.b.expect as Expect);
      // Never the same request for both sides: either the named field differs, or one side asks.
      if (ra.kind === 'intent' && rb.kind === 'intent') {
        expect(sameIntent(ra.intent, rb.intent)).toBe(false);
        expect(field(ra.intent, c.differsIn), c.differsIn).not.toEqual(field(rb.intent, c.differsIn));
      }
    });
  }
});

describe('what cannot be read exactly is asked about', () => {
  for (const c of cases.clarify) {
    it(`"${c.phrase}" asks (${c.why})`, () => {
      expect(read(c.phrase).kind).toBe('clarify');
    });
  }
});

describe('follow-ups carry or reset context by the follow_up rule', () => {
  for (const f of cases.followUps) {
    it(`${JSON.stringify(f.previous)} + "${f.phrase}"`, () => {
      expectResult(f.phrase, read(f.phrase, f.previous as Intent), f.expect as Intent);
    });
  }
});

describe('wordings the deterministic model does not read yet', () => {
  for (const g of cases.safeGaps) {
    it(`"${g.phrase}" is answered correctly, asked about or declined, never read as another request`, () => {
      expect(['correct', 'asked', 'declined']).toContain(semanticVerdict(g.intended as Intent, read(g.phrase)));
    });
  }
});

describe('a valid but wrong metric is a semantic failure, even when access and SQL succeed', () => {
  it('a model that reads a count question as open pipeline gets an authorized answer, and the verdict still fails it', async () => {
    const phrase = 'how many open deals do we have';
    const wrong: Intent = { metric: 'open_pipeline', filters: {}, groupBy: [] };
    const model: IntentModel = { name: 'stub-wrong-metric', propose: async () => ({ kind: 'intent', intent: wrong }) };
    const r = await ask(database, reg, 'u_ts_east', phrase, { model });
    // Authorization and compilation are satisfied: the East seller gets an in-scope open pipeline answer.
    expect(r.kind).toBe('answer');
    expect((r as Answer).metric.id).toBe('open_pipeline');
    // The semantic check against the human-reviewed expectation still fails it.
    const expected = cases.equivalent.find((g) => g.phrases.includes(phrase))!.intent as Intent;
    expect(semanticVerdict(expected, { kind: 'intent', intent: (r as Answer).intent as Intent })).toBe('wrong_metric');
    expect(semanticVerdict(expected, read(phrase))).toBe('correct');
  });
});

describe('a comparison of named regions is answered region by region (PR #51 review)', () => {
  it('asks instead of adding region when the question already has two breakdowns', () => {
    expect(read('compare open pipeline by stage and by owner in east vs west').kind).toBe('clarify');
  });

  it('applies the same rule to a model reply, so Claude cannot return one combined figure either', () => {
    const combined: Intent = { metric: 'pipeline_coverage', filters: { regions: ['east', 'west'], period: 'FY27-Q1' }, groupBy: [] };
    const r = followUpRule({ kind: 'intent', intent: combined }, 'Is East pipeline coverage higher than West this quarter?', reg, undefined);
    expect(r).toEqual({ kind: 'intent', intent: { ...combined, groupBy: ['region'] } });
  });

  it('the by-region answer shows each named region on its own row, and nothing else', async () => {
    const r = await ask(database, reg, 'u_analyst', 'Is East pipeline coverage higher than West this quarter?');
    if (r.kind !== 'answer') throw new Error(r.kind);
    expect(r.rows.map((row) => row.region)).toEqual(['east', 'west']);
  });
});

// PR #51 review: the measure-word and two-metric checks run on the model path too, so Claude asks where the
// deterministic model asks. Proposals go through followUpRule exactly as a Claude response would.
describe('the model path asks where the deterministic model asks', () => {
  const intent = (metric: string, filters: Intent['filters'] = {}, groupBy: Intent['groupBy'] = []): Intent => ({ metric, filters, groupBy });
  const viaModel = (phrase: string, proposal: Intent) => followUpRule({ kind: 'intent', intent: proposal }, phrase, reg, undefined);
  const Q1 = { period: 'FY27-Q1' };

  it.each([
    ['total value of open opportunities', intent('open_opportunity_count')],
    ['value of open opportunities by region', intent('open_opportunity_count', {}, ['region'])],
    ['how many open pipeline deals this quarter', intent('open_pipeline', Q1)],
    ['how does pipeline compare to quota this quarter', intent('open_pipeline', Q1)],
  ])('a model reading "%s" as the wrong metric is asked about', (phrase, wrong) => {
    expect(viaModel(phrase, wrong).kind).toBe('clarify');
  });

  it.each([
    ['total value of open opportunities', intent('open_pipeline')],
    ['how does pipeline compare to quota this quarter', intent('pipeline_coverage', Q1)],
  ])('a model reading "%s" as the right metric is answered', (phrase, right) => {
    expect(viaModel(phrase, right)).toEqual({ kind: 'intent', intent: right });
  });

  it.each([
    ['Compare open pipeline with open opportunity count by region.', intent('open_opportunity_count', {}, ['region'])],
    ['Show pipeline coverage and open pipeline for this quarter', intent('pipeline_coverage', Q1)],
  ])('a model answering one metric for "%s", which names two, is asked about', (phrase, one) => {
    expect(viaModel(phrase, one)).toEqual({ kind: 'clarify', question: expect.stringMatching(/^Do you mean .+ or .+\?$/) });
  });

  it("the correct reading of every equivalent wording passes through unchanged", () => {
    for (const group of cases.equivalent) {
      for (const phrase of group.phrases) {
        expect(viaModel(phrase, group.intent as Intent), phrase).toEqual({ kind: 'intent', intent: group.intent });
      }
    }
  });
});
