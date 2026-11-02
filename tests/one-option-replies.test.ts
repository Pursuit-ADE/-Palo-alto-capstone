// An ask-back with one possible answer says how to ask for it, and "last quarter" says it can't be answered instead of
// asking which of two other quarters was meant (REC and OPT round 2, finding 5, Nov 2).
import { describe, expect, it } from 'vitest';
import { AS_OF_DATE } from '@/db/seed';
import { loadRegistry } from '@/registry/load';
import type { Intent } from '@/registry/types';
import { normalize } from '@/semantic/normalize';

const reg = loadRegistry();
const coverageQ1: Intent = { metric: 'pipeline_coverage', filters: { period: 'FY27-Q1' }, groupBy: [] };
const asked = (q: string, previous?: Intent) => {
  const r = normalize(q, reg, AS_OF_DATE, previous);
  return r.kind === 'clarify' ? r.question : `(${r.kind})`;
};

describe('one-option ask-backs', () => {
  it('coverage "by stage" names the one breakdown it has and how to ask for it', () => {
    const q = asked('by stage', coverageQ1);
    expect(q).toBe('Pipeline coverage can\'t be broken down by stage. It can only be broken down by region: ask for "pipeline coverage by region".');
    expect(q).not.toContain('Which do you want?');
  });

  it('a metric with several breakdowns still asks which', () => {
    expect(asked('open pipeline by product')).not.toContain('It can only');
  });

  it('"compare to last quarter" says it can\'t, and a reply with a quarter still finishes', () => {
    const r = normalize('How does that compare to last quarter?', reg, AS_OF_DATE, coverageQ1);
    expect(r.kind === 'clarify' && r.question).toBe("I can't answer for last quarter, only for FY27-Q1 and FY27-Q2.");
    const resume = r.kind === 'clarify' ? r.resume : undefined;
    expect(normalize('next quarter', reg, AS_OF_DATE, resume)).toMatchObject({ kind: 'intent', intent: { metric: 'pipeline_coverage', filters: { period: 'FY27-Q2' } } });
  });

  it('other unanswerable periods ask as before', () => {
    expect(asked('open pipeline in October')).toBe('I can only answer for FY27-Q1 and FY27-Q2. Which of those do you mean?');
  });
});
