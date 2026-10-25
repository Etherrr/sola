'use client';
import { useEffect, useState } from 'react';
import { nativeSessionInfoRequest } from '../portfolio/api-client';

/**
 * Native session state for the app shell (v0.2 header identity consistency):
 * when a NATIVE session is live, the header greets that identity, not the
 * Access profile. 'off' means the native routes are switched off on this
 * host (production today) - the shell then keeps its existing Access behavior
 * exactly. 'none' means native routes answer but no live session exists.
 */
export type NativeSessionState =
  | { kind: 'loading' }
  | { kind: 'off' }
  | { kind: 'none' }
  | { kind: 'ok'; email: string; fresh: boolean };

export function useNativeSession(): NativeSessionState {
  const [state, setState] = useState<NativeSessionState>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    nativeSessionInfoRequest()
      .then(async (res): Promise<NativeSessionState> => {
        if (res.status === 401) return { kind: 'none' };
        if (!res.ok) return { kind: 'off' };
        const body = (await res.json().catch(() => null)) as {
          status?: string;
          email?: string;
          fresh?: boolean;
        } | null;
        if (body?.status === 'ok' && typeof body.email === 'string')
          return { kind: 'ok', email: body.email, fresh: body.fresh === true };
        return { kind: 'off' };
      })
      .then((s) => live && setState(s))
      .catch(() => live && setState({ kind: 'off' }));
    return () => {
      live = false;
    };
  }, []);
  return state;
}
