// End-to-end governed answer: phrase -> intent -> validation -> scope -> compiled SQL -> result with provenance.
// Every call writes one audit row (PRD S4), including refusals. If the audit row can't be written, no answer is returned.
import { createHash, randomUUID } from 'node:crypto';
import { desc } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dataSnapshots, queryAudit } from '../db/schema';
import type { Registry } from '../registry/load';
import { compile, IntentError, validateIntent } from './compile';
import { normalize } from './normalize';
import { resolvePrincipal, scopeStatement, ScopeViolation, type Principal } from './scope';

export const MAX_QUESTION_LENGTH = 300;

export interface Answer {
  kind: 'answer';
  metric: { id: string; name: string; version: number; unit: string };
  intent: unknown;
  rows: Record<string, string | number | null>[];
  scope: string;
  provenance: { snapshotId: string; asOfDate: string; resultHash: string };
}

export type Reply = Answer | { kind: 'clarify'; question: string } | { kind: 'unsupported'; message: string };

type AuditFields = Partial<typeof queryAudit.$inferInsert>;

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

async function audit(database: Database, entry: AuditFields & { userId: string; source: string; outcome: string; requestId: string }) {
  await database.auditDb.insert(queryAudit).values({ id: randomUUID(), at: new Date(), ...entry });
}

function outcomeOf(e: unknown): { outcome: string; reason: string } {
  if (e instanceof ScopeViolation) return { outcome: 'refused_scope', reason: e.message };
  if (e instanceof IntentError) return { outcome: 'refused_intent', reason: e.message };
  return { outcome: 'error', reason: e instanceof Error ? e.name : 'unknown' };
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
  return {
    kind: 'answer',
    metric: { id: metric.id, name: metric.name, version: metric.version, unit: metric.unit },
    intent,
    rows,
    scope: scopeStatement(principal, q.regions),
    provenance: { snapshotId: snapshot.id, asOfDate: snapshot.asOfDate, resultHash },
  };
}

async function audited<T extends Reply>(
  database: Database,
  userId: string,
  source: string,
  question: string | null,
  body: (fields: AuditFields, principal: () => Promise<Principal>) => Promise<T>,
): Promise<T> {
  const requestId = randomUUID();
  const fields: AuditFields = { questionSha256: question === null ? null : sha256(question) };
  const principal = async () => {
    const p = await resolvePrincipal(database.db, userId);
    fields.role = p.role;
    return p;
  };
  let result: T;
  try {
    result = await body(fields, principal);
  } catch (e) {
    await audit(database, { ...fields, userId, source, requestId, ...outcomeOf(e) });
    throw e;
  }
  const outcome = result.kind === 'answer' ? 'answered' : result.kind;
  await audit(database, { ...fields, userId, source, requestId, outcome });
  return result;
}

/** Runs a structured intent (dashboard tiles, or the future AI model) for a user, with audit. */
export function answerIntent(database: Database, registry: Registry, userId: string, rawIntent: unknown, source = 'intent'): Promise<Answer> {
  return audited(database, userId, source, null, async (fields, principal) => run(database, registry, await principal(), rawIntent, fields));
}

/** Answers a typed question for a user, with audit. */
export function ask(database: Database, registry: Registry, userId: string, phrase: string): Promise<Reply> {
  return audited<Reply>(database, userId, 'question', phrase, async (fields, principal) => {
    if (phrase.length > MAX_QUESTION_LENGTH) throw new IntentError(`Questions are limited to ${MAX_QUESTION_LENGTH} characters.`);
    const p = await principal();
    const snapshot = await currentSnapshot(database);
    const n = normalize(phrase, registry, snapshot?.asOfDate ?? new Date().toISOString().slice(0, 10));
    if (n.kind !== 'intent') {
      fields.reason = n.kind === 'clarify' ? n.question : n.message;
      return n;
    }
    return run(database, registry, p, n.intent, fields);
  });
}
