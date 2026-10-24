'use server';

// Sign-up, log-in and log-out (Server Actions, POST only). Errors are returned as a short message; a wrong
// username and a wrong password get the same message.
import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { queryAudit } from '@/db/schema';
import { questionFingerprint } from '@/semantic/answer';
import { AuthError, logIn, logOut, signUp } from '@/server/auth';
import { addressLimit, clientAddress } from '@/server/client-address';
import { dbSessionGuard } from '@/server/limits';
import { getDatabase } from '@/server/runtime';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from '@/server/session';

export type AuthState = { error?: string } | null;

// Usernames that can't exist share one counter, so made-up names don't each get their own 10 tries or their own row.
const limitKey = (name: string) => (/^[a-z0-9._-]{3,32}$/.test(name) ? name : 'invalid');

const Field = z.string().max(200);

/**
 * Brute-force limits, shared by every process on the same database: 10 attempts a minute per username, and
 * 30 a minute per address across all usernames, so one machine can't try many accounts. Without a trusted
 * address (see src/server/client-address.ts) all callers share one bucket of 100. Returns the limit hit.
 */
async function limited(action: 'login' | 'signup', username: string): Promise<string | undefined> {
  const database = await getDatabase();
  // The address is checked first, so attempts refused for it don't add a guard row per made-up username.
  const address = clientAddress(await headers());
  if (!(await dbSessionGuard(database.auditDb, addressLimit(address)).allow(`auth-ip:${questionFingerprint(address).slice(0, 32)}`))) return 'rate_limited_ip';
  if (!(await dbSessionGuard(database.auditDb, 10).allow(`auth:${action}:${limitKey(username)}`))) return 'rate_limited_user';
  // A ceiling for the whole app, so many machines together still can't try more than 300 a minute.
  if (!(await dbSessionGuard(database.auditDb, 300).allow('auth-all'))) return 'rate_limited_all';
  return undefined;
}

/**
 * One audit row per sign-in or sign-up attempt, in the same log as questions. Like questions, the username is
 * stored only as a keyed fingerprint, and the password never. A failed write is logged on the server and never
 * changes the outcome: the session cookie may already be set, so throwing would show an error to a signed-in user.
 */
async function auditAuth(action: 'login' | 'signup', username: string, outcome: 'ok' | 'failed', reason?: string, userId?: string, sessionId?: string) {
  try {
    const database = await getDatabase();
    await database.auditDb.insert(queryAudit).values({
      id: randomUUID(),
      at: new Date(),
      requestId: randomUUID(),
      source: 'auth',
      userId: userId ?? 'unknown',
      questionSha256: questionFingerprint(`username:${username}`),
      username: outcome === 'ok' ? username : null,
      sessionId: sessionId ?? null,
      outcome: `${action}_${outcome}`,
      reason: reason ?? null,
    });
  } catch (e) {
    console.error(`auth audit write failed (${action}_${outcome}):`, e instanceof Error ? e.name : 'unknown');
    // A successful sign-in must be audited before its cookie is set (#24), so that failure still stops it.
    // A failed attempt is refused either way; the person sees the usual message, not an internal error.
    if (outcome === 'ok') throw e;
  }
}

export async function signUpAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const username = Field.safeParse(formData.get('username'));
  const password = Field.safeParse(formData.get('password'));
  const invite = Field.safeParse(formData.get('invite'));
  if (!username.success || !password.success || !invite.success) return { error: 'Fill in every field.' };
  const name = username.data.trim().toLowerCase();
  const limit = await limited('signup', name);
  if (limit) {
    await auditAuth('signup', name, 'failed', limit);
    return { error: 'Too many attempts. Wait a minute and try again.' };
  }
  const database = await getDatabase();
  try {
    const { userId } = await signUp(database.authDb, { username: username.data, password: password.data, invite: invite.data });
    const previous = await readSessionCookie();
    const { token, sessionId } = await logIn(database.authDb, username.data, password.data);
    // Only after a successful log-in: end this browser's previous session, if any.
    await logOut(database.authDb, previous);
    // Audit first: if the row can't be written, no cookie is set and nobody is left signed in.
    await auditAuth('signup', name, 'ok', undefined, userId, sessionId);
    await setSessionCookie(token);
  } catch (e) {
    if (e instanceof AuthError) {
      await auditAuth('signup', name, 'failed', e.code);
      return { error: e.message };
    }
    return { error: 'Something went wrong. Please try again.' };
  }
  redirect('/');
}

export async function logInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const username = Field.safeParse(formData.get('username'));
  const password = Field.safeParse(formData.get('password'));
  if (!username.success || !password.success) return { error: 'Fill in your username and password.' };
  const name = username.data.trim().toLowerCase();
  const limit = await limited('login', name);
  if (limit) {
    await auditAuth('login', name, 'failed', limit);
    return { error: 'Too many attempts. Wait a minute and try again.' };
  }
  const database = await getDatabase();
  try {
    const previous = await readSessionCookie();
    const { token, userId, sessionId } = await logIn(database.authDb, username.data, password.data);
    // Only after a successful log-in, so a wrong password doesn't sign this browser out.
    await logOut(database.authDb, previous);
    await auditAuth('login', name, 'ok', undefined, userId, sessionId);
    await setSessionCookie(token);
  } catch (e) {
    if (e instanceof AuthError) {
      await auditAuth('login', name, 'failed', e.code);
      return { error: e.message };
    }
    return { error: 'Something went wrong. Please try again.' };
  }
  redirect('/');
}

export async function logOutAction() {
  const database = await getDatabase();
  await logOut(database.authDb, await readSessionCookie());
  await clearSessionCookie();
  redirect('/login');
}
