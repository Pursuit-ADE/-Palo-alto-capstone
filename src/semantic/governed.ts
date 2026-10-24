// The governed query step shared by questions and explanations: validated intent -> scope -> compiled SQL -> rows
// with provenance. Callers audit it (src/semantic/answer.ts); nothing here writes an audit row.
import { createHash } from 'node:crypto';
import { desc, inArray } from 'drizzle-orm';
import type { Database } from '../db/client';
import { catalog } from '../db/seed';
import { appUsers, dataSnapshots, type queryAudit } from '../db/schema';
import type { Registry } from '../registry/load';
import { compile, validateIntent } from './compile';
import type { Dimension, Intent, MetricDefinition } from '../registry/types';
import { chartSpec, narrate, type OwnerNames } from './narrative';
import { findPeriod } from './periods';
import { scopeStatement, type Principal } from './scope';

/** One side of a ratio metric (coverage): what it counts and the slice it was counted over. */
export interface RatioPart {
  label: string;
  definition: string;
  scope: string;
}

export interface Answer {
  kind: 'answer';
  /** Registry definition, so the panel shows exactly what was counted. */
  metric: { id: string; name: string; version: number; unit: string; definition: string; notes: string | null; owner: string; target: number | null; caution: number | null };
  intent: unknown;
  rows: Record<string, string | number | null>[];
  scope: string;
  /** The filters the query actually applied, after scoping (not what the question asked for). */
  filters: {
    period: { label: string; start: string; end: string } | null;
    regions: string[];
    stages: string[] | null;
    groupBy: Dimension[];
    amount: Intent['filters']['amount'] | null;
    products: string[] | null;
    accounts: string[] | null;
    sectors: string[] | null;
    people: string[] | null;
    teams: string[] | null;
  };
  /** For ratio metrics, the numerator and denominator with their scopes; null otherwise. */
  parts: { numerator: RatioPart; denominator: RatioPart } | null;
  /** Plain-language summary built from the rows (never from a model). */
  narrative: string;
  /** Vega-Lite bar chart spec for a single breakdown, or null. */
  chart: ReturnType<typeof chartSpec>;
  /** For a breakdown by owner: each owner id in the rows mapped to the person's name, for labels. Rows and the chart spec keep the ids. Null otherwise. */
  ownerNames: OwnerNames | null;
  provenance: {
    snapshotId: string;
    asOfDate: string;
    /** When the snapshot was loaded (ISO 8601). */
    loadedAt: string;
    /** What the snapshot contains (from the snapshot row: sample data and which tables are synthetic). */
    dataNote: string | null;
    resultHash: string;
    /** The query_audit row for this answer. Empty until the row is written; an answer is never returned without it. */
    auditId: string;
  };
}

export type AuditFields = Partial<typeof queryAudit.$inferInsert>;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The snapshot answers come from: always the newest one, chosen explicitly rather than by row order. */
export async function currentSnapshot(database: Database) {
  const [snapshot] = await database.db
    .select()
    .from(dataSnapshots)
    .orderBy(desc(dataSnapshots.asOfDate), desc(dataSnapshots.loadedAt), desc(dataSnapshots.id))
    .limit(1);
  return snapshot;
}

/** Ratio metrics (coverage): the numerator and denominator both use the asker's scope and the same period. */
function ratioParts(metric: MetricDefinition, registry: Registry, scope: string, period: string | undefined): Answer['parts'] {
  if (metric.kind !== 'ratio') return null;
  const num = registry.metrics.get(metric.numerator);
  const slice = scope.replace(/^Scope: /, '').replace(/\.$/, '');
  const when = period ? ` for ${period}` : '';
  return {
    numerator: {
      label: `${num?.name ?? metric.numerator} v${num?.version ?? '?'}`,
      definition: `${num?.description ?? ''} Only deals with an expected close date in ${period ?? 'the period'}.`.trim(),
      scope: `${slice}${when}.`,
    },
    denominator: {
      label: 'Quota',
      definition: `Sum of quota${when} for the same sales reps.`,
      scope: `${slice}${when}.`,
    },
  };
}

function answerMetric(metric: MetricDefinition): Answer['metric'] {
  return {
    id: metric.id,
    name: metric.name,
    version: metric.version,
    unit: metric.unit,
    definition: metric.description,
    notes: metric.notes ?? null,
    owner: metric.owner,
    target: metric.kind === 'ratio' ? (metric.target ?? null) : null,
    caution: metric.kind === 'ratio' ? (metric.caution ?? null) : null,
  };
}

