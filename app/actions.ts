'use server';

// Questions are sent by POST (a Server Action), so their text never lands in URLs, browser history or access
// logs. Next.js checks the request's Origin against the host for Server Actions.
import { z } from 'zod';
import { demoUsers } from '@/db/seed';
import { ask, MAX_QUESTION_LENGTH, type Reply } from '@/semantic/answer';
import { IntentError } from '@/semantic/compile';
import { ScopeViolation } from '@/semantic/scope';
import { testIdentitiesEnabled } from '@/server/identity';
import { questionLimiter } from '@/server/limits';
import { getDatabase, getRegistry } from '@/server/runtime';

export type AskResult = Reply | { kind: 'refused'; message: string } | null;

const Question = z.string().trim().min(1).max(MAX_QUESTION_LENGTH);
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
  try {
    return await ask(await getDatabase(), getRegistry(), userId, parsed.data);
  } catch (e) {
    if (e instanceof ScopeViolation || e instanceof IntentError) return { kind: 'refused', message: e.message };
    return { kind: 'refused', message: 'Something went wrong answering that question.' };
  }
}
