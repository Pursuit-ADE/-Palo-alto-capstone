'use server';

// Questions are sent by POST (a Server Action), so their text never lands in URLs, browser history or access
// logs. Next.js checks the request's Origin against the host for Server Actions.
import { z } from 'zod';
import { demoUsers } from '@/db/seed';
import { ask, InjectionRefused, MAX_QUESTION_LENGTH, SessionLocked, type Reply } from '@/semantic/answer';
import { IntentError } from '@/semantic/compile';
import { deterministicModel, selectModel } from '@/semantic/model';
import { ScopeViolation } from '@/semantic/scope';
import { testIdentitiesEnabled } from '@/server/identity';
import { flagGuard, questionLimiter } from '@/server/limits';
import { getDatabase, getRegistry } from '@/server/runtime';

export type AskResult = Reply | { kind: 'refused'; message: string } | null;

const Question = z.string().trim().min(1).max(MAX_QUESTION_LENGTH);
// The conversation state the browser sends back: at most the previous intent (a few hundred bytes) and a turn count.
const PreviousJson = z.string().max(2000);
const Turn = z.coerce.number().int().min(1).max(50);
const DEMO_IDS = new Set(demoUsers().map((u) => u.id));

export async function askCopilot(_prev: AskResult, formData: FormData): Promise<AskResult> {
  // Test identities only. With real sign-in, the user id comes from the verified session here, never the form.
  const userId = formData.get('user');
  if (!testIdentitiesEnabled() || typeof userId !== 'string' || !DEMO_IDS.has(userId)) {
    return { kind: 'refused', message: 'Sign-in is not set up yet.' };
  }
  const parsed = Question.safeParse(formData.get('example') ?? formData.get('q'));
  if (!parsed.success) return { kind: 'refused', message: `Ask a question of 1 to ${MAX_QUESTION_LENGTH} characters.` };
  if (!questionLimiter.allow(userId)) return { kind: 'refused', message: 'Too many questions in the last minute. Please wait a moment and ask again.' };

  let previous: unknown;
  const prevRaw = PreviousJson.safeParse(formData.get('previous'));
  if (prevRaw.success && prevRaw.data) {
    try {
      previous = JSON.parse(prevRaw.data); // re-validated against the Intent schema inside ask()
    } catch {
      previous = undefined;
    }
  }
  const turn = Turn.safeParse(formData.get('turn'));
  const opts = { previous, turn: turn.success ? turn.data : 1, guard: flagGuard };

  const database = await getDatabase();
  const registry = getRegistry();
  const model = selectModel();
  try {
    return await ask(database, registry, userId, parsed.data, { ...opts, model });
  } catch (e) {
    if (e instanceof ScopeViolation || e instanceof IntentError || e instanceof SessionLocked || e instanceof InjectionRefused) return { kind: 'refused', message: e.message };
    // The AI model is unavailable (network, quota): fall back to the deterministic model, same checks.
    if (model !== deterministicModel) {
      try {
        return await ask(database, registry, userId, parsed.data, { ...opts, model: deterministicModel });
      } catch (e2) {
        if (e2 instanceof ScopeViolation || e2 instanceof IntentError) return { kind: 'refused', message: e2.message };
      }
    }
    return { kind: 'refused', message: 'Something went wrong answering that question. Please try again.' };
  }
}
