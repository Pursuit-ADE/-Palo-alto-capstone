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
