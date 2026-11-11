// The light or dark theme this browser chose, read on the server so the first paint is already in it. With no choice
// saved, the page follows the operating system's setting. A display preference only: it never changes what anyone can see.
import { cookies } from 'next/headers';
import { isTheme, THEME_COOKIE, type Theme } from './theme-shared';

/** The saved theme, or null when the browser follows the system setting. */
export async function readTheme(): Promise<Theme | null> {
  const v = (await cookies()).get(THEME_COOKIE)?.value;
  return isTheme(v) ? v : null;
}
