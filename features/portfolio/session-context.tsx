'use client';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { fetchSession } from './api-client';
import { createSessionChecker, type CheckerState } from './session-check';

// One verified-session state for the whole app. Identity is only ever the verified email from
// GET /api/v1/session; a recheck clears it first and only a fresh verified 200 restores it.
export const RECHECK_MS = 5 * 60 * 1000;
const Ctx = createContext<CheckerState>({ kind: 'checking' });
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CheckerState>({ kind: 'checking' });
  const path = usePathname();
  const checker = useRef<ReturnType<typeof createSessionChecker> | null>(null);
  useEffect(() => {
    const c = createSessionChecker(fetchSession, setState);
    checker.current = c;
    c.run();
    const onVisible = () => {
      if (document.visibilityState === 'visible') c.run();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    window.addEventListener('focus', onVisible);
    // A tab left open and visible rechecks every 5 minutes, so an expired or revoked session
    // clears the identity. Hidden tabs do not poll; they recheck when they become visible.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') c.run();
    }, RECHECK_MS);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', onVisible);
      window.removeEventListener('focus', onVisible);
      c.dispose();
      checker.current = null;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  // Recheck on every in-app route change, so a long-open tab does not keep a stale identity.
  // The first run is the mount effect above; later runs skip when the path has not changed.
  const last = useRef(path);
  useEffect(() => {
    if (last.current !== path) {
      last.current = path;
      checker.current?.run();
    }
  }, [path]);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}
