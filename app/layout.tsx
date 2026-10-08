import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Governed Analytics Copilot',
  description: 'Team ALTO PALS capstone: governed AI analytics copilot (synthetic data only).',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
