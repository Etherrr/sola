'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchOverview, type OverviewOutcome } from './api';
import { OverviewMessage, OverviewView } from './overview-view';

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; out: Extract<OverviewOutcome, { kind: 'ok' }>['data'] }
  | { phase: 'error'; message: string; retryable: boolean };

/** Loads the gated overview once on view; further fetches happen only on explicit refresh. */
export function OverviewPanel() {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  // Render-only clock: advances the "N s ago" age and the stale label on a long-open page.
  // It never triggers a fetch; network requests happen only on mount and explicit refresh.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const apply = useCallback((out: OverviewOutcome) => {
    if (out.kind === 'ok') setState({ phase: 'ready', out: out.data });
    else setState({ phase: 'error', message: out.message, retryable: out.retryable });
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    fetchOverview(false, ctl.signal).then((out) => {
      if (!ctl.signal.aborted) apply(out);
    });
    return () => ctl.abort();
  }, [apply]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      apply(await fetchOverview(true));
    } finally {
      setRefreshing(false);
    }
  }, [apply]);
  if (state.phase === 'loading')
    return (
      <div className="notice market-status">
        <span className="badge">LOADING</span>
        <p>Loading on-chain prices…</p>
      </div>
    );
  if (state.phase === 'error')
    return (
      <OverviewMessage
        title="Prices are unavailable."
        body={state.message}
        retry={state.retryable}
        onRetry={refresh}
      />
    );
  return <OverviewView data={state.out} nowMs={nowMs} onRefresh={refresh} refreshing={refreshing} />;
}
