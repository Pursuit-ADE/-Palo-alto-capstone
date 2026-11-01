// The governed query step shared by questions and explanations: validated intent -> scope -> compiled SQL -> rows
// with provenance. Callers audit it (src/semantic/answer.ts); nothing here writes an audit row.
import { createHash } from 'node:crypto';
import { desc, inArray } from 'drizzle-orm';
import type { Database } from '../db/client';
import { catalog } from '../db/seed';
import { appUsers, dataSnapshots, type queryAudit } from '../db/schema';
import type { Registry } from '../registry/load';
import { compile, quotaCohortQuery, validateIntent } from './compile';
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

/** Postgres returns sums and counts as strings; only the region, stage and owner columns stay text. */
function numericRow(r: Record<string, unknown>): Answer['rows'][number] {
  return Object.fromEntries(
    Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && k !== 'region' && k !== 'stage' && k !== 'owner' ? Number(v) : (v as string | number | null)]),
  );
}

/** The filters the query actually applied, after scoping, for the answer panel. */
function appliedFilters(intent: Intent, regions: string[]): Answer['filters'] {
  const f = intent.filters;
  const period = f.period ? findPeriod(f.period) : undefined;
  return {
    period: period ? { label: period.period, start: period.start, end: period.end } : null,
    regions,
    stages: f.stages ?? null,
    groupBy: intent.groupBy,
    amount: f.amount ?? null,
    products: f.products?.map(labelProduct) ?? null,
    accounts: f.accounts ?? null,
    sectors: f.sectors ?? null,
    people: f.people ?? null,
    teams: f.teams ?? null,
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
  // Before the hash, so the audit row's result is what the person is shown.
  const quota = await withholdIncompleteQuota(database, registry, principal, intent, snapshot.id, res.rows.map(numericRow));
  const rows = quota.rows;
  const resultHash = sha256(JSON.stringify({ intent, rows, snapshot: snapshot.id })).slice(0, 16);
  fields.resultHash = resultHash;
  const scope = scopeStatement(principal, q.regions);
  const names = intent.groupBy.includes('owner') ? await ownerNames(database, rows) : null;
  const answer: Answer = {
    kind: 'answer',
    metric: answerMetric(metric),
    intent,
    rows,
    scope,
    filters: appliedFilters(intent, q.regions),
    parts: ratioParts(metric, registry, scope, intent.filters.period),
    narrative: withFilterNote(narrate(metric, rows, intent.groupBy, intent.filters.period, names ?? undefined) + unlistedOwners(rows, intent, principal), intent),
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
  if (!quota.note) return answer;
  return { ...answer, narrative: quota.replacesNarrative ? quota.note : `${answer.narrative} ${quota.note}` };
}

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

/**
 * Coverage divides by the quota of the reps in scope. A rep who carries a quota in another period but has none for this
 * one leaves the denominator smaller than the team's, so the ratio is overstated and nothing said so (project review,
 * Nov 1). The value is withheld, as it already is when no quota exists at all, and the answer says how many reps are
 * missing. The numerator and denominator stay in the row so the receipt shows what was found. By region, only the
 * regions that are incomplete are withheld.
 */
async function withholdIncompleteQuota(
  database: Database,
  registry: Registry,
  principal: Principal,
  intent: Intent,
  snapshotId: string,
  rows: Answer['rows'],
): Promise<{ rows: Answer['rows']; note: string; replacesNarrative: boolean }> {
  const q = quotaCohortQuery(intent, registry, principal, snapshotId);
  if (!q) return { rows, note: '', replacesNarrative: false };
  const { rows: reps } = await database.client.query<{ region: string; has_quota: boolean }>(q.text, q.params);
  const gapIn = (region?: string) => {
    const inScope = reps.filter((r) => region === undefined || r.region === region);
    return { missing: inScope.filter((r) => !r.has_quota).length, of: inScope.length };
  };
  const period = intent.filters.period!;
  if (!intent.groupBy.includes('region')) {
    const gap = gapIn();
    if (gap.missing === 0) return { rows, note: '', replacesNarrative: false };
    const name = registry.metrics.get(intent.metric)!.name;
    const pipeline = money(Number(rows[0]?.numerator ?? 0));
    const note = `${name} for ${period} is not available: the quota for ${period} is missing for ${gap.missing} of ${gap.of} reps with a quota in scope, so dividing by the quota that is there would overstate coverage. ${pipeline} of open pipeline closes in the period.`;
    return { rows: rows.map((r) => ({ ...r, value: null })), note, replacesNarrative: true };
  }
  const gaps = rows.map((r) => ({ region: String(r.region), ...gapIn(String(r.region)) })).filter((g) => g.missing > 0);
  if (gaps.length === 0) return { rows, note: '', replacesNarrative: false };
  const incomplete = new Set(gaps.map((g) => g.region));
  const words = gaps.map((g) => `${g.missing} of ${g.of} reps with a quota in ${g.region[0]!.toUpperCase()}${g.region.slice(1)}`).join(' and ');
  const note = `The quota for ${period} is missing for ${words}, so coverage is not shown there.`;
  return { rows: rows.map((r) => (incomplete.has(String(r.region)) ? { ...r, value: null } : r)), note, replacesNarrative: false };
}

function labelProduct(name: string): string {
  const products = catalog().products;
  if (products.some((p) => p.id.toLowerCase() === name.toLowerCase())) return name;
  if (products.some((p) => p.series.toLowerCase() === name.toLowerCase())) return `${name} series`;
  return name;
}

/**
 * A breakdown by owner lists only reps with matching open deals, so "lowest" could name a rep above one who has none
 * (bug hunt, Oct 31: "(5 owners)" under a 6-rep scope). Says how many reps of the asker's scope, or of the reps the
 * question named, are missing. The analyst's scope has no fixed list of reps, so nothing is added there.
 */
function unlistedOwners(rows: Answer['rows'], intent: Intent, principal: Principal): string {
  if (intent.groupBy.length !== 1 || intent.groupBy[0] !== 'owner' || intent.filters.teams?.length) return '';
  const expected = intent.filters.people?.length ?? principal.ownerIds?.length;
  const missing = expected == null ? 0 : expected - rows.length;
  // With no rows at all the sentence already says nothing matched.
  if (missing <= 0 || rows.length === 0) return '';
  return missing === 1 ? " 1 rep in scope has no matching open deals and isn't listed." : ` ${missing} reps in scope have no matching open deals and aren't listed.`;
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
