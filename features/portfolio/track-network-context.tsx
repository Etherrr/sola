'use client';
import { createContext, useContext, useRef, useState } from 'react';
import type { TrackNetwork } from './api-client';

// One shared network selection for the Track page: the top-bar selector and the form chips are
// two controls for the same choice, so they read and write a single state instead of disagreeing.
// prefillAddress lets the saved-addresses panel fill the lookup form and switch network WITHOUT
// firing a lookup: the form only receives the text; the user presses Look up themselves.
const TrackNetworkContext = createContext<{
  network: TrackNetwork;
  setNetwork: (n: TrackNetwork) => void;
  prefillEvent: { address: string; seq: number } | null;
  prefillAddress: (address: string, network: TrackNetwork) => void;
}>({
  network: 'ethereum',
  setNetwork: () => undefined,
  prefillEvent: null,
  prefillAddress: () => undefined,
});

export function TrackNetworkProvider({ children }: { children: React.ReactNode }) {
  const [network, setNetwork] = useState<TrackNetwork>('ethereum');
  const [prefillEvent, setPrefillEvent] = useState<{ address: string; seq: number } | null>(null);
  // A monotonically increasing token per request: the form consumes each token once, so the same
  // address can be sent again later and there is nothing to clear (no cross-component setState).
  const seq = useRef(0);
  const prefillAddress = (address: string, n: TrackNetwork) => {
    if (n !== network) setNetwork(n);
    seq.current += 1;
    setPrefillEvent({ address, seq: seq.current });
  };
  return (
    <TrackNetworkContext.Provider value={{ network, setNetwork, prefillEvent, prefillAddress }}>
      {children}
    </TrackNetworkContext.Provider>
  );
}

export function useTrackNetwork() {
  return useContext(TrackNetworkContext);
}
