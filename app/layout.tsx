import type { Metadata, Viewport } from 'next';
import { AppShell } from '@/components/app-shell';
import { ProgressProvider } from '@/features/onboarding/progress-provider';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'Sola Lens — Clarity before action', template: '%s | Sola Lens' },
  description:
    'Learn DeFi safely and explore a clearly simulated portfolio. A Sola Capital preview.',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ProgressProvider>
          <AppShell>{children}</AppShell>
        </ProgressProvider>
      </body>
    </html>
  );
}
