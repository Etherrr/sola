'use client';
import { useEffect, useState } from 'react';
import { ModeMarker } from '@/components/mode-marker';
import { TrackForm } from './track-form';
import { fetchHealth, type DataMode } from './api-client';

type Shown = 'checking' | DataMode;
function useHealth(): { mode: Shown; aave: boolean } {
  const [health, setHealth] = useState<{ mode: Shown; aave: boolean }>({
    mode: 'checking',
    aave: false,
  });
  useEffect(() => {
    const ctl = new AbortController();
    void fetchHealth(ctl.signal).then((h) => {
      if (!ctl.signal.aborted) setHealth(h);
    });
    return () => ctl.abort();
  }, []);
  return health;
}

export function TrackApp() {
  const { mode, aave } = useHealth();
  return (
    <>
      <TrackIntro mode={mode} aave={aave} />
      {/* Fixture examples are offered only when the mode is confirmed simulated: otherwise they could be real addresses. */}
      <TrackForm mode={mode} aave={aave} />
    </>
  );
}

function TrackIntro({ mode, aave }: { mode: Shown; aave: boolean }) {
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
            Look up a public Ethereum or Solana address. This deployment reads real public data.
            On Ethereum: ETH and a short list of tokens (USDC, USDT, DAI, WETH)
            {aave
              ? ', plus Aave V3 supplied and variable-debt positions (no stable debt, health factor or APY; other DeFi positions are not read)'
              : ''}
            . On Solana: the SOL
            balance only - SPL tokens (including USDC and USDT), NFTs and DeFi positions are not
            read. On both networks a result is not a full portfolio and a missing token is not
            proof of an empty wallet. WETH is priced with the ETH/USD feed, so it is a proxy and can
            differ from the real WETH price if WETH trades off its peg. Chainlink marks its USDC and
            USDT feeds as capped, with an upper limit of $1.05 per coin in the feed contract, so
            those prices are reference values, not executable market prices.
          </p>
          <p className="notice">
            Live mode is on for this deployment. Read-only: no wallet connects and nothing is
            signed. A pasted address is sent to a public node (PublicNode) for the chosen network
            to read its balances - or, for a Solana lookup only when PublicNode answers rate limiting,
            once to Solana's public RPC endpoint; PublicNode's policy text says it keeps request
            data at most 24 hours, and that statement is not verified here. Each result below says when it was
            read.
          </p>
        </>
      ) : mode === 'mock' ? (
        <>
          <p>
            Look up an Ethereum or Solana address. Results are fixed simulated examples, not blockchain data.
            Live data stays off until it is separately approved.
          </p>
          <ModeMarker
            mode="SIMULATED"
            note="Simulated fixtures. No live data, no wallet, nothing is signed."
          />
        </>
      ) : (
        <p>
          Look up an Ethereum or Solana address.{' '}
          {mode === 'checking'
            ? 'Checking whether lookups are simulated or live…'
            : 'The data mode could not be confirmed. Each result states its own mode.'}
        </p>
      )}
    </>
  );
}
