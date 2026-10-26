'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AccountMenu } from './account-menu';
import { lessons } from '@/content/lessons';
import { SECTION_ORDER } from '@/features/onboarding/learning-library';

// Plan §8 Education shell: /learn/* is a separate experience with its own navigation -
// the five plan sections in their pinned order, practice exercises last and labeled
// SIMULATED, and a return-to-portfolio action. It shares branding and the account
// control with the main app, but renders no Portfolio sidebar, no network picker and no
// balances or metrics chrome. Access, guest policy and progress persistence are
// unchanged; lesson content comes from the same registry as the library cards.
const PRACTICE = [
  { href: '/learn/network-journey', label: 'Ethereum transfer walkthrough' },
  { href: '/learn/security-lab', label: 'Security decision lab' },
];
const returnLink = { href: '/account', label: 'Back to the portfolio', icon: '←' };

// '01 / BLOCKCHAIN BASICS' -> 'Blockchain basics'
function navLabel(eyebrow: string) {
  const part = (eyebrow.split('/')[1] || eyebrow).trim().toLowerCase();
  return part.charAt(0).toUpperCase() + part.slice(1);
}

const isCurrent = (path: string, href: string) =>
  path === href || (href !== '/learn' && path.startsWith(`${href}/`));

export function LearnShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const bar = useRef<HTMLElement>(null);
  // Mobile bottom bar: the full module list lives under one Lessons disclosure.
  const [lessonsOpen, setLessonsOpen] = useState(false);
  const lessonsRef = useRef<HTMLDivElement>(null);
  const lessonsBtnRef = useRef<HTMLButtonElement>(null);
  // Close on route change: adjust state during render (no effect needed).
  const [prevPath, setPrevPath] = useState(path);
  if (prevPath !== path) {
    setPrevPath(path);
    setLessonsOpen(false);
  }
  useEffect(() => {
    if (!lessonsOpen) return;
    const onDown = (e: PointerEvent) => {
      if (lessonsRef.current && !lessonsRef.current.contains(e.target as Node))
        setLessonsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLessonsOpen(false);
        lessonsBtnRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [lessonsOpen]);
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

  const lessonLinks = (cls: string) =>
    SECTION_ORDER.map((section) => {
      const items = lessons.filter((l) => l.section === section);
      if (items.length === 0) return null;
      return (
        <div
          key={section}
          role="group"
          aria-labelledby={`learn-nav-${section.replace(/[^a-z]/gi, '')}`}
          className={`nav-group ${cls}`}
        >
          <p id={`learn-nav-${section.replace(/[^a-z]/gi, '')}`} className="nav-group-label">
            {section}
          </p>
          {items.map((lesson) => (
            <Link
              key={lesson.id}
              href={lesson.path}
              className="nav-edu"
              aria-current={isCurrent(path, lesson.path) ? 'page' : undefined}
            >
              <span aria-hidden="true">◦</span>
              {navLabel(lesson.eyebrow)}
            </Link>
          ))}
        </div>
      );
    });

  return (
    <div className="app learn-app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="side">
        <Link className="brand" href="/learn" aria-label="Sola Lens learning library">
          <span className="brand-symbol" aria-hidden="true" />
          <span>
            SOLA <span className="brand-lens">LENS</span>
          </span>
        </Link>
        <p className="learn-shell-tag">EDUCATION</p>
        <nav aria-label="Learning" className="side-nav">
          <Link
            href="/learn"
            className="nav-edu learn-home"
            aria-current={path === '/learn' || path === '/learn/' ? 'page' : undefined}
          >
            <span aria-hidden="true">✦</span>
            Library home
          </Link>
          {lessonLinks('learn-desktop')}
          <div
            role="group"
            aria-labelledby="learn-nav-practice"
            className="nav-group learn-desktop"
          >
            <p id="learn-nav-practice" className="nav-group-label">
              Practice exercises
            </p>
            {PRACTICE.map((p) => (
              <Link
                key={p.href}
                href={p.href}
                className="nav-edu learn-practice"
                aria-current={isCurrent(path, p.href) ? 'page' : undefined}
              >
                <span aria-hidden="true">◦</span>
                <span className="learn-practice-label">
                  {p.label} <span className="sim-tag">SIMULATED</span>
                </span>
              </Link>
            ))}
          </div>
          <div className="more-wrap" ref={lessonsRef}>
            <button
              type="button"
              className="nav-more"
              ref={lessonsBtnRef}
              aria-expanded={lessonsOpen}
              aria-current={
                path.startsWith('/learn/') && path !== '/learn/' ? 'page' : undefined
              }
              onClick={() => setLessonsOpen((o) => !o)}
            >
              <span aria-hidden="true">☰</span>
              Lessons
            </button>
            {lessonsOpen ? (
              <div role="group" aria-label="Lessons" className="more-menu">
                {SECTION_ORDER.flatMap((section) =>
                  lessons
                    .filter((l) => l.section === section)
                    .map((lesson) => (
                      <Link
                        key={lesson.id}
                        href={lesson.path}
                        aria-current={isCurrent(path, lesson.path) ? 'page' : undefined}
                      >
                        <span aria-hidden="true">◦</span>
                        {navLabel(lesson.eyebrow)}
                      </Link>
                    )),
                )}
                {PRACTICE.map((p) => (
                  <Link
                    key={p.href}
                    href={p.href}
                    aria-current={isCurrent(path, p.href) ? 'page' : undefined}
                  >
                    <span aria-hidden="true">◦</span>
                    {p.label} · SIMULATED
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
          <Link
            href={returnLink.href}
            className="nav-edu learn-return"
          >
            <span aria-hidden="true">{returnLink.icon}</span>
            {returnLink.label}
          </Link>
        </nav>
        <p className="side-foot">
          v0.2 · PREVIEW
          <br />
          Practice exercises are simulated.
        </p>
      </aside>
      <div className="app-body">
        <header className="topbar" ref={bar}>
          <span className="scope-chip">Sola Lens preview</span>
          <span className="sim-pill">◇ READ-ONLY</span>
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
  );
}
