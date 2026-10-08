// End-to-end governed answer: phrase -> intent -> validation -> scope -> compiled SQL -> result with provenance.
import { createHash } from 'node:crypto';
import type { Database } from '../db/client';
import { dataSnapshots } from '../db/schema';
import type { Registry } from '../registry/load';
import { compile, validateIntent } from './compile';
import { normalize } from './normalize';
import { resolvePrincipal, scopeStatement } from './scope';

export interface Answer {
  kind: 'answer';
  metric: { id: string; name: string; version: number; unit: string };
  intent: unknown;
  rows: Record<string, string | number | null>[];
  scope: string;
  provenance: { snapshotId: string; asOfDate: string; resultHash: string };
}

export type Reply = Answer | { kind: 'clarify'; question: string } | { kind: 'unsupported'; message: string };

export async function answerIntent(database: Database, registry: Registry, userId: string, rawIntent: unknown): Promise<Answer> {
  const { intent, metric } = validateIntent(rawIntent, registry);
  const principal = await resolvePrincipal(database.db, userId);
  const [snapshot] = await database.db.select().from(dataSnapshots);
  if (!snapshot) throw new Error('No data snapshot loaded');
  const q = compile(intent, registry, principal, snapshot.id);
  const res = await database.client.query<Record<string, unknown>>(q.text, q.params);
  const rows = res.rows.map((r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && k !== 'region' && k !== 'stage' && k !== 'owner' ? Number(v) : (v as string | number | null)]),
    ),
  );
  const resultHash = createHash('sha256').update(JSON.stringify({ intent, rows, snapshot: snapshot.id })).digest('hex').slice(0, 16);
  return {
    kind: 'answer',
    metric: { id: metric.id, name: metric.name, version: metric.version, unit: metric.unit },
    intent,
    rows,
    scope: scopeStatement(principal, q.regions),
    provenance: { snapshotId: snapshot.id, asOfDate: snapshot.asOfDate, resultHash },
  };
}

export async function ask(database: Database, registry: Registry, userId: string, phrase: string): Promise<Reply> {
  const [snapshot] = await database.db.select().from(dataSnapshots);
  const n = normalize(phrase, registry, snapshot?.asOfDate ?? new Date().toISOString().slice(0, 10));
  if (n.kind !== 'intent') return n;
  return answerIntent(database, registry, userId, n.intent);
}
