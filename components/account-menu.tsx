'use client';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { useSession } from '@/features/portfolio/session-context';

// Account control. It shows an identity only after a verified 200 from /api/v1/session. There is
// no photo or display name source yet, so the avatar is the first letter of the verified email and
// the greeting is the email itself, not a name guessed from it. No sign-out item: no supported
// Access logout route has been confirmed.
export function AccountMenu() {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const email = s.kind === 'verified' ? s.email : null;
  const label = email
    ? `Account: ${email}`
    : s.kind === 'rejected'
      ? 'Account: session not verified'
      : 'Account';
  return (
    <div className="acct" ref={root}>
      <button
        ref={btn}
        type="button"
        className="acct-btn"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="acct-avatar" aria-hidden="true">
          {email ? email[0]!.toUpperCase() : '?'}
        </span>
        <span className="acct-hello" aria-hidden="true">
          {email ? (
            <>
              <small>Hello</small>
              <span>{email}</span>
            </>
          ) : s.kind === 'rejected' ? (
            <span>Session not verified</span>
          ) : null}
        </span>
        <span aria-hidden="true" className="acct-caret">
          ▾
        </span>
      </button>
      {open && (
        <div id={panelId} className="acct-panel" role="group" aria-label="Account">
          <p className="acct-status">
            {email ? (
              <>
                Signed in via Cloudflare Access as <strong>{email}</strong>
              </>
            ) : s.kind === 'rejected' ? (
              'Your session could not be verified. Reload to sign in again.'
            ) : (
              'Identity not available right now. Nothing is guessed.'
            )}
          </p>
          <Link href="/settings" onClick={() => setOpen(false)}>
            Privacy &amp; local data
          </Link>
          <a href="https://solacapitalpartners.com/" rel="noopener noreferrer">
            Sola Capital Partners ↗
          </a>
        </div>
      )}
    </div>
  );
}
