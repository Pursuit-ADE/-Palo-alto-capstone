'use server';

import { cookies, headers } from 'next/headers';
import { secureCookieForRequest } from '@/server/https';
import { isView, VIEW_COOKIE } from './view-mode';

async function cookieIsSecure(): Promise<boolean> {
  try {
    const h = await headers();
    return secureCookieForRequest({ host: h.get('host'), proto: h.get('x-forwarded-proto') });
  } catch {
    return secureCookieForRequest();
  }
}

/** The Numbers / Graphs switch. Setting the cookie re-renders the page in the chosen view. */
export async function setViewMode(formData: FormData) {
  const view = formData.get('view');
  if (!isView(view)) return;
  (await cookies()).set(VIEW_COOKIE, view, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: await cookieIsSecure(),
    maxAge: 365 * 24 * 3600,
  });
}
