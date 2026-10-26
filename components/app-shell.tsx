'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChainSelector } from './chain-selector';
import { LearnShell } from './learn-shell';
import { AccountMenu } from './account-menu';
import { fetchHealth } from '@/features/portfolio/api-client';
import { SessionProvider } from '@/features/portfolio/session-context';
import { TrackNetworkProvider } from '@/features/portfolio/track-network-context';
const sections = [
  {
    id: 'defi',
    label: 'DeFi App',
    note: '',
    // Plan line 54: Track removed as a disconnected primary menu item. The
    // /track route still answers directly until its lookup is refactored
    // into the address manager (plan line 218.2).
    items: [
      { href: '/account/overview', label: 'Overview', icon: '◧' },
      { href: '/account/assets', label: 'Assets', icon: '◈' },
      { href: '/account/defi', label: 'DeFi', icon: '◇' },
      { href: '/account/risk', label: 'Risk & Return', icon: '◉', cls: 'overflow-desktop' },
      { href: '/account', label: 'Addresses & Wallets', icon: '▤', cls: 'overflow-desktop' },
      { href: '/markets', label: 'Markets', icon: '◷', cls: 'overflow-desktop' },
    ],
  },
];
// The only education trace in the app: one button leading to the separate Education area.
const educationLink = { href: '/learn', label: 'Education', icon: '◎', cls: 'nav-settings edu-desktop' };
const settingsLink = { href: '/settings', label: 'Settings', icon: '⚙', cls: 'nav-settings' };
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const bar = useRef<HTMLElement>(null);
  // The demo label is only honest when this deployment's health endpoint reports mock mode;
  // on live (or unknown) it must not claim the data is demo.
  const [mode, setMode] = useState<'mock' | 'live' | 'unknown'>('unknown');
  // Reviewer edge (fe2a3e0): a mount-only fetch skipped on an initial /learn entry stayed
  // skipped after a client-side return to the portfolio, leaving the demo-mode hint
  // unknowable. Fetch once on the first non-learn render - path-keyed, ref-guarded.
  const healthFetched = useRef(false);
  useEffect(() => {
    // The learning shell renders no mode line, so it does not need the health read.
    if (path.startsWith('/learn')) return;
    if (healthFetched.current) return;
    healthFetched.current = true;
    let live = true;
    fetchHealth().then((h) => live && setMode(h.mode)).catch(() => {});
    return () => {
      live = false;
    };
  }, [path]);
  // Mobile bottom bar: Education lives under More; the desktop sidebar shows it directly.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  // Close on route change: adjust state during render (no effect needed).
  const [prevPath, setPrevPath] = useState(path);
  if (prevPath !== path) {
    setPrevPath(path);
    setMoreOpen(false);
  }
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: PointerEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMoreOpen(false);
        moreBtnRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);
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
  // Plan §8: /learn/* runs in its own learning shell - no Portfolio sidebar, no network
  // picker, no balances or metrics chrome. Account identity (SessionProvider) is shared.
  if (path.startsWith('/learn'))
    return (
      <SessionProvider>
        <LearnShell>{children}</LearnShell>
      </SessionProvider>
    );
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
                  <a
                    key={i.href}
                    href={i.href}
                    data-section={sec.id}
                    className={(sec.id === 'defi' ? 'nav-defi' : 'nav-edu') + ('cls' in i && i.cls ? ` ${i.cls}` : '')}
                    aria-current={(i.href === '/account' ? path.replace(/\/$/, '') === '/account' : path.startsWith(i.href)) ? 'page' : undefined}
                  >
                    <span aria-hidden="true">{i.icon}</span>
                    {i.label}
                  </a>
                ))}
              </div>
            ))}
            <Link
              href={educationLink.href}
              className={educationLink.cls}
              aria-current={path.startsWith(educationLink.href) ? 'page' : undefined}
            >
              <span aria-hidden="true">{educationLink.icon}</span>
              {educationLink.label}
            </Link>
            <div className="more-wrap" ref={moreRef}>
              <button
                type="button"
                className="nav-more"
                ref={moreBtnRef}
                aria-expanded={moreOpen}
                aria-current={
                  path.startsWith('/learn') || path.startsWith('/portfolio') || path.startsWith('/account/risk') || path.startsWith('/markets') || path.replace(/\/$/, '') === '/account'
                    ? 'page'
                    : undefined
                }
                onClick={() => setMoreOpen((o) => !o)}
              >
                <span aria-hidden="true">⋯</span>
                More
              </button>
              {moreOpen ? (
                <div role="group" aria-label="More" className="more-menu">
                  {[...sections[0].items.filter((i) => 'cls' in i && i.cls === 'overflow-desktop'), educationLink].map((t) => (
                    <a
                      key={t.href}
                      href={t.href}
                      aria-current={(t.href === '/account' ? path.replace(/\/$/, '') === '/account' : path.startsWith(t.href)) ? 'page' : undefined}
                    >
                      <span aria-hidden="true">{t.icon}</span>
                      {t.label}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
            <Link
              href={settingsLink.href}
              className={settingsLink.cls}
              aria-current={path.startsWith(settingsLink.href) ? 'page' : undefined}
            >
              <span aria-hidden="true">{settingsLink.icon}</span>
              {settingsLink.label}
            </Link>
          </nav>
          <p className="side-foot">
            v0.2 · PREVIEW
            <br />
            {mode === 'mock' ? 'Demo data.' : null}
            <br />
            Lookups and prices show their own source and time.
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
              Preview · Read-only · No financial advice.{' '}
              <Link href="/settings">Privacy &amp; local data</Link>
              {' · '}
              <a href="https://solacapitalpartners.com/" rel="noopener noreferrer">
                solacapitalpartners.com
              </a>
            </p>
          </footer>
        </div>
      </div>
      </TrackNetworkProvider>
    </SessionProvider>
  );
}
