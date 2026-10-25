'use client';
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChainSelector } from './chain-selector';
import { AccountMenu } from './account-menu';
import { SessionProvider } from '@/features/portfolio/session-context';
import { TrackNetworkProvider } from '@/features/portfolio/track-network-context';
const sections = [
  {
    id: 'defi',
    label: 'DeFi App',
    note: '',
    items: [
      { href: '/portfolio', label: 'Overview', icon: '◧' },
      { href: '/track', label: 'Track', icon: '⌕' },
      { href: '/markets', label: 'Markets', icon: '◷' },
    ],
  },
];
// The only education trace in the app: one button leading to the separate Education area.
const startLink = { href: '/welcome', label: 'Start here', icon: '✦', cls: 'nav-settings nav-start-here' };
const educationLink = { href: '/education', label: 'Education', icon: '◎', cls: 'nav-settings' };
const settingsLink = { href: '/settings', label: 'Settings', icon: '⚙', cls: 'nav-settings' };
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const bar = useRef<HTMLElement>(null);
  // Publish the real sticky-bar height so focus and scroll offsets follow it when the bar wraps
  // to two rows on narrow screens.
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const root = document.documentElement;
    const set = () =>
      root.style.setProperty('--topbar-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [path]);
  if (path === '/' || path === '') return <SessionProvider>{children}</SessionProvider>;
  return (
    <SessionProvider>
      <TrackNetworkProvider>
      <div className="app">
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
            {sections.map((sec) => (
              <div
                key={sec.id}
                role="group"
                aria-labelledby={`nav-${sec.id}`}
                className="nav-group"
              >
                <p id={`nav-${sec.id}`} className="nav-group-label">
                  {sec.label}
                </p>
                {sec.items.map((i) => (
                  <Link
                    key={i.href}
                    href={i.href}
                    data-section={sec.id}
                    className={sec.id === 'defi' ? 'nav-defi' : 'nav-edu'}
                    aria-current={path.startsWith(i.href) ? 'page' : undefined}
                  >
                    <span aria-hidden="true">{i.icon}</span>
                    {i.label}
                  </Link>
                ))}
              </div>
            ))}
            {[startLink, educationLink, settingsLink].map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className={t.cls}
                aria-current={path.startsWith(t.href) ? 'page' : undefined}
              >
                <span aria-hidden="true">{t.icon}</span>
                {t.label}
              </Link>
            ))}
          </nav>
          <p className="side-foot">
            v0.1 · PREVIEW
            <br />
            Demo data is simulated.
            <br />
            Lookups and markets prices show their own mode.
          </p>
        </aside>
        <div className="app-body">
          <header className="topbar" ref={bar}>
            <ChainSelector />
            <span className="sim-pill">
              {path.startsWith('/track')
                ? '◇ MODE SHOWN WITH RESULT'
                : path.startsWith('/markets')
                  ? '◇ MODE SHOWN IN PANEL'
                  : path.startsWith('/portfolio')
                    ? '◇ MODE SHOWN PER SECTION'
                    : '◇ READ-ONLY'}
            </span>
            <AccountMenu />
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
              Sola Lens preview · Read-only. No financial advice, custody, or performance
              guarantees. Demo figures are simulated, not market data; address lookups and markets
              prices state their own mode. <Link href="/settings">Privacy &amp; local data</Link>
              {' · '}
              <a href="https://solacapitalpartners.com/" rel="noopener noreferrer">
                Back to solacapitalpartners.com
              </a>
            </p>
          </footer>
        </div>
      </div>
      </TrackNetworkProvider>
    </SessionProvider>
  );
}
