import type { ReactNode } from 'react';
import localFont from 'next/font/local';
import './globals.css';

export const metadata = {
  title: 'Actionable Alerts',
  description: 'Team ALTO PALS capstone: private, rule-based alerts (Maven CRM data).',
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
