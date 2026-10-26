'use client';
import { useEffect, useState } from 'react';
import { nativeSessionInfoRequest } from '../portfolio/api-client';
import { parseNativeSession, type VerifiedNativeSession } from './session-contract';

/**
 * Native session state for the app shell (v0.2 header identity consistency):
 * when a NATIVE session is live, the header greets that identity, not the
 * Access profile. 'off' means the native routes are switched off on this
 * host - the shell then keeps its existing Access behavior
 * exactly. 'none' means native routes answer but no live session exists.
 */
export type NativeSessionState =
  | { kind: 'loading' }
  | { kind: 'off' }
  | { kind: 'none' }
  | { kind: 'error' }
  | VerifiedNativeSession;

export function useNativeSession(): NativeSessionState {
  const [state, setState] = useState<NativeSessionState>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    nativeSessionInfoRequest()
      .then(async (res): Promise<NativeSessionState> => {
        if (res.status === 401) return { kind: 'none' };
        const body: unknown = await res.json().catch(() => null);
        if (res.status === 503 && body && typeof body === 'object' &&
            'error' in body && body.error === 'unavailable') return { kind: 'off' };
        if (!res.ok) return { kind: 'error' };
        return parseNativeSession(body) ?? { kind: 'error' };
      })
      .then((s) => live && setState(s))
      .catch(() => live && setState({ kind: 'error' }));
    return () => {
      live = false;
    };
  }, []);
  return state;
}
