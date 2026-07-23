import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@/ui/theme/ThemeProvider';

export const metadata: Metadata = {
  title: 'Belora',
  description: 'AI website builder per micro-business locali',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="it">
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
