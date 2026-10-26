'use client';
import type { ReactNode } from 'react';
import { useNativeSession } from '@/features/auth-v2/native-session';

/**
 * Unified signed-out treatment for the v2 Overview (user steering
 * 2026-10-25: terse, action-first, beautiful). When the native session
 * answers 401 ('none'), every data route 401s too - four repeated
 * "Sign in to..." lines say less than one honest card with one action.
 * While loading, or on the native-off (Access) branch, the per-section
 * components render exactly as before - no state is hidden.
 */
export function SignedOutGate({ children }: { children: ReactNode }) {
  const native = useNativeSession();
  if (native.kind !== 'none') return <>{children}</>;
  return (
    <div className="ov2-signedout">
      <p className="ov2-signedout-line">Sign in to see your holdings, addresses and recorded history.</p>
      <p className="actions">
        <a className="button primary" href="/sign-in">
          Sign in
        </a>
      </p>
    </div>
  );
}
