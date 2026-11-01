// Compiles a validated Intent into parameterized SQL. Table and column names come only from the
// registry allowlist; every user-influenced value travels as a bound parameter, never as SQL text.
import { catalog } from '../db/seed';
import type { Registry } from '../registry/load';
import { Intent, type Dimension, type MetricDefinition, type Source } from '../registry/types';
import { findPeriod } from './periods';
import { effectiveRegions, ScopeViolation, type Principal } from './scope';

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

// Upper bound on rows any governed query can return (results are aggregates; this caps a bad breakdown).
export const MAX_RESULT_ROWS = 500;

/**
 * The request named something that isn't in the data. Fixed sentences that never repeat the value: a tampered previous
 * intent or a model can put any text in a name field, and this message is shown to the user and kept as the audit
 * row's reason (evaluator B-03; bug hunt, Oct 31).
 */
const NOT_IN_DATA = (what: string) => `That request names ${what} that isn't in the data.`;

const DIMENSION_COLUMN: Record<Dimension, string> = { region: 'region_id', stage: 'stage', owner: 'owner_user_id' };

/** Validates an intent from any source (mock normalizer or AI model) against the schema and the registry. */
export function validateIntent(raw: unknown, registry: Registry): { intent: Intent; metric: MetricDefinition } {
  const parsed = Intent.safeParse(raw);
  if (!parsed.success) throw new IntentError('The request does not match the allowed intent format.');
  const intent = parsed.data;
  const metric = registry.metrics.get(intent.metric);
  if (!metric) throw new IntentError(NOT_IN_DATA('a metric'));
  for (const d of intent.groupBy) {
    if (!metric.dimensions.includes(d)) throw new IntentError(`${metric.name} cannot be broken down by ${d}.`);
  }
  if (intent.filters.period && !findPeriod(intent.filters.period)) throw new IntentError(NOT_IN_DATA('a period'));
  // Coverage divides by quota, which has no stage, so a stage filter can't be applied consistently.
  // Refuse it rather than return an answer that silently ignores the filter.
  if (metric.kind === 'ratio' && intent.filters.stages) throw new IntentError(`${metric.name} can't be filtered by stage.`);
  // Quota is per rep and quarter. Deal size, product, account and sector exist only on opportunities,
  // so applying them to coverage would change the numerator and leave the denominator as the whole quota.
  if (
    metric.kind === 'ratio' &&
    (intent.filters.amount || intent.filters.products?.length || intent.filters.accounts?.length || intent.filters.sectors?.length)
  ) {
    throw new IntentError(`${metric.name} can't be filtered by deal size, product, account or sector, because quota isn't split that way.`);
  }
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

function resolveProducts(names: string[] | undefined): string[] | undefined {
  if (!names?.length) return undefined;
  const products = catalog().products;
  const ids = new Set<string>();
  for (const name of names) {
    const exact = products.filter((p) => p.id.toLowerCase() === name.toLowerCase());
    const series = products.filter((p) => p.series.toLowerCase() === name.toLowerCase());
    const hits = exact.length ? exact : series;
    if (!hits.length) throw new IntentError(NOT_IN_DATA('a product'));
    for (const hit of hits) ids.add(hit.id);
  }
  return [...ids];
}

function resolveAccounts(names: string[] | undefined, sectors: string[] | undefined): string[] | undefined {
  if (!names?.length && !sectors?.length) return undefined;
  const accounts = catalog().accounts;
  let rows = accounts;
  if (names?.length) {
    const wanted = new Set(names.map((n) => n.toLowerCase()));
    rows = rows.filter((a) => wanted.has(a.name.toLowerCase()));
    const known = new Set(rows.map((a) => a.name.toLowerCase()));
    const missing = names.filter((n) => !known.has(n.toLowerCase()));
    if (missing.length) throw new IntentError(NOT_IN_DATA('an account'));
  }
  if (sectors?.length) {
    const known = new Set(accounts.map((a) => a.sector.toLowerCase()));
    const missing = sectors.filter((s) => !known.has(s.toLowerCase()));
    if (missing.length) throw new IntentError(NOT_IN_DATA('a sector'));
    const wanted = new Set(sectors.map((s) => s.toLowerCase()));
    rows = rows.filter((a) => wanted.has(a.sector.toLowerCase()));
  }
  return rows.map((a) => a.id);
}

/** Rep ids for a person filter. A rep outside this principal's team is a scope refusal, not an empty answer. */
function resolvePeople(names: string[] | undefined, principal: Principal): string[] | undefined {
  if (!names?.length) return undefined;
  const owners = catalog().owners;
  const ids: string[] = [];
  const outside: string[] = [];
  for (const name of names) {
    const owner = owners.find((o) => o.name.toLowerCase() === name.toLowerCase());
    if (!owner) throw new IntentError(NOT_IN_DATA('a person'));
    if (principal.ownerIds && !principal.ownerIds.includes(owner.id)) outside.push(owner.name);
    ids.push(owner.id);
  }
  if (outside.length) throw new ScopeViolation(`You do not have access to ${outside.join(', ')}.`);
  return ids;
}

/** Reps who report to the named manager. A team outside this principal's scope is a refusal, not a partial number. */
function resolveTeams(names: string[] | undefined, principal: Principal): string[] | undefined {
  if (!names?.length) return undefined;
  const cat = catalog();
  const ids: string[] = [];
  const outside: string[] = [];
  for (const name of names) {
    const manager = cat.managers.find((m) => m.name.toLowerCase() === name.toLowerCase());
    if (!manager) throw new IntentError(NOT_IN_DATA('a team'));
    const reps = cat.owners.filter((o) => o.managerId === manager.id);
    if (!reps.length) throw new IntentError(NOT_IN_DATA('a team'));
    if (principal.ownerIds && reps.some((r) => !principal.ownerIds!.includes(r.id))) outside.push(manager.name);
    else for (const rep of reps) ids.push(rep.id);
  }
  if (outside.length) throw new ScopeViolation(`You do not have access to ${[...new Set(outside)].join(', ')}'s team.`);
  return [...new Set(ids)];
}

function limitPeople(personIds: string[] | undefined, teamIds: string[] | undefined): string[] | undefined {
  if (personIds && teamIds) return personIds.filter((id) => teamIds.includes(id));
  return personIds ?? teamIds;
}

function extraFilters(intent: Intent, alias: string, table: Source['table'], p: Params, people: string[] | undefined): string {
  const parts: string[] = [];
  if (people) {
    const column = table === 'opportunities' ? 'owner_user_id' : 'user_id';
    parts.push(people.length ? `${alias}.${column} = ANY(${p.add(people)}::text[])` : 'FALSE');
  }
  if (table !== 'opportunities') return parts.length ? ` AND ${parts.join(' AND ')}` : '';
  const amount = intent.filters.amount;
  if (amount?.min != null) parts.push(`${alias}.amount ${amount.minInclusive === false ? '>' : '>='} ${p.add(amount.min)}`);
  if (amount?.max != null) parts.push(`${alias}.amount ${amount.maxInclusive === false ? '<' : '<='} ${p.add(amount.max)}`);
  const products = resolveProducts(intent.filters.products);
  if (products) parts.push(`${alias}.product_id = ANY(${p.add(products)}::text[])`);
  const accounts = resolveAccounts(intent.filters.accounts, intent.filters.sectors);
  if (accounts) parts.push(`${alias}.account_id = ANY(${p.add(accounts)}::text[])`);
  return parts.length ? ` AND ${parts.join(' AND ')}` : '';
}

/**
 * Who carries a quota in this scope, and whether each rep has one for the requested period: a row per region and rep
 * with has_quota. The same snapshot, regions, owner limits, people and teams as the coverage query, so it looks at the
 * reps the figure divides over. Only reps who carry a quota in some period are listed: in the sample, some reps have no
 * quota in any period, and that is how the data says who carries one, not a gap. A rep who carries one but has none for
 * this period leaves the denominator smaller than the team's, so the ratio is overstated (project review, Nov 1).
 * Null for anything that is not a ratio over quota with a period.
 */
export function quotaCohortQuery(intent: Intent, registry: Registry, principal: Principal, snapshotId: string): CompiledQuery | null {
  const metric = registry.metrics.get(intent.metric);
  const period = intent.filters.period && findPeriod(intent.filters.period);
  if (metric?.kind !== 'ratio' || metric.denominator.table !== 'quotas' || !period) return null;
  const regions = effectiveRegions(principal, intent.filters.regions);
  const p = new Params();
  const people = limitPeople(resolvePeople(intent.filters.people, principal), resolveTeams(intent.filters.teams, principal));
  const where = whereFor(metric.denominator, 'd', p, snapshotId, regions, principal) + extraFilters(intent, 'd', metric.denominator.table, p, people);
  const column = metric.denominator.periodColumn;
  const inPeriod = column === 'period' ? `d.period = ${p.add(period.period)}` : `d.${column} BETWEEN ${p.add(period.start)}::date AND ${p.add(period.end)}::date`;
  const text = `SELECT d.region_id AS region, d.user_id AS rep, BOOL_OR(${inPeriod}) AS has_quota FROM ${metric.denominator.table} d WHERE ${where} GROUP BY d.region_id, d.user_id`;
  return { text, params: p.values, regions };
}

export function compile(intent: Intent, registry: Registry, principal: Principal, snapshotId: string): CompiledQuery {
  const metric = registry.metrics.get(intent.metric)!;
  const regions = effectiveRegions(principal, intent.filters.regions);
  const p = new Params();
  const period = intent.filters.period;
  const people = limitPeople(resolvePeople(intent.filters.people, principal), resolveTeams(intent.filters.teams, principal));

  if (metric.kind === 'aggregate') {
    const s = metric.source;
    let where = whereFor(s, 't', p, snapshotId, regions, principal, period);
    where += extraFilters(intent, 't', s.table, p, people);
    if (intent.filters.stages) where += ` AND t.stage = ANY(${p.add(intent.filters.stages)}::text[])`;
    const dims = intent.groupBy.map((d) => `t.${DIMENSION_COLUMN[d]} AS ${d}`);
    const groupCols = intent.groupBy.map((d) => `t.${DIMENSION_COLUMN[d]}`);
    const text = [
      `SELECT ${[...dims, `${measureSql(s, 't')} AS value`].join(', ')}`,
      `FROM ${s.table} t`,
      `WHERE ${where}`,
      groupCols.length ? `GROUP BY ${groupCols.join(', ')} ORDER BY ${groupCols.join(', ')} LIMIT ${MAX_RESULT_ROWS}` : '',
    ].filter(Boolean).join('\n');
    return { text, params: p.values, regions };
  }

  // Ratio: numerator metric and denominator source, both per region, then joined.
  const num = registry.metrics.get(metric.numerator) as Extract<MetricDefinition, { kind: 'aggregate' }>;
  const numWhere = whereFor(num.source, 'n', p, snapshotId, regions, principal, period) + extraFilters(intent, 'n', num.source.table, p, people);
  const denWhere = whereFor(metric.denominator, 'd', p, snapshotId, regions, principal, period) + extraFilters(intent, 'd', metric.denominator.table, p, people);
  const byRegion = intent.groupBy.includes('region');
  const text = [
    `WITH num AS (SELECT n.region_id, ${measureSql(num.source, 'n')} AS v FROM ${num.source.table} n WHERE ${numWhere} GROUP BY n.region_id),`,
    `den AS (SELECT d.region_id, ${measureSql(metric.denominator, 'd')} AS v FROM ${metric.denominator.table} d WHERE ${denWhere} GROUP BY d.region_id)`,
    byRegion
      ? `SELECT COALESCE(den.region_id, num.region_id) AS region, COALESCE(num.v, 0) AS numerator, den.v AS denominator, ROUND(COALESCE(num.v, 0) / NULLIF(den.v, 0), 4) AS value FROM den FULL OUTER JOIN num ON num.region_id = den.region_id ORDER BY region`
      : `SELECT x.numerator, x.denominator, ROUND(x.numerator / NULLIF(x.denominator, 0), 4) AS value FROM (SELECT COALESCE((SELECT SUM(v) FROM num), 0) AS numerator, (SELECT SUM(v) FROM den) AS denominator) x`,
  ].join('\n');
  return { text, params: p.values, regions };
}
