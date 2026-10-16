'use server';

// Sign-up, log-in and log-out (Server Actions, POST only). Errors are returned as a short message; a wrong
// username and a wrong password get the same message.
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { AuthError, logIn, logOut, signUp } from '@/server/auth';
import { getAlertsRuntime } from '@/server/runtime';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from '@/server/session';

export type AuthState = { error?: string } | null;

const Field = z.string().max(200);

// 10 attempts a minute per username, per server process (the alerts app has no shared guard table).
const attempts = new Map<string, number[]>();
async function attempt(key: string, now = Date.now()): Promise<boolean> {
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 10) return false;
  attempts.set(key, [...recent, now]);
  return true;
}

async function db() {
  return (await getAlertsRuntime()).database.db;
}

export async function signUpAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const username = Field.safeParse(formData.get('username'));
  const password = Field.safeParse(formData.get('password'));
  const invite = Field.safeParse(formData.get('invite'));
  if (!username.success || !password.success || !invite.success) return { error: 'Fill in every field.' };
  if (!(await attempt(`signup:${username.data.trim().toLowerCase()}`))) return { error: 'Too many attempts. Wait a minute and try again.' };
  try {
    await signUp(await db(), { username: username.data, password: password.data, invite: invite.data });
    const { token } = await logIn(await db(), username.data, password.data);
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
  try {
    const { token } = await logIn(await db(), username.data, password.data);
    await setSessionCookie(token);
  } catch (e) {
    if (e instanceof AuthError) return { error: e.message };
    return { error: 'Something went wrong. Please try again.' };
  }
  redirect('/');
}

export async function logOutAction() {
  await logOut(await db(), await readSessionCookie());
  await clearSessionCookie();
  redirect('/login');
}
