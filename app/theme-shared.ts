// Light or dark: the names and checks shared by the server (app/theme.ts) and the switch in the browser
// (app/theme-toggle.tsx). No imports, so the browser bundle never pulls in server code.

export type Theme = 'light' | 'dark';
export const THEME_COOKIE = 'alto_theme';

export const isTheme = (v: unknown): v is Theme => v === 'light' || v === 'dark';

/** The theme a press of the switch moves to. */
export const otherTheme = (t: Theme): Theme => (t === 'dark' ? 'light' : 'dark');
