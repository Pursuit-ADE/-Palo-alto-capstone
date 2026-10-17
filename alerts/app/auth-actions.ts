'use server';

// Sign-up, log-in and log-out (Server Actions, POST only). Errors are returned as a short message; a wrong
// username and a wrong password get the same message.
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { AuthError, logIn, logOut, signUp } from '@/server/auth';
import { allowAttempt } from '@/server/login-limit';
import { getAlertsRuntime } from '@/server/runtime';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from '@/server/session';

export type AuthState = { error?: string } | null;

// Usernames that can't exist share one counter, so made-up names don't each get their own 10 tries or their own row.
const limitKey = (name: string) => (/^[a-z0-9._-]{3,32}$/.test(name) ? name : 'invalid');

const Field = z.string().max(200);

// Shared by every process through the database (src/server/login-limit.ts): 10 attempts a minute per username,
// 30 per address across all usernames, and 300 in total, so one machine or a botnet can't try many accounts.
async function attempt(key: string): Promise<boolean> {
  const database = await db();
  if (!(await allowAttempt(database, key, 10))) return false;
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip')?.trim();
  if (ip && !(await allowAttempt(database, `ip:${ip}`, 30))) return false;
  return allowAttempt(database, 'all', 300);
}

async function db() {
  return (await getAlertsRuntime()).database.db;
}

export async function signUpAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const username = Field.safeParse(formData.get('username'));
  const password = Field.safeParse(formData.get('password'));
  const invite = Field.safeParse(formData.get('invite'));
  if (!username.success || !password.success || !invite.success) return { error: 'Fill in every field.' };
  if (!(await attempt(`signup:${limitKey(username.data.trim().toLowerCase())}`))) return { error: 'Too many attempts. Wait a minute and try again.' };
  try {
    await signUp(await db(), { username: username.data, password: password.data, invite: invite.data });
    await logOut(await db(), await readSessionCookie()); // this browser's previous session, if any
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
  if (!(await attempt(`login:${limitKey(username.data.trim().toLowerCase())}`))) return { error: 'Too many attempts. Wait a minute and try again.' };
  try {
    await logOut(await db(), await readSessionCookie()); // this browser's previous session, if any
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
