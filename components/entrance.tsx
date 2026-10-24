'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AccountMenu } from './account-menu';
import { useSession } from '@/features/portfolio/session-context';

const KEY = 'sola-welcomed';
// The one entrance. Two real destinations. The intro (panels sliding apart) plays once per
// browser session and never when the user prefers reduced motion. It gates nothing: Cloudflare
// Access has already authenticated the visitor before this page loads.
export function Entrance() {
  const session = useSession();
  const email = session.kind === 'verified' ? session.email : null;
  const [intro, setIntro] = useState(false);
  const [curtainDone, setCurtainDone] = useState(false);
  const curtain = intro && !curtainDone;
  useEffect(() => {
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let play: boolean;
    try {
      play = sessionStorage.getItem(KEY) !== '1';
      sessionStorage.setItem(KEY, '1');
    } catch {
      play = false; // storage blocked: skip the animation rather than repeat it
    }
    // Reads browser-only state after hydration, so server HTML and first paint always match.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (play && !calm) setIntro(true);
  }, []);
  // Remove the curtain after the animation so it can never linger over the page.
  useEffect(() => {
    if (!curtain) return;
    const t = window.setTimeout(() => setCurtainDone(true), 3200);
    return () => window.clearTimeout(t);
  }, [curtain]);
  return (
    <div className={intro ? 'entrance intro' : 'entrance'}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {curtain && (
        <div className="entrance-curtain" aria-hidden="true">
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
          Open the app, or learn first. Address lookups read live public balances; sample pages
          stay clearly simulated. Everything is read-only.
        </p>
        {email && <p className="entrance-account">Signed in as {email} · read-only access</p>}
        <div className="entrance-split">
          <Link href="/education" className="entrance-card edu">
            <span className="entrance-h">Education</span>
            <span className="card-kicker">LEARN DEFI AT YOUR OWN PACE</span>
            <span className="entrance-p">
              Wallets, networks, risks and a hands-on security lab. No wallet needed.
            </span>
            <span className="card-link">
              Enter Education <span aria-hidden="true">→</span>
            </span>
          </Link>
          <Link href="/portfolio" className="entrance-card app">
            <span className="entrance-h">DeFi App</span>
            <span className="card-kicker">LIVE ADDRESS LOOKUP · READ-ONLY</span>
            <span className="entrance-p">
              Look up real ETH and SOL balances at public addresses. The overview portfolio is
              still a clearly labeled sample. No wallet connection.
            </span>
            <span className="card-link">
              Enter DeFi App <span aria-hidden="true">→</span>
            </span>
          </Link>
        </div>
      </main>
    </div>
  );
}
