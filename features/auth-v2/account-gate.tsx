'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useNativeSession } from './native-session';
import { addressBookRequest } from '../portfolio/api-client';
import { AddressBook } from '../portfolio-v2/address-book';
import { CombinedProvider } from '../portfolio-v2/combined-context';
import { CombinedBalances } from '../portfolio-v2/combined-balances';
import { nativeLogoutRequest } from '../portfolio/api-client';
import { ClaimSection, claimSectionLive } from '../claim/claim-section';

/**
 * The gated native account page (plan §7 entry point). Every state honest:
 *   loading        -> checking, no content flash
 *   no session     -> client redirect to /sign-in?next=/account (data routes
 *                     independently 401 server-side; this page never shows data)
 *   native off     -> this host has native sign-in disabled (production today)
 *   session, 403   -> signed in but NOT invited: say exactly that. Never empty
 *                     holdings, never zeros, never generic success.
 *   session, ok    -> the real address book.
 */
type Gate =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'not-invited' }
  | { kind: 'reauth' }
  | { kind: 'ready' };


/** The legacy Track saved-address list stays reachable from every rendered gate
 *  state, with no redirect. Loading it still needs a verified session. */
function LegacyTrackLink() {
  return (
    <p className="notice">
      Looking for the older Track address list? Use the{' '}
      <a href="/portfolio">Legacy Track list</a> page.
    </p>
  );
}

export function AccountGate() {
  const native = useNativeSession();
  const router = useRouter();
  const [gate, setGate] = useState<Gate>({ kind: 'loading' });
  const [signOutFailed, setSignOutFailed] = useState(false);
  // Sign out only navigates on a confirmed end - failure keeps the truth visible.
  const signOut = () => {
    setSignOutFailed(false);
    nativeLogoutRequest()
      .then((r) => {
        if (r.ok) window.location.assign('/');
        else setSignOutFailed(true);
      })
      .catch(() => setSignOutFailed(true));
  };

  useEffect(() => {
    if (native.kind === 'none') {
      router.replace('/sign-in/?next=%2Faccount');
      return;
    }
    if (native.kind !== 'ok') return;
    let live = true;
    addressBookRequest('GET', undefined)
      .then(async (r) => {
        if (!live) return;
        if (r.status === 403) {
          // Only the explicit not_entitled body means "not invited"; any other
          // 403 (a future guard, origin check, ...) is an honest error.
          const b = (await r.clone().json().catch(() => null)) as { error?: string } | null;
          setGate(b?.error === 'not_entitled' ? { kind: 'not-invited' } : { kind: 'error' });
        } else if (r.status === 401) {
          // Session endpoint said ok but the data route refused: the session went
          // stale between the two reads. Ask for a fresh sign-in, never loop.
          setGate({ kind: 'reauth' });
        } else if (r.ok) setGate({ kind: 'ready' });
        else setGate({ kind: 'error' });
      })
      .catch(() => live && setGate({ kind: 'error' }));
    return () => {
      live = false;
    };
  }, [native.kind, router]);

  if (native.kind === 'none') return <p><em>Taking you to sign in…</em></p>;
  if (native.kind === 'off')
    return (
      <div className="panel">
        <p><em>Native accounts are not enabled on this host yet.</em></p>
        <LegacyTrackLink />
      </div>
    );
  if (gate.kind === 'loading') return <p><em>Checking your sign-in…</em></p>;
  if (gate.kind === 'error')
    return (
      <div className="panel">
        <p><em>Your account could not be read just now. Try again in a moment.</em></p>
        <LegacyTrackLink />
      </div>
    );
  if (gate.kind === 'not-invited')
    return (
      <div className="panel">
        <h2>Not invited yet</h2>
        <p>
          You are signed in{native.kind === 'ok' ? ` as ${native.email}` : ''}. This email
          does not have preview access. Sign out to use the email your invitation was sent
          to.
        </p>
        <p className="actions">
          <button type="button" className="button secondary" onClick={signOut}>
            Sign out
          </button>
        </p>
        {signOutFailed && <p role="alert" className="form-alert">Could not sign out just now - try again.</p>}
        <LegacyTrackLink />
      </div>
    );
  if (gate.kind === 'reauth')
    return (
      <div className="panel">
        <p><em>This session went stale. Sign in again to continue.</em></p>
        <p className="actions">
          <a className="button primary" href="/sign-in/?next=%2Faccount">
            Sign in again
          </a>
        </p>
        <LegacyTrackLink />
      </div>
    );
  return (
    <>
      <div className="panel">
        <p>
          <em>Signed in{native.kind === 'ok' ? ` as ${native.email}` : ''}.</em>
        </p>
      </div>
      {/* Claim integration (LOCAL prep, review pending): renders NOTHING unless
          the discovery endpoint answers claim:true, and fetches no claim data
          until the user explicitly opens the section. With the flag off the
          RENDERED account page is unchanged from before; the only addition is
          one discovery GET (claim:false -> nothing renders). */}
      <ClaimSection discover={claimSectionLive.discover} makeApi={claimSectionLive.makeApi} />
      <CombinedProvider>
        <AddressBook />
        <CombinedBalances />
      </CombinedProvider>
      <p className="actions">
        <button type="button" className="button secondary" onClick={signOut}>
          Sign out
        </button>
      </p>
      {signOutFailed && <p role="alert" className="form-alert">Could not sign out just now - try again.</p>}
      <LegacyTrackLink />
    </>
  );
}
