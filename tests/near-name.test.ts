// A name one or two letters from a name in the data gets "Did you mean …?", and replying with that name answers
// (UX round 1, BH 6, Nov 2: "Darcel Schlect" got "I don't know that name" with nothing to try).
import { describe, expect, it } from 'vitest';
import { AS_OF_DATE } from '@/db/seed';
import { loadRegistry } from '@/registry/load';
import { normalize } from '@/semantic/normalize';

const reg = loadRegistry();
const asked = (q: string) => {
  const r = normalize(q, reg, AS_OF_DATE);
  return r.kind === 'clarify' ? r.question : `(${r.kind})`;
};

describe('a near name', () => {
  it.each([
    ['open pipeline for Darcel Schlect', 'Darcel Schlecht'],
    ['open pipeline for Gladys Colclouh', 'Gladys Colclough'],
    ['open pipeline for GTX Pr0', 'GTX Pro'],
  ])('"%s" asks "Did you mean %s?"', (q, name) => {
    expect(asked(q)).toContain(`Did you mean ${name}?`);
  });

  it('never repeats the typed name back', () => {
    expect(asked('open pipeline for Darcel Schlect')).not.toContain('Schlect');
  });

  it('a short, distant or first-name-only name gets the usual question', () => {
    expect(asked('open pipeline for Bob')).not.toContain('Did you mean');
    expect(asked('open pipeline for Zephyra Holdings')).not.toContain('Did you mean');
    expect(asked('open pipeline for Darcel')).toContain('full name');
  });

  it('replying with the suggested name finishes the question', () => {
    const first = normalize('open pipeline for Darcel Schlect next quarter', reg, AS_OF_DATE);
    expect(first.kind === 'clarify' && first.resume).toBeTruthy();
    const resume = first.kind === 'clarify' ? first.resume : undefined;
    const done = normalize('Darcel Schlecht', reg, AS_OF_DATE, resume);
    expect(done).toMatchObject({ kind: 'intent', intent: { metric: 'open_pipeline', filters: { people: ['Darcel Schlecht'], period: 'FY27-Q2' } } });
  });
});