export async function run(database: Database, registry: Registry, principal: Principal, rawIntent: unknown, fields: AuditFields, pinnedSnapshot?: NonNullable<Awaited<ReturnType<typeof currentSnapshot>>>): Promise<Answer> {
  const { intent, metric } = validateIntent(rawIntent, registry);
  Object.assign(fields, { intent, metricId: metric.id, metricVersion: metric.version });
  const snapshot = pinnedSnapshot ?? await currentSnapshot(database);
  if (!snapshot) throw new Error('No data snapshot loaded');
  const q = compile(intent, registry, principal, snapshot.id);
  Object.assign(fields, { regions: q.regions, ownerCount: principal.ownerIds?.length ?? null, snapshotId: snapshot.id });
  const res = await database.client.query<Record<string, unknown>>(q.text, q.params);
  const rows = res.rows.map((r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && k !== 'region' && k !== 'stage' && k !== 'owner' ? Number(v) : (v as string | number | null)]),
    ),
  );
  const resultHash = sha256(JSON.stringify({ intent, rows, snapshot: snapshot.id })).slice(0, 16);
  fields.resultHash = resultHash;
  const scope = scopeStatement(principal, q.regions);
  const period = intent.filters.period ? findPeriod(intent.filters.period) : undefined;
  const names = intent.groupBy.includes('owner') ? await ownerNames(database, rows) : null;
  return {
    kind: 'answer',
    metric: answerMetric(metric),
    intent,
    rows,
    scope,
    filters: {
      period: period ? { label: period.period, start: period.start, end: period.end } : null,
      regions: q.regions,
      stages: intent.filters.stages ?? null,
      groupBy: intent.groupBy,
      amount: intent.filters.amount ?? null,
      products: intent.filters.products?.map(labelProduct) ?? null,
      accounts: intent.filters.accounts ?? null,
      sectors: intent.filters.sectors ?? null,
      people: intent.filters.people ?? null,
      teams: intent.filters.teams ?? null,
    },
    parts: ratioParts(metric, registry, scope, intent.filters.period),
    narrative: withFilterNote(narrate(metric, rows, intent.groupBy, intent.filters.period, names ?? undefined), intent),
    chart: chartSpec(metric, rows, intent.groupBy, names ?? undefined),
    ownerNames: names,
    provenance: {
      snapshotId: snapshot.id,
      asOfDate: snapshot.asOfDate,
      loadedAt: new Date(snapshot.loadedAt).toISOString(),
      dataNote: snapshot.notes ?? null,
      resultHash,
      auditId: '',
    },
  };
}

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function labelProduct(name: string): string {
  const products = catalog().products;
  if (products.some((p) => p.id.toLowerCase() === name.toLowerCase())) return name;
  if (products.some((p) => p.series.toLowerCase() === name.toLowerCase())) return `${name} series`;
  return name;
}

/** Says which extra filters the number used, so a filtered answer is not read as the whole scope. */
function withFilterNote(sentence: string, intent: Intent): string {
  const f = intent.filters;
  const bits: string[] = [];
  if (f.amount?.min != null && f.amount.max != null && f.amount.min === f.amount.max && f.amount.minInclusive !== false && f.amount.maxInclusive !== false) bits.push(money(f.amount.min));
  else if (f.amount) {
    if (f.amount.min != null) bits.push(`${f.amount.minInclusive === false ? 'over' : 'at least'} ${money(f.amount.min)}`);
    if (f.amount.max != null) bits.push(`${f.amount.maxInclusive === false ? 'under' : 'at most'} ${money(f.amount.max)}`);
  }
  if (f.products?.length) bits.push(f.products.map(labelProduct).join(', '));
  if (f.accounts?.length) bits.push(f.accounts.join(', '));
  if (f.sectors?.length) bits.push(`${f.sectors.join(', ')} sector`);
  if (f.people?.length) bits.push(f.people.join(', '));
  if (f.teams?.length) bits.push(f.teams.map((name) => `${name}'s team`).join(', '));
  return bits.length ? `${sentence} Filtered to ${bits.join('; ')}.` : sentence;
}

/** Names for the owners already in the (scoped) result rows, so charts and sentences show people, not ids. */
async function ownerNames(database: Database, rows: Answer['rows']): Promise<OwnerNames> {
  const ids = [...new Set(rows.map((r) => r.owner).filter((v): v is string => typeof v === 'string'))];
  if (ids.length === 0) return {};
  const found = await database.db.select({ id: appUsers.id, displayName: appUsers.displayName }).from(appUsers).where(inArray(appUsers.id, ids));
  return Object.fromEntries(found.map((u) => [u.id, u.displayName.split(' (')[0]!]));
}
