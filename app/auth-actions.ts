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
  if (!(await dbSessionGuard(database.auditDb, 10).allow(`auth:${action}:${username}`))) return 'rate_limited_user';
  return undefined;
}

/**
 * One audit row per sign-in or sign-up attempt, in the same log as questions. Like questions, the username is
 * stored only as a keyed fingerprint, and the password never. A failed write is logged on the server and never
 * changes the outcome: the session cookie may already be set, so throwing would show an error to a signed-in user.
 */
async function auditAuth(action: 'login' | 'signup', username: string, outcome: 'ok' | 'failed', reason?: string, userId?: string) {
  try {
    const database = await getDatabase();
    await database.auditDb.insert(queryAudit).values({
      id: randomUUID(),
      at: new Date(),
      requestId: randomUUID(),
      source: 'auth',
      userId: userId ?? 'unknown',
      questionSha256: questionFingerprint(`username:${username}`),
      outcome: `${action}_${outcome}`,
      reason: reason ?? null,
    });
  } catch (e) {
    console.error(`auth audit write failed (${action}_${outcome}):`, e instanceof Error ? e.name : 'unknown');
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
    const { userId } = await signUp(database.auditDb, { username: username.data, password: password.data, invite: invite.data });
    const { token } = await logIn(database.auditDb, username.data, password.data);
    await setSessionCookie(token);
    await auditAuth('signup', name, 'ok', undefined, userId);
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
    const { token, userId } = await logIn(database.auditDb, username.data, password.data);
    await setSessionCookie(token);
    await auditAuth('login', name, 'ok', undefined, userId);
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
  await logOut(database.auditDb, await readSessionCookie());
  await clearSessionCookie();
  redirect('/login');
}
