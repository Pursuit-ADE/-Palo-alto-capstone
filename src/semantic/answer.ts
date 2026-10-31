// End-to-end governed answer: phrase -> intent -> validation -> scope -> compiled SQL -> result with provenance.
// Every call writes one audit row (PRD S4), including refusals. If the audit row can't be written, no answer is returned.
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { Database } from '../db/client';
import { queryAudit } from '../db/schema';
import type { Registry } from '../registry/load';
import { IntentError, validateIntent } from './compile';
import { Intent as IntentSchema, type Intent } from '../registry/types';
import { normalize, type NormalizeResult } from './normalize';
import { flagQuestion } from './flags';
import { notifySecurity } from '../server/security-notify';
import { currentSnapshot, run, type Answer, type AuditFields } from './governed';
import { EXPLAINED_METRIC, explainDiscrepancy, isDiscrepancyQuestion, type Explanation } from './explain';
import { deterministicModel, type IntentModel } from './model';
import { topicOf } from '../audit/topics';
import { ALL_REGIONS, resolvePrincipal, ScopeViolation, type Principal } from './scope';

export { currentSnapshot, type Answer, type RatioPart } from './governed';

export const MAX_QUESTION_LENGTH = 300;

export type Reply = Answer | Explanation | { kind: 'clarify'; question: string; resume?: Intent } | { kind: 'unsupported'; message: string };

// Questions are short and predictable, so a plain hash could be reversed by hashing likely questions. The
// audit log stores a keyed hash (HMAC-SHA-256) instead. Set AUDIT_HASH_KEY to keep fingerprints comparable
// across restarts and instances; without it, each process uses its own random key.
const AUDIT_KEY = process.env.AUDIT_HASH_KEY || randomBytes(32).toString('hex');

/** The audit fingerprint of a question (or of model text that may echo it). Never the text itself. */
export function questionFingerprint(text: string): string {
  return createHmac('sha256', AUDIT_KEY).update(text).digest('hex');
}

type AuditRow = AuditFields & { id: string; userId: string; source: string; outcome: string; requestId: string };

