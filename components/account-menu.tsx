'use client';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { useSession } from '@/features/portfolio/session-context';
import { useNativeSession } from '@/features/auth-v2/native-session';
import { nativeLogoutRequest } from '@/features/portfolio/api-client';
import { registerPasskey, passkeysSupported } from '../features/auth-v2/passkey-client';

// Account control. It shows an identity only after a verified 200 from /api/v1/session. There is
// no photo or display name source yet, so the avatar is the first letter of the verified email and
// the greeting is the email itself, not a name guessed from it. Sign out goes to the documented
// Access logout (/cdn-cgi/access/logout on the app host): the edge clears the session cookie and
// issued tokens stop being accepted seconds later. Cloudflare does not offer a per-application
// logout - the revocation applies to every app protected by this Access account - so the control
// says so next to the button. The full navigation also discards this app's client state.
export function AccountMenu() {
  const [passkeyNote, setPasskeyNote] = useState<string | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const setupPasskey = async () => {
    setPasskeyBusy(true);
    setPasskeyNote(null);
    const out = await registerPasskey();
    setPasskeyNote(out.ok ? 'Passkey saved.' : out.message);
    setPasskeyBusy(false);
  };
  const s = useSession();
  const native = useNativeSession();
  const [open, setOpen] = useState(false);
  // Full navigation, not a client-side route: the Access edge clears the session cookie, and the
  // document swap discards every in-memory identity and saved-list state with it.
  const signOut = () => {
    window.location.assign('/cdn-cgi/access/logout');
  };
  // Native sign-out: end the native session, then reload so every client-side
  // identity (including the Access one) is re-derived from the servers. Only
  // reload on a confirmed end - a failed request must never LOOK signed out.
  const [nativeSignOutFailed, setNativeSignOutFailed] = useState(false);
  const nativeSignOut = () => {
    setNativeSignOutFailed(false);
    nativeLogoutRequest()
      .then((r) => {
        if (r.ok) window.location.reload();
        else setNativeSignOutFailed(true);
      })
      .catch(() => setNativeSignOutFailed(true));
  };
  const btn = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    // Keyboard focus leaving the control closes the panel, so it never stays open over content.
    const onFocusIn = (e: FocusEvent) => {
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
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  // A live native session is the identity the app greets (main 2026-10-25:
  // the native journey must reflect the native identity, not the Access
  // profile). The Access email is the fallback ONLY where native sign-in is
  // switched off. Where native is enabled but signed out
  // ('none'), greeting the Access email would be a false signed-in state
  // while the app's own pages say "Sign in" - so nothing is greeted.
  const nativeLabel = native.kind === 'ok' ? native.displayLabel : null;
  const email = nativeLabel ?? (native.kind === 'off' && s.kind === 'verified' ? s.email : null);
  const label = email
    ? `Account: ${email}`
    : (native.kind === 'off' && s.kind === 'rejected')
      ? 'Account: session not verified'
      : 'Account';
  return (
    <div className="acct" ref={root} data-sensitive>
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
          ) : (native.kind === 'off' && s.kind === 'rejected') ? (
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
            {nativeLabel ? (
              <>
                Signed in as <strong>{nativeLabel}</strong>
              </>
            ) : native.kind === 'error' ? (
              'Your sign-in could not be checked. Reload to try again.'
            ) : native.kind === 'none' ? (
              <>
                Not signed in. <Link href="/sign-in">Sign in</Link>
              </>
            ) : email ? (
              <>
                Signed in via Cloudflare Access as <strong>{email}</strong>
              </>
            ) : (native.kind === 'off' && s.kind === 'rejected') ? (
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
          <div className="acct-signout">
            {nativeLabel ? (
              <>
                {passkeysSupported() && (
                  <>
                    <button
                      type="button"
                      className="acct-signout-btn"
                      disabled={passkeyBusy}
                      onClick={() => void setupPasskey()}
                    >
                      {passkeyBusy ? 'Working…' : 'Set up a passkey'}
                    </button>
                    {passkeyNote && <p className="acct-signout-note">{passkeyNote}</p>}
                  </>
                )}
                <button type="button" className="acct-signout-btn" onClick={nativeSignOut}>
                  Sign out
                </button>
                {nativeSignOutFailed ? (
                  <p className="acct-signout-note" role="alert">
                    Could not sign out just now - try again.
                  </p>
                ) : (
                  <p className="acct-signout-note">Ends this Sola sign-in on this device.</p>
                )}
              </>
            ) : native.kind !== 'off' ? null : (
              <>
                <button type="button" className="acct-signout-btn" onClick={signOut}>
                  Sign out
                </button>
                <p className="acct-signout-note">
                  Ends this protected session and also signs you out of other apps protected by this
                  Cloudflare Access account.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
