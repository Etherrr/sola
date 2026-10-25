'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useNativeSession } from './native-session';

/**
 * Native welcome door (plan §2 entry: "One native Sola interface for welcome,
 * onboarding, login and account creation"). Terse by user steering 2026-10-25:
 * actions, not explanations. Returning users with a live native session go
 * straight to the Overview (plan: returning authorized users land directly on
 * portfolio). No Connect-wallet action is shown - that path is not built;
 * a disabled placeholder would be a fake action.
 */
export function WelcomeDoor() {
  const native = useNativeSession();
  const router = useRouter();

  useEffect(() => {
    if (native.kind === 'ok') router.replace('/dev/overview-v2');
  }, [native.kind, router]);

  if (native.kind === 'loading' || native.kind === 'ok') {
    return <p><em>Checking your sign-in…</em></p>;
  }

  return (
    <>
      <div className="panel">
        <p>
          <a className="btn primary" href="/dev/sign-in">Sign in</a>{' '}
          <a className="btn" href="/dev/create-account">Create account</a>
        </p>
        <p>
          <em>Invite-only preview. One email code, no password.</em>
        </p>
      </div>
      <div className="panel">
        <h2>Education</h2>
        <p>
          <em>Lessons and exercises, open without an account.</em>{' '}
          <a href="/education">Open Education</a>
        </p>
      </div>
    </>
  );
}
