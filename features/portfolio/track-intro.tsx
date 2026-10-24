'use client';
import { useEffect, useState } from 'react';
import { ModeMarker } from '@/components/mode-marker';
import { TrackForm } from './track-form';
import { fetchDataMode, type DataMode } from './api-client';

type Shown = 'checking' | DataMode;
function useDataMode(): Shown {
  const [mode, setMode] = useState<Shown>('checking');
  useEffect(() => {
    const ctl = new AbortController();
    void fetchDataMode(ctl.signal).then((m) => {
      if (!ctl.signal.aborted) setMode(m);
    });
    return () => ctl.abort();
  }, []);
  return mode;
}

export function TrackApp() {
  const mode = useDataMode();
  return (
    <>
      <TrackIntro mode={mode} />
      {/* Fixture examples are offered only when lookups are simulated: in live mode they would be real addresses. */}
      <TrackForm examples={mode !== 'live'} />
    </>
  );
}

function TrackIntro({ mode }: { mode: Shown }) {
  return (
    <>
      <p className="eyebrow">
        {mode === 'live'
          ? 'WATCH-ONLY · LIVE READ'
          : mode === 'mock'
            ? 'WATCH-ONLY · SIMULATED'
            : 'WATCH-ONLY'}
      </p>
      <h1>Track a public address</h1>
      {mode === 'live' ? (
        <>
          <p>
            Look up an Ethereum address. This deployment reads real public Ethereum data: ETH and a
            short list of tokens (USDC, USDT, DAI, WETH). Other tokens, NFTs and DeFi positions are
            not shown, so a result is not a full portfolio.
          </p>
          <ModeMarker
            mode="LIVE_REFRESHED"
            context="data mode"
            note="Read-only. No wallet connects and nothing is signed. The pasted address is sent to a public Ethereum node to read its balances."
          />
        </>
      ) : mode === 'mock' ? (
        <>
          <p>
            Look up an Ethereum address. Results are fixed simulated examples, not blockchain data.
            Live data stays off until it is separately approved.
          </p>
          <ModeMarker
            mode="SIMULATED"
            note="Simulated fixtures. No live data, no wallet, nothing is signed."
          />
        </>
      ) : (
        <p>
          Look up an Ethereum address.{' '}
          {mode === 'checking'
            ? 'Checking whether lookups are simulated or live…'
            : 'The data mode could not be confirmed. Each result states its own mode.'}
        </p>
      )}
    </>
  );
}
