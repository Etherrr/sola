import type { SessionState } from './api-client';
/**
 * Runs session checks so that only the most recent request can change state: starting a new check
 * aborts the previous one and ignores its result, and a disposed checker ignores everything.
 */
export function createSessionChecker(
  fetcher: (signal: AbortSignal) => Promise<SessionState>,
  onState: (s: SessionState) => void,
) {
  let latest = 0;
  let ctl: AbortController | null = null;
  let disposed = false;
  return {
    run() {
      if (disposed) return;
      ctl?.abort();
      const mine = ++latest;
      const c = (ctl = new AbortController());
      void fetcher(c.signal).then((s) => {
        if (!disposed && mine === latest) onState(s);
      });
    },
    dispose() {
      disposed = true;
      ctl?.abort();
    },
  };
}
