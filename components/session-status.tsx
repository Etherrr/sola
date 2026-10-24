'use client';
import { useEffect, useState } from 'react';
import { fetchSession, type SessionState } from '@/features/portfolio/api-client';
import { createSessionChecker } from '@/features/portfolio/session-check';
// Shows who Cloudflare Access says is signed in, but only after the server has verified the
// Access token and answered 200 with an email. A 401 clears any identity and shows "not verified".
// Any other outcome (no API here, kill switch off, network error) shows nothing: no guessing.
type State = { kind: 'checking' } | SessionState;
export function SessionStatus() {
  const [state, setState] = useState<State>({ kind: 'checking' });
  useEffect(() => {
    const checker = createSessionChecker(fetchSession, setState);
    checker.run();
    const onVisible = () => {
      if (document.visibilityState === 'visible') checker.run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      checker.dispose();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  if (state.kind === 'verified')
    return (
      <span className="session-chip" title="Verified by Cloudflare Access">
        <span aria-hidden="true">●</span>
        <span className="session-email">
          <span className="sr-only">Signed in via Cloudflare Access as </span>
          {state.email}
        </span>
      </span>
    );
  if (state.kind === 'rejected')
    return <span className="session-chip warn">Session not verified</span>;
  return null;
}
