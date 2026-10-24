'use client';
import { useEffect, useRef, useSyncExternalStore } from 'react';
const KEY = 'sola-welcomed';
const listeners = new Set<() => void>();
let dismissed = false; // in-memory fallback when storage is blocked
function seen(): boolean {
  if (dismissed) return true;
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
// A welcome screen shown once per browser session. It is not a login: access is enforced by
// Cloudflare Access before any page loads, and this screen never collects credentials.
export function Welcome() {
  // Server and first hydration render treat it as already seen, so static HTML never hides content.
  const wasSeen = useSyncExternalStore(subscribe, seen, () => true);
  const open = !wasSeen;
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) btn.current?.focus();
  }, [open]);
  function enter() {
    dismissed = true;
    try {
      sessionStorage.setItem(KEY, '1');
    } catch {
      /* storage blocked: shown again next load */
    }
    listeners.forEach((l) => l());
  }
  if (!open) return null;
  return (
    <div
      className="welcome"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') enter();
      }}
    >
      <div className="welcome-inner">
        <span className="welcome-mark" aria-hidden="true" />
        <p className="welcome-kicker">SOLA LENS · BY SOLA CAPITAL</p>
        <h2 id="welcome-title">Welcome.</h2>
        <p className="welcome-sub">
          Your protected, read-only view of public wallets. Everything here is simulated for now.
        </p>
        <ul className="welcome-facts">
          <li>Protected by Cloudflare Access</li>
          <li>Watch-only: no wallet, no signing</li>
          <li>Simulated data</li>
        </ul>
        <button ref={btn} className="button primary" onClick={enter}>
          Enter
        </button>
      </div>
    </div>
  );
}
