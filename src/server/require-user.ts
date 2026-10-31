// The one place a request's user is decided (audit Q3). Pages and Server Actions call this instead of repeating the
// rule, so a careless edit in one of them can't reopen impersonation.
// - Signed in: the account behind the session cookie. Nothing in the form or URL can change it.
// - Not signed in: only with ALLOW_TEST_IDENTITIES=true under `npm run dev` (refused in production), a demo id
//   picked by the "Viewing as" switch, else nobody.
import { activeDemoIds } from './auth';
import { testIdentitiesEnabled } from './identity';
import { currentSession } from './session';

export interface Actor {
  userId: string;
  /** Set when the user is signed in; written to audit rows to tell accounts and sessions apart. */
  username?: string;
  sessionId?: string;
}

/**
 * The user for this request, or undefined (the caller sends them to log in). `requested` is the demo id the test
 * switch asked for, and `fallback` the one it uses when none was asked for; both are ignored for signed-in users.
 */
export async function requireUser(requested?: unknown, fallback?: string): Promise<Actor | undefined> {
  const session = await currentSession();
  if (session) return session;
  if (!testIdentitiesEnabled()) return undefined;
  // Cached per dataset folder: rebuilding the seed here cost 30-130 ms on every request (review, Oct 31).
  const ids = new Set(activeDemoIds());
  if (typeof requested === 'string' && ids.has(requested)) return { userId: requested };
  return fallback && ids.has(fallback) ? { userId: fallback } : undefined;
}
