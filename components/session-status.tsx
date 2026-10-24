'use client';
import { useEffect, useState } from 'react';
import { fetchSession, type SessionState } from '@/features/portfolio/api-client';
// Shows who Cloudflare Access says is signed in, but only after the server has verified the
// Access token and answered 200 with an email. A 401 clears any identity and shows "not verified".
// Any other outcome (no API here, kill switch off, network error) shows nothing: no guessing.
type State = { kind: 'checking' } | SessionState;
export function SessionStatus() {
  const [state, setState] = useState<State>({ kind: 'checking' });
  useEffect(() => {
    let live = true;
    const run = () =>
      void fetchSession().then((s) => {
        if (live) setState(s);
      });
    run();
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  if (state.kind === 'verified')
    return (
      <span className="session-chip" title="Verified by Cloudflare Access">
        <span aria-hidden="true">●</span>
        <span className="sr-only">Signed in via Cloudflare Access as </span>
        <span className="session-email">{state.email}</span>
      </span>
    );
  if (state.kind === 'rejected')
    return <span className="session-chip warn">Session not verified</span>;
  return null;
}
