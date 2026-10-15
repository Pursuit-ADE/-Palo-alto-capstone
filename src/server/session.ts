// The signed-in user for this request, read only from the session cookie. Server-only.
import { cookies } from 'next/headers';
import { sessionUser, SESSION_HOURS } from './auth';
import { getDatabase } from './runtime';

export const SESSION_COOKIE = 'alto_session';

/** The signed-in user's id, or undefined. Never taken from a form, URL or link. */
export async function currentUserId(): Promise<string | undefined> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return undefined;
  const database = await getDatabase();
  return sessionUser(database.auditDb, token);
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    // Secure cookies need HTTPS; plain-http localhost would drop them.
    secure: process.env.ENABLE_HSTS === 'true' || process.env.COOKIE_SECURE === 'true',
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function readSessionCookie(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}
