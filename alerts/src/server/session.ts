// The signed-in user for this request, read only from the session cookie. Server-only.
import { cookies, headers } from 'next/headers';
import { REQUEST_PROTO_HEADER, secureCookieForRequest } from './https';
import { sessionInfo, SESSION_HOURS, type SessionInfo } from './auth';
import { getAlertsRuntime } from './runtime';

// A different cookie from the copilot's: on localhost both apps share cookies, and each keeps its own sessions.
export const SESSION_COOKIE = 'alto_alerts_session';

/** The signed-in user's id, or undefined. Never taken from a form, URL or link. */
export async function currentUserId(): Promise<string | undefined> {
  return (await currentSession())?.userId;
}

/** The signed-in account and session, or undefined. Never taken from a form, URL or link. */
export async function currentSession(): Promise<SessionInfo | undefined> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return undefined;
  const { database, directory } = await getAlertsRuntime();
  return sessionInfo(database.db, token, new Date(), directory);
}

async function cookieIsSecure(): Promise<boolean> {
  try {
    return secureCookieForRequest((await headers()).get(REQUEST_PROTO_HEADER));
  } catch {
    // No request scope. Fall back to the process default.
    return secureCookieForRequest(null);
  }
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    // Secure on HTTPS. Off on plain http, so a phone at the LAN address keeps the session. See https.ts.
    secure: await cookieIsSecure(),
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function readSessionCookie(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}
