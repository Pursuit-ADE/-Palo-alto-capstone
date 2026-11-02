'use server';

// Questions are sent by POST (a Server Action), so their text never lands in URLs, browser history or access
// logs. Next.js checks the request's Origin against the host for Server Actions.
import { z } from 'zod';
import { MAX_QUESTION_LENGTH, recordRefusal, type Reply } from '@/semantic/answer';
import { selectModel } from '@/semantic/model';
import { askWithFallback } from '@/server/ask';
import { requireUser } from '@/server/require-user';
import { dbSessionGuard } from '@/server/limits';
import { getDatabase, getRegistry } from '@/server/runtime';

/** `signedOut`: the session ended (expired, revoked, or the server restarted), so the panel offers a way back in. */
export type AskResult = Reply | { kind: 'refused'; message: string; signedOut?: true } | null;

// Only bounds the form field. ask() refuses anything over MAX_QUESTION_LENGTH itself, so the refusal is audited and
// flagged like any other (PRD S4; bug hunt, Oct 31: a long many-shot paste was refused here and left no audit row).
const Question = z.string().trim().min(1).max(MAX_QUESTION_LENGTH * 10);
// The conversation state the browser sends back: at most the previous intent (a few hundred bytes) and a turn count.
const PreviousJson = z.string().max(2000);
const Turn = z.coerce.number().int().min(1).max(50);

export async function askCopilot(_prev: AskResult, formData: FormData): Promise<AskResult> {
  // The user comes from the session (src/server/require-user.ts). A signed-in person can't ask as anyone else: the
  // form's user field is ignored. Only with no session and test identities on (local testing) is it used.
  const actor = await requireUser(formData.get('user'));
  // The page itself needs a session, so no actor here means the session ended while the page was open (UX review, Nov 2,
  // row 7): the header still says "Signed in as …", and "Please log in" alone gave no way to do it.
  if (!actor) return { kind: 'refused', message: 'Your session has ended, so this question wasn’t asked.', signedOut: true };
  const parsed = Question.safeParse(formData.get('example') ?? formData.get('q'));
  if (!parsed.success) return { kind: 'refused', message: `Ask a question of 1 to ${MAX_QUESTION_LENGTH} characters.` };

  const database = await getDatabase();
  const guard = dbSessionGuard(database.auditDb);
  const userId = actor.userId;
  if (!(await guard.allow(userId))) {
    await recordRefusal(database, userId, parsed.data, 'refused_rate', 'rate_limit', actor);
    return { kind: 'refused', message: 'Too many questions in the last minute. Please wait a moment and ask again.' };
  }

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
  const opts = { previous, turn: turn.success ? turn.data : 1, guard, actor };

  const registry = getRegistry();
  return askWithFallback(database, registry, userId, parsed.data, opts, selectModel());
}
