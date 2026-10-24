'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChainSelector } from './chain-selector';
import { Welcome } from './welcome';
const items = [
  { href: '/portfolio', label: 'Overview', icon: '◧' },
  { href: '/track', label: 'Track', icon: '⌕' },
  { href: '/explore', label: 'Explore', icon: '◎' },
  { href: '/learn', label: 'Learn', icon: '✦' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
];
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="app">
      <Welcome />
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="side">
        <Link className="brand" href="/" aria-label="Sola Lens home">
          <span className="brand-symbol" aria-hidden="true" />
          <span>
            SOLA <span className="brand-lens">LENS</span>
          </span>
        </Link>
        <nav aria-label="Main" className="side-nav">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              aria-current={path.startsWith(i.href) ? 'page' : undefined}
            >
              <span aria-hidden="true">{i.icon}</span>
              {i.label}
            </Link>
          ))}
        </nav>
        <p className="side-foot">
          v0.1 · PREVIEW
          <br />
          Simulated data
        </p>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <ChainSelector />
          <span className="sim-pill">◇ SIMULATED</span>
          <a
            className="top-return"
            href="https://solacapitalpartners.com/"
            rel="noopener noreferrer"
          >
            Sola Capital Partners ↗
          </a>
        </header>
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <footer className="app-foot">
          <p>
            Learning preview · Educational information only. No financial advice, custody, or
            performance guarantees. Simulated figures are not market data.{' '}
            <Link href="/settings">Privacy &amp; local data</Link>
            {' · '}
            <a href="https://solacapitalpartners.com/" rel="noopener noreferrer">
              Back to solacapitalpartners.com
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
