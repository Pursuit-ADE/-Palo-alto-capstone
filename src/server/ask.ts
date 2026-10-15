// One submitted question, with the deterministic model as a fallback when the AI model is unavailable.
// The fallback is the same request, not a second one: its flags were already counted towards the session lock
// by the first attempt, so the retry doesn't count them again (it would lock a user early).
import type { Database } from '../db/client';
import type { Registry } from '../registry/load';
import { ask, SessionLocked, type AskOptions, type Reply } from '../semantic/answer';
import { IntentError } from '../semantic/compile';
import { deterministicModel, type IntentModel } from '../semantic/model';
import { ScopeViolation } from '../semantic/scope';

export type Refusal = { kind: 'refused'; message: string };

const KNOWN = (e: unknown): e is Error => e instanceof ScopeViolation || e instanceof IntentError || e instanceof SessionLocked;

export async function askWithFallback(
  database: Database,
  registry: Registry,
  userId: string,
  question: string,
  opts: AskOptions,
  model: IntentModel,
): Promise<Reply | Refusal> {
  try {
    return await ask(database, registry, userId, question, { ...opts, model });
  } catch (e) {
    if (KNOWN(e) || (e instanceof Error && e.name === 'InjectionRefused')) return { kind: 'refused', message: e.message };
    if (model !== deterministicModel) {
      const sameRequest = opts.guard ? { isLocked: () => false, record: () => {} } : undefined;
      try {
        return await ask(database, registry, userId, question, { ...opts, guard: sameRequest, model: deterministicModel });
      } catch (e2) {
        if (KNOWN(e2) || (e2 instanceof Error && e2.name === 'InjectionRefused')) return { kind: 'refused', message: e2.message };
      }
    }
    return { kind: 'refused', message: 'Something went wrong answering that question. Please try again.' };
  }
}
