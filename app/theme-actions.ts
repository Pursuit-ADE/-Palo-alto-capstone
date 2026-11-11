'use server';

// Saves the light or dark choice from the switch in the top bar (app/theme-toggle.tsx).
import { cookies } from 'next/headers';
import { cookieIsSecure } from './secure-cookie';
import { isTheme, THEME_COOKIE } from './theme-shared';

/** The light/dark switch. Setting the cookie re-renders the page in the chosen theme. Anything else is ignored. */
export async function setTheme(formData: FormData) {
  const theme = formData.get('theme');
  if (!isTheme(theme)) return;
  (await cookies()).set(THEME_COOKIE, theme, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: await cookieIsSecure(),
    maxAge: 365 * 24 * 3600,
  });
}
