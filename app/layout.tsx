import type { ReactNode } from 'react';
import localFont from 'next/font/local';
import { readTheme } from './theme';
import './globals.css';

export const metadata = {
  title: 'Governed Analytics Copilot',
  description: 'Team ALTO PALS capstone: governed AI analytics copilot (Maven CRM data).',
};

// Fonts ship with the app (the open-source @fontsource packages, OFL) and are served from it, so browsers never
// contact Google (no visitor IPs sent to a third party, no external font hosts in the CSP) and builds need no
// network access to Google.
const manrope = localFont({
  src: '../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2',
  weight: '200 800',
  variable: '--font-manrope',
  display: 'swap',
});
const plexMono = localFont({
  src: [
    { path: '../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', weight: '400' },
    { path: '../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', weight: '500' },
  ],
  variable: '--font-plex-mono',
  display: 'swap',
});

export default async function RootLayout({ children }: { children: ReactNode }) {
  // A saved light or dark choice goes on <html>, so the first paint is already in it (no flash, and no inline script,
  // which the content security policy forbids). With none saved, the stylesheet follows the system setting.
  const theme = await readTheme();
  return (
    <html lang="en" className={`${manrope.variable} ${plexMono.variable}`} data-theme={theme ?? undefined}>
      <body>{children}</body>
    </html>
  );
}
