'use server';

// Sign-up, log-in and log-out (Server Actions, POST only). Errors are returned as a short message; a wrong
// username and a wrong password get the same message.
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { AuthError, logIn, logOut, signUp } from '@/server/auth';
import { dbSessionGuard } from '@/server/limits';
import { getDatabase } from '@/server/runtime';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from '@/server/session';

export type AuthState = { error?: string } | null;

const Field = z.string().max(200);

async function attempt(key: string): Promise<boolean> {
  const database = await getDatabase();
  // 10 attempts a minute per username, shared by every process on the same database.
  return dbSessionGuard(database.auditDb, 10).allow(`auth:${key}`);
}

export async function signUpAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const username = Field.safeParse(formData.get('username'));
  const password = Field.safeParse(formData.get('password'));
  const invite = Field.safeParse(formData.get('invite'));
  if (!username.success || !password.success || !invite.success) return { error: 'Fill in every field.' };
  if (!(await attempt(`signup:${username.data.trim().toLowerCase()}`))) return { error: 'Too many attempts. Wait a minute and try again.' };
  const database = await getDatabase();
  try {
    await signUp(database.auditDb, { username: username.data, password: password.data, invite: invite.data });
    const { token } = await logIn(database.auditDb, username.data, password.data);
    await setSessionCookie(token);
  } catch (e) {
    if (e instanceof AuthError) return { error: e.message };
    return { error: 'Something went wrong. Please try again.' };
  }
  redirect('/');
}

export async function logInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const username = Field.safeParse(formData.get('username'));
  const password = Field.safeParse(formData.get('password'));
  if (!username.success || !password.success) return { error: 'Fill in your username and password.' };
  if (!(await attempt(`login:${username.data.trim().toLowerCase()}`))) return { error: 'Too many attempts. Wait a minute and try again.' };
  const database = await getDatabase();
  try {
    const { token } = await logIn(database.auditDb, username.data, password.data);
    await setSessionCookie(token);
  } catch (e) {
    if (e instanceof AuthError) return { error: e.message };
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
