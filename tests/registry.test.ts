import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadRegistry } from '@/registry/load';

describe('metric registry and context layer', () => {
  const reg = loadRegistry();

  it('loads exactly the three governed Week 1 metrics', () => {
    expect([...reg.metrics.keys()].sort()).toEqual(['open_opportunity_count', 'open_pipeline', 'pipeline_coverage']);
  });

  it('pipeline coverage carries the confirmed 3x target and the 2x color boundary below it', () => {
    const coverage = reg.metrics.get('pipeline_coverage');
    expect(coverage?.kind).toBe('ratio');
    if (coverage?.kind !== 'ratio') return;
    const { target, caution } = coverage;
    expect(target).toBe(3);
    expect(caution).toBe(2);
    if (target == null || caution == null) return;
    expect(caution).toBeLessThan(target);
    expect(coverage.notes).toContain('Alex confirmed the 3.00x target for this demo on the midpoint check call');
    expect(coverage.notes).toContain('display-only and do not change the computed value');
    expect(coverage.description).not.toContain('The target is');
  });

  it('refuses a ratio target that is missing its pair or sits at or below the color boundary', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-target-'));
    fs.cpSync(path.join(process.cwd(), 'registry'), dir, { recursive: true });
    const file = path.join(dir, 'metrics', 'pipeline_coverage.json');
    const write = (patch: Record<string, unknown>) => {
      const metric = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
      fs.writeFileSync(file, JSON.stringify({ ...metric, ...patch }));
    };
    write({ caution: 4 });
    expect(() => loadRegistry(dir)).toThrow(/color boundary/);
    const onlyTarget = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    onlyTarget.target = 3;
    delete onlyTarget.caution;
    fs.writeFileSync(file, JSON.stringify(onlyTarget));
    expect(() => loadRegistry(dir)).toThrow(/both target and caution/);
  });

  it('documents every column a metric uses in the field dictionary', () => {
    for (const m of reg.metrics.values()) {
      const s = m.kind === 'aggregate' ? m.source : m.denominator;
      const fields = reg.dictionary.tables[s.table]?.fields ?? {};
      const cols = [s.periodColumn, ...s.conditions.map((c) => c.column)];
      if (s.measure.fn === 'sum') cols.push(s.measure.column);
      for (const c of cols) expect(fields[c], `${m.id} uses undocumented ${s.table}.${c}`).toBeTruthy();
    }
  });

  it('gives no two metrics the same synonym', () => {
    const seen = new Map<string, string>();
    for (const m of reg.metrics.values()) {
      for (const s of m.synonyms) {
        expect(seen.get(s.toLowerCase()), `synonym "${s}" is shared`).toBeUndefined();
        seen.set(s.toLowerCase(), m.id);
      }
    }
  });

  it('rejects a metric that references a column outside the allowlist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-'));
    fs.cpSync(path.join(process.cwd(), 'registry'), dir, { recursive: true });
    const file = path.join(dir, 'metrics', 'open_pipeline.json');
    const bad = JSON.parse(fs.readFileSync(file, 'utf8'));
    bad.source.measure.column = 'amount; DROP TABLE accounts';
    fs.writeFileSync(file, JSON.stringify(bad));
    expect(() => loadRegistry(dir)).toThrow();
  });
});
