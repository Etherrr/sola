'use client';
import { createContext, useContext, useState } from 'react';
import type { TrackNetwork } from './api-client';

// One shared network selection for the Track page: the top-bar selector and the form chips are
// two controls for the same choice, so they read and write a single state instead of disagreeing.
// prefillAddress lets the saved-addresses panel fill the lookup form and switch network WITHOUT
// firing a lookup: the form only receives the text; the user presses Look up themselves.
const TrackNetworkContext = createContext<{
  network: TrackNetwork;
  setNetwork: (n: TrackNetwork) => void;
  prefill: string | null;
  prefillAddress: (address: string, network: TrackNetwork) => void;
  clearPrefill: () => void;
}>({ network: 'ethereum', setNetwork: () => undefined, prefill: null, prefillAddress: () => undefined, clearPrefill: () => undefined });

export function TrackNetworkProvider({ children }: { children: React.ReactNode }) {
  const [network, setNetwork] = useState<TrackNetwork>('ethereum');
  const [prefill, setPrefill] = useState<string | null>(null);
  const prefillAddress = (address: string, n: TrackNetwork) => {
    if (n !== network) setNetwork(n);
    setPrefill(address);
  };
  const clearPrefill = () => setPrefill(null);
  return (
    <TrackNetworkContext.Provider value={{ network, setNetwork, prefill, prefillAddress, clearPrefill }}>
      {children}
    </TrackNetworkContext.Provider>
  );
}

export function useTrackNetwork() {
  return useContext(TrackNetworkContext);
}
