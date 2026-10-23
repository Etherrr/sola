'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
const links = [
  { href: '/portfolio', label: 'Explore demo' },
  { href: '/track', label: 'Address lookup · soon' },
  { href: '/explore', label: 'Explore' },
  { href: '/learn', label: 'Learn DeFi' },
  { href: '/settings', label: 'Settings' },
];
export function Navigation() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" href="/" aria-label="Sola Lens home" onClick={() => setOpen(false)}>
          <span className="brand-symbol" aria-hidden="true" />
          <span>
            SOLA <span className="brand-lens">LENS</span>
            <small>BY SOLA CAPITAL</small>
          </span>
        </Link>
        <button
          className="menu-toggle button secondary"
          aria-expanded={open}
          aria-controls="main-nav"
          onClick={() => setOpen(!open)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
        >
          Menu {open ? '−' : '+'}
        </button>
        <nav
          id="main-nav"
          aria-label="Main"
          className={open ? 'nav open' : 'nav'}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false);
              document.querySelector<HTMLButtonElement>('.menu-toggle')?.focus();
            }
          }}
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={path.startsWith(link.href) ? 'page' : undefined}
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <a
            className="nav-return"
            href="https://solacapitalpartners.com/"
            rel="noopener noreferrer"
          >
            ← Sola Capital Partners
          </a>
        </nav>
        <span className="preview-tag">v0.1 · PREVIEW</span>
      </div>
    </header>
  );
}
