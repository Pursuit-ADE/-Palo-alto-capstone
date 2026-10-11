import fs from 'node:fs';
import path from 'node:path';
import { Dictionary, Glossary, MetricDefinition, ALLOWED_COLUMNS, type AllowedTable } from './types';

export interface Registry {
  metrics: Map<string, MetricDefinition>;
  dictionary: Dictionary;
  glossary: Glossary;
}

const ROOT = path.join(process.cwd(), 'registry');

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Loads and validates the versioned registry files. Throws on any invalid or unsafe definition. */
export function loadRegistry(root: string = ROOT): Registry {
  const metrics = new Map<string, MetricDefinition>();
  const dir = path.join(root, 'metrics');
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const m = MetricDefinition.parse(readJson(path.join(dir, f)));
    if (metrics.has(m.id)) throw new Error(`Duplicate metric id ${m.id}`);
    metrics.set(m.id, m);
  }
  const dictionary = Dictionary.parse(readJson(path.join(root, 'dictionary.json')));
  const glossary = Glossary.parse(readJson(path.join(root, 'glossary.json')));
  const reg = { metrics, dictionary, glossary };
  assertSafe(reg);
  return reg;
}

function assertColumn(table: AllowedTable, column: string, metricId: string) {
  if (!(ALLOWED_COLUMNS[table] as readonly string[]).includes(column)) {
    throw new Error(`Metric ${metricId} uses column ${table}.${column}, which is not on the allowlist`);
  }
}

function assertSafe(reg: Registry) {
  for (const m of reg.metrics.values()) {
    if (m.kind === 'ratio') {
      const num = reg.metrics.get(m.numerator);
      if (!num || num.kind !== 'aggregate') throw new Error(`Metric ${m.id} numerator ${m.numerator} must be an aggregate metric`);
    }
    const s = m.kind === 'aggregate' ? m.source : m.denominator;
    if (s.measure.fn === 'sum') assertColumn(s.table, s.measure.column, m.id);
    for (const c of s.conditions) assertColumn(s.table, c.column, m.id);
    assertColumn(s.table, s.periodColumn, m.id);
  }
}