/** Writes the request's audit row, plus any linked rows (a comparison's second figure) in the same statement. */
async function audit(database: Database, entry: AuditRow, linked: AuditRow[] = []) {
  const row = { at: new Date(), ...entry };
  await database.auditDb.insert(queryAudit).values([row, ...linked.map((l) => ({ ...l, at: row.at }))]);
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

/** Audits a question refused before the pipeline runs (the per-user rate limit), so floods show up in the log. */
export async function recordRefusal(database: Database, userId: string, question: string, outcome: string, reason: string, actor?: AskOptions['actor']) {
  await audit(database, {
    id: randomUUID(),
    userId,
    source: 'question',
    requestId: randomUUID(),
    outcome,
    reason,
    questionSha256: questionFingerprint(question),
    topic: topicOf(question),
    username: actor?.username ?? null,
    sessionId: actor?.sessionId ?? null,
  });
}

/** Who asked, copied onto linked rows so each row of a request names the same account and session. */
const actorOf = (f: AuditFields) => ({ username: f.username ?? null, sessionId: f.sessionId ?? null, questionSha256: f.questionSha256 ?? null });

async function audited<T extends Reply>(
  database: Database,
  userId: string,
  source: string,
  question: string | null,
  actor: AskOptions['actor'],
  body: (fields: AuditFields, principal: () => Promise<Principal>, linked: AuditFields[]) => Promise<T>,
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
  const linked: AuditFields[] = [];
  let result: T;
  try {
    result = await body(fields, principal, linked);
  } catch (e) {
    await audit(database, { ...fields, id: auditId, userId, source, requestId, ...outcomeOf(e) });
    throw e;
  }
  const outcome = result.kind === 'answer' ? 'answered' : result.kind;
  const linkedRows = linked.map((l) => ({ ...l, ...actorOf(fields), id: randomUUID(), userId, source: 'comparison_side', requestId, outcome: 'answered' }));
  // The topic label is for questions that were not answered; an answer or an explanation already names its metric.
  const answered = outcome === 'answered' || outcome === 'explanation';
  await audit(database, { ...fields, id: auditId, userId, source, requestId, outcome, topic: answered ? null : (fields.topic ?? null) }, linkedRows);
  // The audit ID is filled in only once its row is written.
  const withId = (a: Answer, id: string): Answer => ({ ...a, provenance: { ...a.provenance, auditId: id } });
  if (result.kind === 'answer') return { ...result, provenance: { ...result.provenance, auditId } };
  if (result.kind === 'explanation') {
    return { ...result, answer: withId(result.answer, auditId), other: result.other && withId(result.other, linkedRows[0]?.id ?? auditId) };
  }
  return result;
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

/** The checks every question passes before anything reads it: the session lock (S3), the length cap and the flags. */
async function screen(phrase: string, userId: string, p: Principal, opts: AskOptions, fields: AuditFields) {
  if (await opts.guard?.isLocked(userId)) throw new SessionLocked();
  if (phrase.length > MAX_QUESTION_LENGTH) throw new IntentError(`Questions are limited to ${MAX_QUESTION_LENGTH} characters.`);
  const flags = flagQuestion(phrase, p.ownerIds === null && p.regions.length === ALL_REGIONS.length);
  fields.flags = flags;
  if (flags.length) await opts.guard?.record(userId);
  // A link could carry instructions from someone else. An instruction to ignore the rules is refused even
  // when the rest of the question is in scope. Both are logged; neither is fetched or obeyed.
  if (flags.includes('link')) throw new InjectionRefused('link');
  if (flags.includes('instruction_override')) throw new InjectionRefused('instruction_override');
}

/**
 * The deterministic reading is an independent check on the model's choice of metric. When they disagree, or the
 * reading had to ask which metric is meant, the user is asked; a different metric is never silently substituted.
 * The question names the two readings from the registry, so it stays current when a metric is added. A reading
 * that asks about anything else (a missing quarter, say) lets the model's proposal through (#52 review).
 */
function checkMetric(proposal: NormalizeResult, expected: NormalizeResult, registry: Registry): NormalizeResult {
  if (proposal.kind !== 'intent') return proposal;
  if (expected.kind === 'clarify' && expected.about === 'metric') return expected;
  if (expected.kind !== 'intent' || proposal.intent.metric === expected.intent.metric) return proposal;
  const names = [expected.intent.metric, proposal.intent.metric].map((id) => registry.metrics.get(id)?.name).join(' or ');
  return { kind: 'clarify', question: `Do you mean ${names}?`, about: 'metric' };
}

/** Answers a typed question (or a follow-up) for a user, with audit. Every turn is validated and scoped afresh. */
export function ask(database: Database, registry: Registry, userId: string, phrase: string, opts: AskOptions = {}): Promise<Reply> {
  const model = opts.model ?? deterministicModel;
  return audited<Reply>(database, userId, 'question', phrase, opts.actor, async (fields, principal, linked) => {
    // A label from a fixed list (src/audit/topics.ts), never the words, so unanswered questions can be counted by topic.
    Object.assign(fields, { flags: flagQuestion(phrase), model: model.name, turn: opts.turn ?? 1, topic: topicOf(phrase) });
    // The person is looked up first, so a locked or over-long question's audit row still records their role.
    await screen(phrase, userId, await principal(), opts, fields);
    // "Why is my coverage different?" gets a fixed explanation inside the asker's scope, before any model sees it.
    const previous = parsePrevious(opts.previous);
    if (isDiscrepancyQuestion(phrase, registry, previous)) {
      Object.assign(fields, { metricId: EXPLAINED_METRIC });
      return explainDiscrepancy(database, registry, await principal(), phrase, previous, fields, linked);
    }
    const snapshot = await currentSnapshot(database);
    const asOfDate = snapshot?.asOfDate ?? new Date().toISOString().slice(0, 10);
    const proposal = await model.propose(phrase, registry, asOfDate, previous);
    if (proposal.kind === 'intent') validateIntent(proposal.intent, registry);
    const expected = model === deterministicModel ? proposal : normalize(phrase, registry, asOfDate, previous);
    const n = checkMetric(proposal, expected, registry);
    if (n.kind !== 'intent') {
      // A reason code and a fingerprint, never the model's text: a model can echo the question back, and the
      // audit log keeps only the question's hash.
      fields.reason = `${n.kind}:${questionFingerprint(n.kind === 'clarify' ? n.question : n.message).slice(0, 16)}`;
      return n;
    }
    // Scope is resolved again after the model returns: a role or team change made while the model was
    // working applies to this query, not just the next one.
    if (!snapshot) throw new Error('No data snapshot loaded');
    return run(database, registry, await principal(), n.intent, fields, snapshot);
  });
}
