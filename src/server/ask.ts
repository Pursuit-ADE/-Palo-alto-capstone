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

/** The AI model failed (network, quota, timeout). Only this error triggers the fallback. */
export class ProviderError extends Error {
  constructor(readonly cause: unknown) {
    super('The AI model is unavailable.');
    this.name = 'ProviderError';
  }
}

/** Tags failures from the model itself, so a guard or database error is never mistaken for one. */
function tagged(model: IntentModel): IntentModel {
  return {
    name: model.name,
    async propose(...args) {
      try {
        return await model.propose(...args);
      } catch (e) {
        throw new ProviderError(e);
      }
    },
  };
}

/**
 * A circuit breaker for the AI model (audit AI2). After 3 provider failures within a minute, questions skip the
 * model for 5 minutes and go straight to the deterministic model, so a hung provider costs one timeout (CLAUDE_TIMEOUT_MS)
 * at most, not one per question. Per process.
 */
export class ModelBreaker {
  private failures: number[] = [];
  private openUntil = 0;
  constructor(private readonly threshold = 3, private readonly windowMs = 60_000, private readonly coolMs = 5 * 60_000) {}
  isOpen(now = Date.now()) {
    return now < this.openUntil;
  }
  failed(now = Date.now()) {
    this.failures = [...this.failures.filter((t) => now - t < this.windowMs), now];
    if (this.failures.length >= this.threshold) {
      this.openUntil = now + this.coolMs;
      this.failures = [];
    }
  }
}
export const modelBreaker = new ModelBreaker();

const KNOWN = (e: unknown): e is Error => e instanceof ScopeViolation || e instanceof IntentError || e instanceof SessionLocked;

export async function askWithFallback(
  database: Database,
  registry: Registry,
  userId: string,
  question: string,
  opts: AskOptions,
  model: IntentModel,
  breaker: ModelBreaker = modelBreaker,
): Promise<Reply | Refusal> {
  if (model !== deterministicModel && breaker.isOpen()) model = deterministicModel;
  try {
    return await ask(database, registry, userId, question, { ...opts, model: model === deterministicModel ? model : tagged(model) });
  } catch (e) {
    if (KNOWN(e) || (e instanceof Error && e.name === 'InjectionRefused')) return { kind: 'refused', message: e.message };
    // Fall back only when the model failed. By then this request already passed the lock check and its flags
    // were recorded (both happen before the model runs), so the retry neither checks nor counts them again.
    // Any other failure, such as the lock store being unreachable, is not retried around the lock.
    if (e instanceof ProviderError) {
      breaker.failed();
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
