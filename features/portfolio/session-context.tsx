'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { fetchSession } from './api-client';
import { createSessionChecker, type CheckerState } from './session-check';

// One verified-session state for the whole app. Identity is only ever the verified email from
// GET /api/v1/session; a recheck clears it first and only a fresh verified 200 restores it.
const Ctx = createContext<CheckerState>({ kind: 'checking' });
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CheckerState>({ kind: 'checking' });
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
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}
