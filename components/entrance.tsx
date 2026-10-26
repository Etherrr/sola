'use client';
import Link from 'next/link';
import { useEffect, useState, type MouseEvent } from 'react';
import { AccountMenu } from './account-menu';
import { useRouter } from 'next/navigation';
import { useSession } from '@/features/portfolio/session-context';
import { useNativeSession } from '@/features/auth-v2/native-session';

// Intentional entry only. A returning entitled session skips the welcome.
export function Entrance() {
  const session = useSession();
  const router = useRouter();
  const native = useNativeSession();
  // Plan Phase B.4 / acceptance: a returning authorized user (live native account session)
  // lands directly on the portfolio; the entrance choice is for first-time visitors.
  // replace() keeps the entrance out of the back stack. 'off' (native routes disabled on
  // this host) and 'none' (no session) keep the entrance exactly as before.
  useEffect(() => {
    if (native.kind === 'ok') router.replace('/account/overview');
  }, [native.kind, router]);
  const email = native.kind === 'ok' ? native.displayLabel
    : native.kind === 'off' && session.kind === 'verified' ? session.email : null;
  const [destination, setDestination] = useState<string | null>(null);
  const intro = destination !== null;
  const enter = (event: MouseEvent<HTMLAnchorElement>, target: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    event.preventDefault();
    setDestination(target);
  };
  useEffect(() => {
    if (!destination) return;
    const timer = window.setTimeout(() => window.location.assign(destination), 650);
    return () => window.clearTimeout(timer);
  }, [destination]);
  return (
    <div className={intro ? 'entrance intro' : 'entrance'}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {intro && (
        <div className="entrance-curtain" data-sensitive>
          <button type="button" className="button secondary entrance-skip" onClick={() => destination && window.location.assign(destination)}>Skip intro</button>
          <span className="curtain-half left" />
          <span className="curtain-half right" />
          <span className="curtain-mark">
            <span className="brand-symbol" />
            <span>
              SOLA <span className="brand-lens">LENS</span>
            </span>
            <span className="curtain-welcome">
              {email ? `Welcome, ${email}` : 'Welcome'}
            </span>
          </span>
        </div>
      )}
      <header className="entrance-top">
        <Link className="brand" href="/" aria-label="Sola Lens home">
          <span className="brand-symbol" aria-hidden="true" />
          <span>
            SOLA <span className="brand-lens">LENS</span>
          </span>
        </Link>
        <span className="sim-pill">◇ READ-ONLY</span>
        <AccountMenu />
      </header>
      <main id="main" tabIndex={-1} className="entrance-main">
        <h1 className="entrance-title">
          <span>Choose your</span> <em>lens.</em>
        </h1>
        <p className="entrance-sub">
          Choose where to begin, or sign in.
        </p>
        <p className="actions entrance-auth-actions">
          <Link className="button primary" href="/sign-in" onClick={(e) => enter(e, '/sign-in')}>
            Sign in
          </Link>{' '}
          <Link className="button secondary" href="/create-account" onClick={(e) => enter(e, '/create-account')}>
            Create account
          </Link>
        </p>
        <p className="entrance-account" data-sensitive>
          {email
            ? `Previous sign-in recognized for ${email}. Sola account access is invitation-only.`
            : 'Accounts are invitation-only while in preview.'}
        </p>
        <div className="entrance-split">
          <Link href="/learn" className="entrance-card edu" onClick={(e) => enter(e, '/learn')}>
            <span className="entrance-h">Education</span>
            <span className="card-kicker">LEARN DEFI AT YOUR OWN PACE</span>
            <span className="entrance-p">
              Wallets, networks, risks and a hands-on security lab. No wallet needed.
            </span>
            <span className="card-link">
              Enter Education <span aria-hidden="true">→</span>
            </span>
          </Link>
          <Link href="/account/overview" className="entrance-card app" onClick={(e) => enter(e, '/account/overview')}>
            <span className="entrance-h">Portfolio</span>
            <span className="card-kicker">SAVED ADDRESSES · RECORDED OBSERVATIONS</span>
            <span className="entrance-p">
              Review recognized holdings, coverage and history. Add watched addresses without connecting a wallet.
            </span>
            <span className="card-link">
              Enter Portfolio <span aria-hidden="true">→</span>
            </span>
          </Link>
        </div>
      </main>
    </div>
  );
}
