// End-to-end governed answer: phrase -> intent -> validation -> scope -> compiled SQL -> result with provenance.
// Every call writes one audit row (PRD S4), including refusals. If the audit row can't be written, no answer is returned.
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { desc, inArray } from 'drizzle-orm';
import type { Database } from '../db/client';
import { appUsers, dataSnapshots, queryAudit } from '../db/schema';
import type { Registry } from '../registry/load';
import { compile, IntentError, validateIntent } from './compile';
import { Intent as IntentSchema, type Dimension, type Intent, type MetricDefinition } from '../registry/types';
import { flagQuestion } from './flags';
import { notifySecurity } from '../server/security-notify';
import { deterministicModel, type IntentModel } from './model';
import { chartSpec, narrate, type OwnerNames } from './narrative';
import { findPeriod } from './periods';
import { ALL_REGIONS, resolvePrincipal, scopeStatement, ScopeViolation, type Principal } from './scope';

export const MAX_QUESTION_LENGTH = 300;

/** One side of a ratio metric (coverage): what it counts and the slice it was counted over. */
export interface RatioPart {
  label: string;
  definition: string;
  scope: string;
}

export interface Answer {
  kind: 'answer';
  /** Registry definition, so the panel shows exactly what was counted. */
  metric: { id: string; name: string; version: number; unit: string; definition: string; notes: string | null; owner: string };
  intent: unknown;
  rows: Record<string, string | number | null>[];
  scope: string;
  /** The filters the query actually applied, after scoping (not what the question asked for). */
  filters: {
    period: { label: string; start: string; end: string } | null;
    regions: string[];
    stages: string[] | null;
    groupBy: Dimension[];
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

export type Reply = Answer | { kind: 'clarify'; question: string; resume?: Intent } | { kind: 'unsupported'; message: string };

type AuditFields = Partial<typeof queryAudit.$inferInsert>;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// Questions are short and predictable, so a plain hash could be reversed by hashing likely questions. The
// audit log stores a keyed hash (HMAC-SHA-256) instead. Set AUDIT_HASH_KEY to keep fingerprints comparable
// across restarts and instances; without it, each process uses its own random key.
const AUDIT_KEY = process.env.AUDIT_HASH_KEY || randomBytes(32).toString('hex');

/** The audit fingerprint of a question (or of model text that may echo it). Never the text itself. */
export function questionFingerprint(text: string): string {
  return createHmac('sha256', AUDIT_KEY).update(text).digest('hex');
}

/** The snapshot answers come from: always the newest one, chosen explicitly rather than by row order. */
export async function currentSnapshot(database: Database) {
  const [snapshot] = await database.db
    .select()
    .from(dataSnapshots)
    .orderBy(desc(dataSnapshots.asOfDate), desc(dataSnapshots.loadedAt), desc(dataSnapshots.id))
    .limit(1);
  return snapshot;
}

async function audit(database: Database, entry: AuditFields & { id: string; userId: string; source: string; outcome: string; requestId: string }) {
  const row = { at: new Date(), ...entry };
  await database.auditDb.insert(queryAudit).values(row);
  // Flagged questions and locks also go to the security channel, if one is configured. Sent after the audit row
  // exists, without waiting, and never blocking or changing the answer.
  if (row.flags?.length || row.outcome === 'refused_locked') {
    void notifySecurity({ auditId: row.id, at: row.at, userId: row.userId, role: row.role, outcome: row.outcome, flags: row.flags ?? [] });
  }
}

/** Thrown when a user is locked out after repeated flagged questions (S3). */
export class SessionLocked extends Error {
  constructor() {
    super('Too many questions were flagged as unsafe. Asking is paused for a few minutes.');
    this.name = 'SessionLocked';
  }
}

/** Thrown when a question must not be answered: a link, or an attempt to override the rules. Logged, never fetched or obeyed. */
export class InjectionRefused extends Error {
  readonly code: 'link' | 'instruction_override';
  constructor(code: 'link' | 'instruction_override' = 'link') {
    super(
      code === 'link'
        ? "Questions can't include links. The copilot never opens them; ask about the governed metrics directly."
        : "Questions can't include instructions to ignore the rules. Ask about the governed metrics directly.",
    );
    this.name = 'InjectionRefused';
    this.code = code;
  }
}

/** The lock the caller enforces; see FlagGuard in src/server/limits.ts. */
export interface Guard {
  isLocked(user: string, now?: number): boolean | Promise<boolean>;
  record(user: string, now?: number): void | Promise<void>;
}

function outcomeOf(e: unknown): { outcome: string; reason: string } {
  if (e instanceof SessionLocked) return { outcome: 'refused_locked', reason: e.message };
  if (e instanceof InjectionRefused) return { outcome: 'refused_injection', reason: e.code };
  if (e instanceof ScopeViolation) return { outcome: 'refused_scope', reason: e.message };
  if (e instanceof IntentError) return { outcome: 'refused_intent', reason: e.message };
  return { outcome: 'error', reason: e instanceof Error ? e.name : 'unknown' };
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

async function run(database: Database, registry: Registry, principal: Principal, rawIntent: unknown, fields: AuditFields): Promise<Answer> {
  const { intent, metric } = validateIntent(rawIntent, registry);
  Object.assign(fields, { intent, metricId: metric.id, metricVersion: metric.version });
  const snapshot = await currentSnapshot(database);
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
    metric: {
      id: metric.id,
      name: metric.name,
      version: metric.version,
      unit: metric.unit,
      definition: metric.description,
      notes: metric.notes ?? null,
      owner: metric.owner,
    },
    intent,
    rows,
    scope,
    filters: {
      period: period ? { label: period.period, start: period.start, end: period.end } : null,
      regions: q.regions,
      stages: intent.filters.stages ?? null,
      groupBy: intent.groupBy,
    },
    parts: ratioParts(metric, registry, scope, intent.filters.period),
    narrative: narrate(metric, rows, intent.groupBy, intent.filters.period, names ?? undefined),
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

/** Names for the owners already in the (scoped) result rows, so charts and sentences show people, not ids. */
async function ownerNames(database: Database, rows: Answer['rows']): Promise<OwnerNames> {
  const ids = [...new Set(rows.map((r) => r.owner).filter((v): v is string => typeof v === 'string'))];
  if (ids.length === 0) return {};
  const found = await database.db.select({ id: appUsers.id, displayName: appUsers.displayName }).from(appUsers).where(inArray(appUsers.id, ids));
  return Object.fromEntries(found.map((u) => [u.id, u.displayName.split(' (')[0]!]));
}

async function audited<T extends Reply>(
  database: Database,
  userId: string,
  source: string,
  question: string | null,
  actor: AskOptions['actor'],
  body: (fields: AuditFields, principal: () => Promise<Principal>) => Promise<T>,
): Promise<T> {
  const requestId = randomUUID();
  const auditId = randomUUID();
  const fields: AuditFields = {
    questionSha256: question === null ? null : questionFingerprint(question),
    username: actor?.username ?? null,
    sessionId: actor?.sessionId ?? null,
  };
  const principal = async () => {
    const p = await resolvePrincipal(database.db, userId);
    fields.role = p.role;
    return p;
  };
  let result: T;
  try {
    result = await body(fields, principal);
  } catch (e) {
    await audit(database, { ...fields, id: auditId, userId, source, requestId, ...outcomeOf(e) });
    throw e;
  }
  const outcome = result.kind === 'answer' ? 'answered' : result.kind;
  await audit(database, { ...fields, id: auditId, userId, source, requestId, outcome });
  // The audit ID is filled in only once its row is written.
  return result.kind === 'answer' ? { ...result, provenance: { ...result.provenance, auditId } } : result;
}

/** Runs a structured intent (dashboard tiles, or the future AI model) for a user, with audit. */
export function answerIntent(database: Database, registry: Registry, userId: string, rawIntent: unknown, source = 'intent', actor?: AskOptions['actor']): Promise<Answer> {
  return audited(database, userId, source, null, actor, async (fields, principal) => run(database, registry, await principal(), rawIntent, fields));
}

export interface AskOptions {
  /** The previous turn's intent: the whole conversation state. Re-validated here; anything invalid is ignored. */
  previous?: unknown;
  /** Turn number in the conversation, for the audit log. */
  turn?: number;
  model?: IntentModel;
  /** Session lock after repeated flagged questions. */
  guard?: Guard;
  /** Which account and session asked, for the audit row. */
  actor?: { username?: string; sessionId?: string };
}

/** Parses a client-supplied previous intent. It is only a starting point: the new intent is validated and scoped afresh. */
export function parsePrevious(raw: unknown): Intent | undefined {
  const parsed = IntentSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Answers a typed question (or a follow-up) for a user, with audit. Every turn is validated and scoped afresh. */
export function ask(database: Database, registry: Registry, userId: string, phrase: string, opts: AskOptions = {}): Promise<Reply> {
  const model = opts.model ?? deterministicModel;
  return audited<Reply>(database, userId, 'question', phrase, opts.actor, async (fields, principal) => {
    Object.assign(fields, { flags: flagQuestion(phrase), model: model.name, turn: opts.turn ?? 1 });
    if (await opts.guard?.isLocked(userId)) throw new SessionLocked();
    if (phrase.length > MAX_QUESTION_LENGTH) throw new IntentError(`Questions are limited to ${MAX_QUESTION_LENGTH} characters.`);
    const p = await principal();
    const flags = flagQuestion(phrase, p.ownerIds === null && p.regions.length === ALL_REGIONS.length);
    fields.flags = flags;
    if (flags.length) await opts.guard?.record(userId);
    // A link could carry instructions from someone else. An instruction to ignore the rules is refused even
    // when the rest of the question is in scope. Both are logged; neither is fetched or obeyed.
    if (flags.includes('link')) throw new InjectionRefused('link');
    if (flags.includes('instruction_override')) throw new InjectionRefused('instruction_override');
    const snapshot = await currentSnapshot(database);
    const n = await model.propose(phrase, registry, snapshot?.asOfDate ?? new Date().toISOString().slice(0, 10), parsePrevious(opts.previous));
    if (n.kind !== 'intent') {
      // A reason code and a fingerprint, never the model's text: a model can echo the question back, and the
      // audit log keeps only the question's hash.
      fields.reason = `${n.kind}:${questionFingerprint(n.kind === 'clarify' ? n.question : n.message).slice(0, 16)}`;
      return n;
    }
    // Scope is resolved again after the model returns: a role or team change made while the model was
    // working applies to this query, not just the next one.
    return run(database, registry, await principal(), n.intent, fields);
  });
}
