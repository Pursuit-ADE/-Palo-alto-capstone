// Compiles a validated Intent into parameterized SQL. Table and column names come only from the
// registry allowlist; every user-influenced value travels as a bound parameter, never as SQL text.
import type { Registry } from '../registry/load';
import { Intent, type Dimension, type MetricDefinition, type Source } from '../registry/types';
import { findPeriod } from './periods';
import { effectiveRegions, type Principal } from './scope';

export interface CompiledQuery {
  text: string;
  params: unknown[];
  regions: string[];
}

export class IntentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntentError';
  }
}

const DIMENSION_COLUMN: Record<Dimension, string> = { region: 'region_id', stage: 'stage', owner: 'owner_user_id' };

/** Validates an intent from any source (mock normalizer or AI model) against the schema and the registry. */
export function validateIntent(raw: unknown, registry: Registry): { intent: Intent; metric: MetricDefinition } {
  const parsed = Intent.safeParse(raw);
  if (!parsed.success) throw new IntentError('The request does not match the allowed intent format.');
  const intent = parsed.data;
  const metric = registry.metrics.get(intent.metric);
  if (!metric) throw new IntentError(`Unknown metric: ${intent.metric}`);
  for (const d of intent.groupBy) {
    if (!metric.dimensions.includes(d)) throw new IntentError(`${metric.name} cannot be broken down by ${d}.`);
  }
  if (intent.filters.period && !findPeriod(intent.filters.period)) throw new IntentError(`Unknown period: ${intent.filters.period}`);
  if (metric.kind === 'ratio' && metric.requiresPeriod && !intent.filters.period) {
    throw new IntentError(`${metric.name} needs a period.`);
  }
  return { intent, metric };
}

class Params {
  values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

function whereFor(source: Source, alias: string, p: Params, snapshotId: string, regions: string[], principal: Principal, period?: string) {
  const where = [`${alias}.snapshot_id = ${p.add(snapshotId)}`, `${alias}.region_id = ANY(${p.add(regions)}::text[])`];
  for (const c of source.conditions) where.push(`${alias}.${c.column} = ${p.add(c.equals)}`);
  if (principal.ownerIds) {
    const ownerColumn = source.table === 'opportunities' ? 'owner_user_id' : 'user_id';
    where.push(`${alias}.${ownerColumn} = ANY(${p.add(principal.ownerIds)}::text[])`);
  }
  if (period) {
    const per = findPeriod(period)!;
    if (source.periodColumn === 'period') where.push(`${alias}.period = ${p.add(per.period)}`);
    else where.push(`${alias}.${source.periodColumn} BETWEEN ${p.add(per.start)}::date AND ${p.add(per.end)}::date`);
  }
  return where.join(' AND ');
}

function measureSql(source: Source, alias: string): string {
  return source.measure.fn === 'sum' ? `COALESCE(SUM(${alias}.${source.measure.column}), 0)` : 'COUNT(*)';
}

export function compile(intent: Intent, registry: Registry, principal: Principal, snapshotId: string): CompiledQuery {
  const metric = registry.metrics.get(intent.metric)!;
  const regions = effectiveRegions(principal, intent.filters.regions);
  const p = new Params();
  const period = intent.filters.period;

  if (metric.kind === 'aggregate') {
    const s = metric.source;
    let where = whereFor(s, 't', p, snapshotId, regions, principal, period);
    if (intent.filters.stages) where += ` AND t.stage = ANY(${p.add(intent.filters.stages)}::text[])`;
    const dims = intent.groupBy.map((d) => `t.${DIMENSION_COLUMN[d]} AS ${d}`);
    const groupCols = intent.groupBy.map((d) => `t.${DIMENSION_COLUMN[d]}`);
    const text = [
      `SELECT ${[...dims, `${measureSql(s, 't')} AS value`].join(', ')}`,
      `FROM ${s.table} t`,
      `WHERE ${where}`,
      groupCols.length ? `GROUP BY ${groupCols.join(', ')} ORDER BY ${groupCols.join(', ')}` : '',
    ].filter(Boolean).join('\n');
    return { text, params: p.values, regions };
  }

  // Ratio: numerator metric and denominator source, both per region, then joined.
  const num = registry.metrics.get(metric.numerator) as Extract<MetricDefinition, { kind: 'aggregate' }>;
  const numWhere = whereFor(num.source, 'n', p, snapshotId, regions, principal, period);
  const denWhere = whereFor(metric.denominator, 'd', p, snapshotId, regions, principal, period);
  const byRegion = intent.groupBy.includes('region');
  const text = [
    `WITH num AS (SELECT n.region_id, ${measureSql(num.source, 'n')} AS v FROM ${num.source.table} n WHERE ${numWhere} GROUP BY n.region_id),`,
    `den AS (SELECT d.region_id, ${measureSql(metric.denominator, 'd')} AS v FROM ${metric.denominator.table} d WHERE ${denWhere} GROUP BY d.region_id)`,
    byRegion
      ? `SELECT den.region_id AS region, COALESCE(num.v, 0) AS numerator, den.v AS denominator, ROUND(COALESCE(num.v, 0) / NULLIF(den.v, 0), 4) AS value FROM den LEFT JOIN num ON num.region_id = den.region_id ORDER BY den.region_id`
      : `SELECT x.numerator, x.denominator, ROUND(x.numerator / NULLIF(x.denominator, 0), 4) AS value FROM (SELECT COALESCE((SELECT SUM(v) FROM num), 0) AS numerator, (SELECT SUM(v) FROM den) AS denominator) x`,
  ].join('\n');
  return { text, params: p.values, regions };
}
