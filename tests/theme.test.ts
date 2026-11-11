// The light/dark switch (Nov 10): only "light" or "dark" is ever saved, in an httpOnly cookie, and read back the same way.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const jar = vi.hoisted(() => new Map<string, { value: string; options: Record<string, unknown> }>());
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string, options: Record<string, unknown>) => {
      jar.set(name, { value, options });
    },
  }),
  headers: async () => new Headers({ host: 'localhost:3000' }),
}));

import { readTheme } from '../app/theme';
import { setTheme } from '../app/theme-actions';
import { isTheme, otherTheme, THEME_COOKIE } from '../app/theme-shared';

const form = (theme?: string) => {
  const data = new FormData();
  if (theme !== undefined) data.set('theme', theme);
  return data;
};

beforeEach(() => jar.clear());

describe('the theme values', () => {
  it('are exactly light and dark', () => {
    expect(isTheme('light')).toBe(true);
    expect(isTheme('dark')).toBe(true);
    for (const v of ['Dark', 'system', '', ' dark', null, undefined, 1, {}]) expect(isTheme(v)).toBe(false);
  });

  it('switch to the other one', () => {
    expect(otherTheme('light')).toBe('dark');
    expect(otherTheme('dark')).toBe('light');
  });
});

describe('saving the choice', () => {
  it('keeps it a year in an httpOnly, same-site cookie', async () => {
    await setTheme(form('dark'));
    const saved = jar.get(THEME_COOKIE);
    expect(saved?.value).toBe('dark');
    expect(saved?.options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 365 * 24 * 3600 });
    expect(typeof saved?.options.secure).toBe('boolean');
  });

  it('ignores anything that is not light or dark', async () => {
    for (const v of ['blue', '<script>', 'light; Path=/admin', '']) await setTheme(form(v));
    await setTheme(form());
    expect(jar.size).toBe(0);
  });
});

describe('reading the choice', () => {
  it('returns the saved theme', async () => {
    await setTheme(form('light'));
    expect(await readTheme()).toBe('light');
  });

  it('returns null with nothing saved or an edited cookie, so the page follows the system setting', async () => {
    expect(await readTheme()).toBeNull();
    jar.set(THEME_COOKIE, { value: 'purple', options: {} });
    expect(await readTheme()).toBeNull();
  });
});
