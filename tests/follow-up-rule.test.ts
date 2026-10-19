// Audit F10: one follow-up rule for every intent model. A follow-up keeps the earlier filters only when it names
// no metric, or names the same metric with a follow-up word; naming a different metric starts fresh.
import { describe, expect, it } from 'vitest';
import { loadRegistry } from '@/registry/load';
import type { Intent } from '@/registry/types';
import { CLARIFY_TEXT, followUpRule } from '@/semantic/model';
import { continuesPrevious, normalize } from '@/semantic/normalize';

const reg = loadRegistry();
const AS_OF = '2026-10-08';
const previous: Intent = { metric: 'open_pipeline', filters: { regions: ['west'] }, groupBy: ['stage'] };
// What a model that keeps everything would propose for each question (Claude did this before the rule).
const carried = (metric: string, extra: Partial<Intent['filters']> = {}): Intent => ({ metric, filters: { regions: ['west'], ...extra }, groupBy: ['stage'] });

describe('follow-up rule', () => {
  it('is in the glossary for people to read', () => {
    expect(reg.glossary.businessRules.some((r) => r.id === 'follow_up')).toBe(true);
  });

  it('decides continuation the same way for both models', () => {
    expect(continuesPrevious('what about by region?', reg, previous, 'open_pipeline')).toBe(true);
    expect(continuesPrevious('and the open pipeline in central?', reg, previous, 'open_pipeline')).toBe(true);
    expect(continuesPrevious('how many open deals?', reg, previous, 'open_opportunity_count')).toBe(false);
    expect(continuesPrevious('what is our open pipeline?', reg, previous, 'open_pipeline')).toBe(false);
  });

  const cases: [string, Intent][] = [
    ['how many open deals?', carried('open_opportunity_count')],
    ['what is our open pipeline?', carried('open_pipeline')],
    ['open opportunities by region', { metric: 'open_opportunity_count', filters: { regions: ['west'] }, groupBy: ['stage', 'region'] }],
    ['open opportunities in west', carried('open_opportunity_count')],
  ];
  for (const [question, proposal] of cases) {
    it(`gives the same answer from both models for "${question}"`, () => {
      const keyword = normalize(question, reg, AS_OF, previous);
      const model = followUpRule({ kind: 'intent', intent: proposal }, question, reg, previous);
      expect(model).toEqual(keyword);
    });
  }

  it('keeps carried filters for a real follow-up', () => {
    const q = 'what about by region?';
    const proposal: Intent = { metric: 'open_pipeline', filters: { regions: ['west'] }, groupBy: ['region'] };
    expect(followUpRule({ kind: 'intent', intent: proposal }, q, reg, previous)).toEqual({ kind: 'intent', intent: proposal });
  });

  it('asks for the quarter when a fresh coverage question only had one from before', () => {
    const prev: Intent = { metric: 'pipeline_coverage', filters: { period: 'FY27-Q1' }, groupBy: [] };
    const r = followUpRule({ kind: 'intent', intent: { metric: 'pipeline_coverage', filters: { period: 'FY27-Q1' }, groupBy: [] } }, 'what is pipeline coverage?', reg, prev);
    expect(r).toMatchObject({ kind: 'clarify', question: CLARIFY_TEXT.period });
  });
});
