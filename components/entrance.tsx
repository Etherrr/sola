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
          <Link href="/start" className="entrance-card edu">
            <span className="card-kicker">EDUCATION</span>
            <span className="entrance-h">Learn DeFi at your own pace</span>
            <span className="entrance-p">
              Wallets, networks, risks and a hands-on security lab. No wallet needed.
            </span>
            <span className="card-link">
              Start learning <span aria-hidden="true">→</span>
            </span>
          </Link>
          <Link href="/portfolio" className="entrance-card app">
            <span className="card-kicker">DEFI APP · SIMULATED</span>
            <span className="entrance-h">Portfolio view</span>
            <span className="entrance-p">
              A sample portfolio and a simulated address lookup. No wallet connection and no live
              balances yet.
            </span>
            <span className="card-link">
              Open the app <span aria-hidden="true">→</span>
            </span>
          </Link>
        </div>
      </main>
    </div>
  );
}
