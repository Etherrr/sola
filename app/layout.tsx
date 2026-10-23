import type { Metadata } from 'next';
import Link from 'next/link';
import { Navigation } from '@/components/navigation';
import { ProgressProvider } from '@/features/onboarding/progress-provider';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'Sola Lens — Clarity before action', template: '%s | Sola Lens' },
  description:
    'Learn DeFi safely and explore a clearly simulated portfolio. A Sola Capital preview.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ProgressProvider>
          <a className="skip-link" href="#main">
            Skip to content
          </a>
          <Navigation />
          <main id="main" tabIndex={-1}>
            {children}
          </main>
          <footer className="site-footer">
            <div>
              <span className="footer-brand">SOLA CAPITAL</span>
              <p>Clarity before action.</p>
            </div>
            <p>
              Learning preview · Educational information only.
              <br />
              No financial advice, custody, or performance guarantees.
            </p>
            <Link href="/settings">Privacy & local data</Link>
          </footer>
        </ProgressProvider>
      </body>
    </html>
  );
}
