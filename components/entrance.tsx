'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AccountMenu } from './account-menu';

const KEY = 'sola-welcomed';
// The one entrance. Two real destinations. The intro (panels sliding apart) plays once per
// browser session and never when the user prefers reduced motion. It gates nothing: Cloudflare
// Access has already authenticated the visitor before this page loads.
export function Entrance() {
  const [intro, setIntro] = useState(false);
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
  return (
    <div className={intro ? 'entrance intro' : 'entrance'}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="entrance-top">
        <Link className="brand" href="/" aria-label="Sola Lens home">
          <span className="brand-symbol" aria-hidden="true" />
          <span>
            SOLA <span className="brand-lens">LENS</span>
          </span>
        </Link>
        <span className="sim-pill">◇ SIMULATED</span>
        <AccountMenu />
      </header>
      <main id="main" tabIndex={-1} className="entrance-main">
        <h1 className="entrance-title">Where to?</h1>
        <p className="entrance-sub">
          Two sections, one lens. Everything here is simulated and read-only.
        </p>
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
            <span className="card-kicker">PORTFOLIO VIEW · SIMULATED</span>
            <span className="entrance-p">
              A sample portfolio and a simulated address lookup. No wallet connection and no live
              balances yet.
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
