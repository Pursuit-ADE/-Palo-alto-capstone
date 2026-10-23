'use server';

import { cookies } from 'next/headers';
import { httpsSettings } from '@/server/https';
import { isView, VIEW_COOKIE } from './view-mode';

/** The Numbers / Graphs switch. Setting the cookie re-renders the page in the chosen view. */
export async function setViewMode(formData: FormData) {
  const view = formData.get('view');
  if (!isView(view)) return;
  (await cookies()).set(VIEW_COOKIE, view, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: httpsSettings().secureCookie,
    maxAge: 365 * 24 * 3600,
  });
}
